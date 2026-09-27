// Rebuild the downloadable templates and validate them without connecting to PostgreSQL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const Zip = require('adm-zip');
require.cache[require.resolve('../db')] = { exports: {} };
const { openArchive } = require('../src/modules/imports/archive');
const { parseArchive } = require('../src/modules/imports/parser');
const { validateItems } = require('../src/modules/imports/importService');
const { stagingDir } = require('../src/middlewares/upload');
const out = path.resolve(__dirname, '../../toeic_admin_vite/public/templates');
const assets = path.join(__dirname, 'template-assets');
fs.mkdirSync(assets, { recursive: true });
const imageFile = path.join(assets, 'sample.png');
// Preserve the existing sample image; this is a layout reference, not a new test item.
if (!fs.existsSync(imageFile)) {
  const old = new Zip(path.join(out, 'toeic_listening_part1_sample.zip'));
  const entry = old.getEntries().find(e => /\.png$/i.test(e.entryName));
  if (!entry) throw new Error('Missing template-assets/sample.png');
  fs.writeFileSync(imageFile, entry.getData());
}
const image = fs.readFileSync(imageFile);
function tone() {
  const rate = 16000, samples = rate, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) b.writeInt16LE(Math.round(1800 * Math.sin(2 * Math.PI * 440 * n / rate) * Math.sin(Math.PI * n / samples)), 44 + n * 2);
  return b;
}
function workbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const cleanRows = rows.map(({difficulty_level, ...row}) => row);
    const sheet = XLSX.utils.json_to_sheet(cleanRows);
    sheet['!cols'] = Object.keys(cleanRows[0]).map(k => ({ wch: /text|content|transcript|explanation/.test(k) ? 60 : Math.max(k.length + 2, 22) }));
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const common = `BỘ KHUNG NHẬP DỮ LIỆU TOEIC — KHÔNG PHẢI ĐỀ THI HOÀN CHỈNH

1. Giải nén ZIP vào một thư mục trên máy tính.
2. Mở file .xlsx bằng Excel; giữ nguyên tên sheet và tên cột ở dòng đầu.
3. Thay TOÀN BỘ dòng mẫu bằng câu hỏi, lựa chọn, đáp án và lời giải của bạn.
   Không chỉ thêm câu thật phía dưới rồi để lại các dòng mẫu.
4. Thay ảnh/audio mẫu bằng tài nguyên phù hợp với câu hỏi. Audio WAV mẫu chỉ là
   tiếng bíp kiểm tra đường dẫn, KHÔNG chứa lời đọc. Ảnh chỉ minh họa cấu trúc.
   Có thể dùng MP3/WAV/M4A/OGG và JPG/JPEG/PNG/WEBP/GIF; cập nhật tên file trong Excel.
5. Lưu và đóng Excel. Nén file Excel cùng thư mục audio/images và hướng dẫn này
   thành ZIP mới, rồi chọn Import ZIP Excel ở đúng Part trên admin.

QUY TẮC CHUNG
- Không thêm sheet ghi chú vào workbook Listening: mọi sheet đều được đọc như câu hỏi.
- Đường dẫn media tương đối, ví dụ audio/group_01.wav; không dùng C:\\... hoặc D:\\...
- correct_answer: A/B/C/D (Part 2 chỉ A/B/C).
- explanation: lời giải; order_in_test: số thứ tự nguyên dương, có thể để trống.
- group_key: mã nhóm riêng, ví dụ p3_001, p3_002. Không dùng lại cho hai nhóm khác nhau.
- Mỗi lần tối đa 2000 câu. Có lỗi thì cả lần nhập không được lưu.
- ZIP đã nhập thành công sẽ không được nhập lại y hệt. Dữ liệu mẫu cũng sẽ được
  lưu nếu bạn import nguyên ZIP; hãy thay dữ liệu trước khi dùng chính thức.
- HUONG_DAN.txt được bỏ qua khi import. Không bỏ thêm PDF/Word hoặc file không hỗ trợ.
`;
function saveZip(name, sheets, files, instructions, part, expected) {
  const z = new Zip();
  z.addFile('questions.xlsx', workbook(sheets));
  z.addFile('HUONG_DAN.txt', Buffer.from('\uFEFF' + common + '\n' + instructions, 'utf8'));
  for (const [name, bytes] of Object.entries(files)) z.addFile(name, bytes);
  const buffer = z.toBuffer();
  const temp = path.join(stagingDir, crypto.randomUUID() + '.zip');
  fs.writeFileSync(temp, buffer);
  const context = openArchive({ path: temp, originalname: name });
  try {
    const parsed = parseArchive(context, part);
    const items = validateItems(parsed.items, part ? 'reading' : 'listening', parsed.errors);
    assert.equal(items.length, expected);
    assert(!context.files.some(f => f.rel.endsWith('.txt')));
  } finally { context.cleanup(); }
  fs.writeFileSync(path.join(out, name), buffer);
  console.log(`PASS ${name}: ${expected} câu, đường dẫn media và nhóm hợp lệ`);
  return z;
}
const listeningHeaders = ['part_number','group_key','material_title','audio_path','image_path','transcript','question_text','choiceA','choiceB','choiceC','choiceD','correct_answer','explanation','order_in_test','duration','topic','speaker_count','accent'];
const listeningZips = [];
for (let part = 1; part <= 4; part++) {
  const rows = [], files = {};
  const count = part >= 3 ? 3 : 1;
  for (let group = 1; group <= 2; group++) {
    const key = `p${part}_${String(group).padStart(3, '0')}`;
    files[`audio/${key}.wav`] = tone();
    if (part === 1) files[`images/${key}.png`] = image;
    for (let i = 1; i <= count; i++) {
      const values = [part, part >= 3 ? key : '', `[MẪU] ${key} - thay tên bài nghe`, `audio/${key}.wav`, part === 1 ? `images/${key}.png` : '', '[THAY BẰNG BẢN CHÉP LỜI AUDIO THẬT]', `[MẪU] ${key} - câu ${i}: thay nội dung câu hỏi`, 'Thay lựa chọn A', 'Thay lựa chọn B', 'Thay lựa chọn C', part === 2 ? '' : 'Thay lựa chọn D', 'A', 'Thay lời giải và chỉnh đáp án đúng theo câu hỏi.', rows.length + 1, 1, 'Office', part === 3 ? 2 : 1, ''];
      rows.push(Object.fromEntries(listeningHeaders.map((key, n) => [key, values[n]])));
    }
  }
  if (part === 2) {
    Object.assign(rows[0], {
      material_title: '[MẪU] Meeting time - thay audio trước khi import',
      question_text: 'When does the meeting start?',
      choiceA: 'At nine o\'clock.', choiceB: 'In the conference room.', choiceC: 'Mr. Smith will lead it.',
      correct_answer: 'A',
      transcript: 'When does the meeting start? (A) At nine o\'clock. (B) In the conference room. (C) Mr. Smith will lead it.',
      explanation: 'DỊCH CÂU HỎI\nCuộc họp bắt đầu lúc mấy giờ?\n\nDỊCH CÁC LỰA CHỌN\nA. Lúc 9 giờ.\nB. Trong phòng họp.\nC. Ông Smith sẽ chủ trì cuộc họp.\n\nGIẢI THÍCH\nĐáp án A đúng vì “When” hỏi về thời gian. B nói về địa điểm; C nói về người chủ trì.'
    });
    Object.assign(rows[1], {
      material_title: '[MẪU] Report location - thay audio trước khi import',
      question_text: 'Where can I find the sales report?',
      choiceA: 'Last Friday.', choiceB: 'On the shared drive.', choiceC: 'About twenty pages.',
      correct_answer: 'B',
      transcript: 'Where can I find the sales report? (A) Last Friday. (B) On the shared drive. (C) About twenty pages.',
      explanation: 'DỊCH CÂU HỎI\nTôi có thể tìm báo cáo doanh số ở đâu?\n\nDỊCH CÁC LỰA CHỌN\nA. Thứ Sáu tuần trước.\nB. Trên ổ đĩa dùng chung.\nC. Khoảng hai mươi trang.\n\nGIẢI THÍCH\nĐáp án B chỉ nơi lưu báo cáo, phù hợp với câu hỏi “Where”. A trả lời thời gian; C trả lời số trang.'
    });
  }
  listeningZips.push(saveZip(`toeic_listening_part${part}_sample.zip`, { questions: rows }, files,
    `PART ${part}\n${part === 1 ? 'Mỗi câu phải có ảnh và audio riêng; đủ A–D.' : part === 2 ? 'Mỗi câu có audio, chỉ A–C. Cột choiceD phải để trống.' : 'Mỗi group_key có đúng 3 câu. Copy cả nhóm 3 dòng để thêm nhóm mới.\nAudio, tiêu đề, transcript và thông tin chung phải giống nhau trong nhóm.\nHai nhóm mẫu dùng hai audio khác nhau. image_path tùy chọn khi có biểu đồ.'}\n\nCÁC CỘT\npart_number: giữ đúng ${part}.\nmaterial_title: tên bài nghe; audio_path/image_path: đường dẫn media.\ntranscript: lời thoại; question_text: câu hỏi; choiceA–D: lựa chọn.\nduration: thời lượng giây nguyên; topic: chủ đề; speaker_count: số người nói; accent: giọng đọc.\n`, null, rows.length));
}
// Compatibility download containing the four separate, independently editable workbooks.
const all = new Zip();
listeningZips.forEach((z, i) => { for (const e of z.getEntries()) if (!e.isDirectory) all.addFile(`part${i + 1}/${e.entryName}`, e.getData()); });
fs.writeFileSync(path.join(out, 'toeic_listening_sample.zip'), all.toBuffer());
const combinedTemp = path.join(stagingDir, crypto.randomUUID() + '.zip');
fs.writeFileSync(combinedTemp, all.toBuffer());
const combinedContext = openArchive({ path: combinedTemp, originalname: 'toeic_listening_sample.zip' });
try {
  const parsed = parseArchive(combinedContext, null);
  assert.equal(validateItems(parsed.items, 'listening', parsed.errors).length, 16);
  console.log('PASS toeic_listening_sample.zip: 16 câu, 4 workbook độc lập.');
} finally { combinedContext.cleanup(); }
const q = (keys, group, index, text, choices, correct, explanation) => ({ passage_keys: keys, group_key: group, question_text: text, A: choices[0], B: choices[1], C: choices[2], D: choices[3], correct_answer: correct, explanation, order_in_test: index });
const passage = (key, title, content) => ({ key, title, content, image_url: '' });
const readingHelp = `READING: GIỮ HAI SHEET passages VÀ questions
passages: key (mã duy nhất), title (tiêu đề), content (nội dung), image_url (ảnh nếu có).
questions: passage_keys (mã ngữ liệu theo thứ tự, ngăn bằng |), group_key (mã nhóm),
question_text, A/B/C/D, correct_answer, explanation, order_in_test.
Muốn dùng ảnh: thêm ảnh vào images và điền image_url, ví dụ images/my_passage.png.
Ảnh example.png kèm theo chỉ là tham khảo đường dẫn, chưa được liên kết trong Excel.
`;
saveZip('toeic_part6_sample.zip', { passages: [passage('p6_001', 'Office notice', 'Dear colleagues,\nOur office will be (1) ____ on Friday for maintenance. Please (2) ____ all important files before leaving on Thursday. The work is expected to finish (3) ____ Friday evening. (4) ____\nThank you for your cooperation.')], questions: [
  q('p6_001','p6_group_001',1,'Choose the best word for blank (1).',['closed','close','closing','closes'],'A','will be + tính từ/phân từ: closed.'),
  q('p6_001','p6_group_001',2,'Choose the best word for blank (2).',['save','saves','saved','saving'],'A','Please + động từ nguyên mẫu.'),
  q('p6_001','p6_group_001',3,'Choose the best word for blank (3).',['by','at','on','into'],'A','by Friday evening: chậm nhất vào tối thứ Sáu.'),
  q('p6_001','p6_group_001',4,'Choose the best sentence for blank (4).',['Normal operations will resume on Monday.','The menu includes fresh fruit.','Tickets are sold at the museum.','Our store sells winter coats.'],'A','Câu bổ sung thông tin hoạt động trở lại sau bảo trì.')
] }, { 'images/example.png': image }, readingHelp + '\nPart 6: mỗi nhóm đúng 4 câu, một passage_key. Copy cả ngữ liệu và 4 dòng khi thêm nhóm.\n', 6, 4);
const passages = [], questions = [];
for (let n = 1; n <= 3; n++) {
  const keys = [];
  for (let i = 1; i <= n; i++) {
    const key = `p7_${n}_${i}`; keys.push(key);
    passages.push(passage(key, `[MẪU] Nhóm ${n} - ngữ liệu ${i}`, `[THAY BẰNG NGỮ LIỆU ${i} CỦA NHÓM ${n}: EMAIL, THÔNG BÁO, QUẢNG CÁO HOẶC BÀI VIẾT]`));
  }
  for (let i = 1; i <= (n === 1 ? 2 : 5); i++) questions.push(q(keys.join('|'), `p7_group_${n}`, questions.length + 1, `[MẪU] Nhóm ${n} - câu ${i}: thay câu hỏi`, ['Thay lựa chọn A','Thay lựa chọn B','Thay lựa chọn C','Thay lựa chọn D'], 'A', 'Thay lời giải và chỉnh đáp án đúng.'));
}
saveZip('toeic_part7_sample.zip', { passages, questions }, { 'images/example.png': image }, readingHelp + '\nPart 7 có sẵn 3 nhóm minh họa: 1 ngữ liệu/2 câu, 2 ngữ liệu/5 câu, 3 ngữ liệu/5 câu.\nChỉ giữ nhóm cần dùng hoặc copy cả nhóm để thêm. Cùng nhóm phải dùng cùng passage_keys.\n', 7, 12);
const part5 = [{ question_text: 'Please ____ the report before Friday.', A: 'submit', B: 'submits', C: 'submitted', D: 'submitting', correct_answer: 'A', explanation: 'Please + động từ nguyên mẫu.' }];
validateItems(part5.map(r => ({ ...r, part_number: 5, choices: ['A','B','C','D'].map(label => ({ label, text: r[label] })) })), 'reading');
fs.writeFileSync(path.join(out, 'toeic_part5_template.xlsx'), workbook({ questions: part5 }));
console.log('PASS toeic_part5_template.xlsx: 1 câu. Part 5 dùng Excel trực tiếp, không ZIP.');
