const path = require('node:path');
const { readWorkbook, rows } = require('./archive');
const { error, text } = require('./importService');

function parseQuickPart6(context) {
  const file = context.workbooks[0];
  const workbook = readWorkbook(file);
  const errors = [], items = [], groups = new Map(), seen = new Set(), used = new Set();
  for (const sheet of workbook.SheetNames) {
    if (sheet !== 'questions') errors.push(error({file:file.rel,sheet}, 'sheet', 'Mẫu Part 6 chỉ cần sheet questions.'));
  }
  const images = context.files.filter(f => ['.png','.jpg','.jpeg','.webp','.gif'].includes(f.ext));
  for (const f of context.files) {
    if (!images.includes(f) && !context.workbooks.includes(f)) errors.push(error({file:f.rel},'file','Part 6 chỉ nhận Excel và ảnh đoạn văn.'));
  }
  for (const row of rows(workbook.Sheets.questions, {file:file.rel,sheet:'questions'})) {
    const number = Number(row.question_number);
    if (!Number.isSafeInteger(number) || number <= 0 || seen.has(number)) {
      errors.push(error(row._source,'question_number','Số câu phải là số nguyên dương và không trùng.')); continue;
    }
    seen.add(number);
    const base = number >= 131 ? 131 : 1;
    const start = base + Math.floor((number-base)/4)*4;
    const range = `${start}-${start+3}`;
    if (!groups.has(range)) groups.set(range, []);
    groups.get(range).push({...row,number});
  }
  for (const [range, questions] of groups) {
    const source = questions[0]._source;
    if (questions.length !== 4) errors.push(error(source,'question_number',`Nhóm ${range} phải đủ 4 câu.`));
    // Word/Windows filenames often contain an en dash instead of ASCII '-'.
    // Normalize only the lookup key; keep the actual path for media resolution
    // and retain the duplicate check when two spellings resolve to one group.
    const matches = images.filter(f => path.posix.parse(f.rel).name.normalize('NFKC')
      .trim().replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s*-\s*/g, '-') === range);
    if (matches.length > 1) errors.push(error(source,'image',`Nhóm ${range} có nhiều ảnh cùng tên. Chỉ giữ một ảnh.`));
    const contentValues = [...new Set(questions.map(q=>text(q.passage_text)).filter(Boolean))];
    if (contentValues.length > 1) errors.push(error(source,'passage_text',`Nhóm ${range} có nội dung đoạn văn không thống nhất. Chỉ cần nhập ở một dòng.`));
    if (!matches.length && !contentValues.length) errors.push(error(source,'image',`Thiếu ảnh ${range}.png. Hoặc dán đoạn văn vào cột passage_text ở một dòng của nhóm.`));
    let image = null;
    if (matches.length === 1) {
      used.add(matches[0].rel);
      try { image = context.media(matches[0].rel,file.rel,'image'); }
      catch(e) { errors.push(error(source,'image',e.message)); }
    }
    const passage = {title:`Part 6 - Câu ${range}`,content:contentValues[0] || '',image_url:image};
    for (const q of questions.sort((a,b)=>a.number-b.number)) {
      items.push({ _source:q._source, part_number:6, order_in_test:q.number,
        group_key:range, question_text:text(q.question_text) || `${q.number}.`,
        correct_answer:text(q.correct_answer).toUpperCase(), explanation:text(q.explanation),
        choices:['A','B','C','D'].map(label=>({label,text:text(q[label])})), passages:[{...passage}],
      });
    }
  }
  for (const f of images) if (!used.has(f.rel)) errors.push(error({file:f.rel},'image','Ảnh không khớp nhóm câu nào. Đặt tên như 131-134.png, 135-138.png.'));
  return {items,errors};
}

module.exports = {parseQuickPart6};
