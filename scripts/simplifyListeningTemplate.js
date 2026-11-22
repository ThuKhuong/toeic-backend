// Produce a simplified copy; never overwrite the user's source ZIP.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Zip = require('adm-zip');
const XLSX = require('xlsx');
require.cache[require.resolve('../db')] = { exports: {} };
const { openArchive } = require('../src/modules/imports/archive');
const { parseArchive } = require('../src/modules/imports/parser');
const { validateItems } = require('../src/modules/imports/importService');
const source = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
const part = Number(process.argv[4] || 3);
assert([3, 4].includes(part), 'Chỉ hỗ trợ Part 3 hoặc Part 4');
const material = part === 3 ? 'đoạn hội thoại' : 'bài nói';
assert.notEqual(source.toLowerCase(), target.toLowerCase());
const zip = new Zip(source);
const removed = new Set(['duration', 'topic', 'speaker_count', 'accent']);
let expected = 0;
for (const entry of zip.getEntries().filter(e => e.entryName.endsWith('.xlsx'))) {
  const book = XLSX.read(entry.getData(), { type: 'buffer' });
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' });
    const keep = rows[0].map((h, i) => removed.has(h) ? -1 : i).filter(i => i >= 0);
    const compact = rows.map(row => keep.map(i => row[i] ?? ''));
    const sheet = XLSX.utils.aoa_to_sheet(compact);
    sheet['!cols'] = compact[0].map(h => ({ wch: /text|transcript|explanation/.test(h) ? 60 : 24 }));
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    book.Sheets[name] = sheet;
    expected += XLSX.utils.sheet_to_json(sheet).length;
  }
  zip.updateFile(entry.entryName, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}
zip.updateFile('HUONG_DAN.txt', Buffer.from('\uFEFF' + `MẪU IMPORT LISTENING PART ${part} — BẢN RÚT GỌN

Đã bỏ các cột duration, topic, speaker_count, accent.
Giữ nguyên tên sheet và tên cột; mỗi dòng là một câu hỏi.

- part_number: giữ ${part}.
- group_key: mỗi ${material} có một mã riêng; đúng 3 câu cùng mã.
- material_title: tên ${material}.
- audio_path: đường dẫn tương đối, ví dụ audio/p${part}_001.wav; lặp cùng đường dẫn cho 3 câu cùng nhóm.
- image_path: đường dẫn ảnh nếu có biểu đồ; không có thì để trống.
- transcript: bản chép lời tiếng Anh, dùng để ôn tập; điền giống nhau trong nhóm.
- question_text: câu hỏi tiếng Anh.
- choiceA, choiceB, choiceC, choiceD: bốn lựa chọn.
- correct_answer: A, B, C hoặc D.
- explanation: lời giải tiếng Việt; có thể thêm dịch câu hỏi và các lựa chọn trong cùng ô.
- order_in_test: thứ tự câu; có thể để trống. Không cần gõ số vào question_text.

Giải nén ZIP, sửa questions.xlsx và thay audio bằng file thật, rồi nén lại Excel cùng thư mục audio (và ảnh nếu có).
Audio đi kèm chỉ là tiếng bíp mẫu, không chứa lời đọc. Thay toàn bộ nội dung mẫu trước khi import.
Không dùng đường dẫn ổ đĩa như D:\\... trong Excel.
`, 'utf8'));
fs.mkdirSync(path.dirname(target), { recursive: true });
zip.writeZip(target);
// Validate a staging copy with the actual importer; do not write to PostgreSQL.
const { stagingDir } = require('../src/middlewares/upload');
const staging = path.join(stagingDir, require('node:crypto').randomUUID() + '.zip');
fs.copyFileSync(target, staging);
const context = openArchive({ path: staging, originalname: path.basename(target) });
try {
  const parsed = parseArchive(context, null);
  const items = validateItems(parsed.items, 'listening', parsed.errors);
  assert.equal(items.length, expected);
  assert(items.every(q => q.part_number === part));
  console.log(`PASS: ${items.length} câu Part ${part}, nhóm và đường dẫn media hợp lệ. ${target}`);
} finally { context.cleanup(); }
