const fs = require('node:fs');
const path = require('node:path');
const Zip = require('adm-zip');
const X = require('xlsx');
const root = path.resolve(__dirname, '../../toeic_admin_vite/public/templates');
for (const part of (process.argv[2] ? [Number(process.argv[2])] : [3,4])) {
  const original = new Zip(path.join(root, `toeic_listening_part${part}_sample.zip`));
  const tones = original.getEntries().filter(e => e.entryName.endsWith('.wav'));
  const start = part === 3 ? 32 : 71;
  const questions = Array.from({length:6},(_,i)=>({question_number:start+i,question_text:`[MẪU] Thay câu hỏi ${start+i}`,A:'Thay lựa chọn A',B:'Thay lựa chọn B',C:'Thay lựa chọn C',D:'Thay lựa chọn D',correct_answer:'A',explanation:'Thay bằng lời giải tiếng Việt.'}));
  const groups = [0,3].map(offset=>({question_range:`${start+offset}-${start+offset+2}`,...(part === 3 ? {material_title:`[MẪU] Thay tên bài ${start+offset}`} : {}),transcript:'Thay bằng transcript thật; có thể để trống.',image_path:''}));
  const wb = X.utils.book_new();
  for(const [name,data] of [['questions',questions],['groups',groups]]) {
    const s=X.utils.json_to_sheet(data); s['!cols']=Object.keys(data[0]).map(k=>({wch:/text|explanation|transcript/.test(k)?60:24}));s['!autofilter']={ref:s['!ref']};X.utils.book_append_sheet(wb,s,name);
  }
  const zip=new Zip();zip.addFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));
  groups.forEach((g,i)=>zip.addFile(`audio/${g.question_range}.wav`,tones[i].getData()));
  zip.addFile('HUONG_DAN.txt',Buffer.from(`MẪU NHẬP NHANH PART ${part}\nDùng nút Nhập nhanh Part ${part} trên web.\nSheet questions: question_number, question_text, A, B, C, D, correct_answer, explanation.\nMỗi audio đúng 3 câu; đặt tên khoảng câu như ${start}-${start+2}.mp3.\nSheet groups tùy chọn: question_range, ${part === 3 ? 'material_title, ' : ''}transcript, image_path.${part === 4 ? ' Không cần material_title; nhóm tự ghép theo số câu.' : ''} Có thể xóa cả sheet nếu không cần.\nẢnh đặt tên theo khoảng câu để tự ghép, hoặc nhập image_path ở groups.\nAudio mẫu là tiếng bíp, KHÔNG có lời đọc. Thay mọi câu/đáp án/audio mẫu bằng dữ liệu thật.\nCó thể gửi ZIP hoặc giải nén và chọn Excel cùng media trên web. Nếu chọn file rời, tên ảnh phải duy nhất.\nKiểm tra và ghép trước khi xác nhận nhập.\n`, 'utf8'));
  zip.writeZip(path.join(root,`toeic_listening_part${part}_quick.zip`));
  console.log(`Generated Part ${part}`);
}
