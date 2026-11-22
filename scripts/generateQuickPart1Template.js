const path = require('node:path');
const Zip = require('adm-zip');
const X = require('xlsx');
const root = path.resolve(__dirname, '../../toeic_admin_vite/public/templates');
const original = new Zip(path.join(root, 'toeic_listening_part1_sample.zip'));
const zip = new Zip();
const wb = X.utils.book_new();
const questions = Array.from({length:6}, (_,i) => ({question_number:i+1, correct_answer:'A', explanation:''}));
const sheet = X.utils.json_to_sheet(questions);
sheet['!cols'] = Object.keys(questions[0]).map(k => ({wch: k === 'explanation' ? 60 : 20}));
sheet['!autofilter'] = {ref:sheet['!ref']};
X.utils.book_append_sheet(wb,sheet,'questions');
zip.addFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));
for(let n=1;n<=6;n++) {
  zip.addFile(`audio/${n}.wav`,original.readFile(`audio/p1_00${n%2+1}.wav`));
  zip.addFile(`images/${n}.png`,original.readFile(`images/p1_00${n%2+1}.png`));
}
zip.addFile('HUONG_DAN.txt',Buffer.from(`NHẬP NHANH PART 1
1. Sheet questions chỉ bắt buộc question_number (số câu) và correct_answer (A/B/C/D).
2. Mẫu chỉ có 3 cột: question_number, correct_answer, explanation. Thay đáp án mẫu A bằng đáp án thật.
3. Thay audio và ảnh mẫu: câu 1 dùng 1.mp3 và 1.jpg, câu 2 dùng 2.mp3 và 2.jpg…
   Cũng nhận WAV/M4A/OGG, PNG/JPEG/WEBP/GIF. Xóa file mẫu tương ứng khi thay định dạng để tránh trùng số.
4. Chọn Nhập nhanh Part 1 trên web, tải Excel và tất cả audio/ảnh; hoặc nén thành ZIP và tải lên.
5. Kiểm tra bảng ghép file rồi xác nhận nhập. Thiếu/trùng file sẽ báo rõ dòng, chưa lưu dữ liệu.
explanation (tùy chọn): nhập chung lời thoại A–D, bản dịch và giải thích trong một ô; có thể xuống dòng. Chỉ hiển thị sau khi nộp bài.
Không cần các cột A, B, C, D hoặc transcript. Hệ thống tự tạo nhãn A/B/C/D để chọn và chấm bài.
File cũ có các cột này vẫn nhập được. Không tự dịch hoặc tự nhận dạng giọng nói.
Audio mẫu là tiếng bíp, ảnh chỉ minh họa. Phải thay bằng nội dung thật.
Mỗi câu cần audio riêng. Audio chung nhiều câu vẫn dùng luồng ZIP cũ.
`, 'utf8'));
zip.writeZip(path.join(root,'toeic_listening_part1_quick.zip'));
console.log('Generated quick Part 1 template.');
