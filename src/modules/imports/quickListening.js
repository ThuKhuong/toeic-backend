const path = require('node:path');
const { rows } = require('./archive');
const { error } = require('./importService');

// Explicit question numbers, never infer them from question text or row position.
function quickRows(context, workbook, file, part, errors, questionSheet = 'questions') {
  if ([1,2].includes(part)) return part1Rows(context, workbook, file, errors, part, questionSheet);
  for (const sheet of workbook.SheetNames) if (![questionSheet,'groups'].includes(sheet)) errors.push(error({file,sheet},'sheet','Mẫu nhanh chỉ nhận một sheet câu hỏi và sheet groups.'));
  const source = { file, sheet: questionSheet };
  const input = rows(workbook.Sheets[questionSheet], source);
  const groups = new Map();
  if (workbook.Sheets.groups) for (const r of rows(workbook.Sheets.groups, { file, sheet: 'groups' })) {
    const key = String(r.question_range || '').trim();
    if (!/^\d+-\d+$/.test(key) || groups.has(key)) errors.push(error(r._source, 'question_range', 'Khoảng câu không hợp lệ hoặc bị trùng; ví dụ 71-73.'));
    groups.set(key, r);
  }
  const audio = context.files.filter(f => ['.mp3', '.wav', '.m4a', '.ogg'].includes(f.ext)).map(f => {
    const match = path.posix.basename(f.rel, f.ext).match(/^(\d+)-(\d+)$/);
    if (!match) errors.push(error({file:f.rel},'audio','Audio mẫu nhanh cần tên khoảng câu, ví dụ 71-73.mp3.'));
    return match ? { ...f, start: Number(match[1]), end: Number(match[2]), key: `${Number(match[1])}-${Number(match[2])}` } : null;
  }).filter(Boolean);
  // The workbook determines group membership; filenames only locate media.
  for (const a of audio) {
    const numbers = [...new Set(input.map(r => Number(r.question_number)).filter(n => n >= a.start && n <= a.end))].sort((x,y) => x-y);
    a.questionKey = numbers.length ? `${numbers[0]}-${numbers[numbers.length - 1]}` : a.key;
    a.valid = numbers.length === 3 && numbers[1] === numbers[0] + 1 && numbers[2] === numbers[1] + 1;
  }
  const images = context.files.filter(f => ['.jpg','.jpeg','.png','.webp','.gif'].includes(f.ext));
  const seen = new Set(), used = new Set();
  const output = input.map(r => {
    const n = Number(r.question_number);
    if (!Number.isSafeInteger(n) || n <= 0 || seen.has(n)) errors.push(error(r._source, 'question_number', 'Số câu phải là số nguyên dương và không được trùng.'));
    seen.add(n);
    const matches = audio.filter(a => n >= a.start && n <= a.end);
    if (matches.length !== 1) errors.push(error(r._source, 'audio', matches.length ? `Câu ${n} khớp nhiều audio; kiểm tra khoảng câu chồng nhau.` : `Không tìm thấy audio cho câu ${n}. Đặt tên như 71-73.mp3.`));
    const a = matches.length === 1 ? matches[0] : null;
    if (a && !a.valid) errors.push(error(r._source, 'audio', 'Mỗi audio Part 3–4 phải ghép đúng 3 câu liên tiếp có trong Excel.'));
    const groupKey = a && (groups.has(a.questionKey) ? a.questionKey : a.key);
    if (a) { used.add(a.key); used.add(groupKey); }
    const g = groups.get(groupKey) || {};
    const matchedImages = a ? images.filter(f => [a.key, a.questionKey].includes(path.posix.basename(f.rel, f.ext))) : [];
    if (!g.image_path && !r.image_path && matchedImages.length > 1) errors.push(error(r._source, 'image', 'Có nhiều ảnh cho cùng nhóm câu; chỉ giữ một ảnh hoặc chỉ định image_path.'));
    return { ...r, part_number: part, group_key: a?.questionKey || `invalid-${n}`, audio_path: a?.rel || '',
      material_title: (part === 3 && g.material_title) || `Part ${part} - Câu ${a?.questionKey || n}`,
      transcript: g.transcript || '', image_path: r.image_path || g.image_path || (matchedImages.length === 1 ? matchedImages[0].rel : ''), order_in_test: n };
  });
  for (const [key, g] of groups) if (!used.has(key)) errors.push(error(g._source, 'question_range', `Nhóm ${key} không khớp câu hỏi/audio nào.`));
  for (const a of audio) if (!used.has(a.key)) errors.push(error({ file: a.rel }, 'audio', `Audio ${a.key} không có câu hỏi tương ứng.`));
  return output;
}
function part1Rows(context, workbook, file, errors, part = 1, questionSheet = 'questions') {
  for (const sheet of workbook.SheetNames) if (sheet !== questionSheet) errors.push(error({file,sheet}, 'sheet', `Part ${part} chỉ cần một sheet câu hỏi.`));
  const used = new Set(), seen = new Set();
  const media = context.files.filter(f => ['.mp3','.wav','.m4a','.ogg','.jpg','.jpeg','.png','.webp','.gif'].includes(f.ext));
  const indexed = media.map(f => ({...f, number: /^\d+$/.test(path.posix.basename(f.rel, f.ext)) ? Number(path.posix.basename(f.rel, f.ext)) : null}));
  const result = rows(workbook.Sheets[questionSheet], {file,sheet:questionSheet}).map(r => {
    const n = Number(r.question_number);
    if (!Number.isSafeInteger(n) || n <= 0 || seen.has(n)) errors.push(error(r._source,'question_number','Số câu phải là số nguyên dương, không trùng.'));
    seen.add(n);
    const find = (type, extensions) => {
      const matches = indexed.filter(f => f.number === n && extensions.includes(f.ext));
      if (matches.length !== 1) errors.push(error(r._source,type, matches.length ? `Câu ${n} có nhiều file ${type} cùng số. Chỉ giữ một file.` : `Thiếu ${type} câu ${n}; đặt tên ${n}.${type === 'audio' ? 'mp3' : 'jpg'}.`));
      if (matches.length !== 1) return '';
      used.add(matches[0].rel); return matches[0].rel;
    };
    return {...r, part_number:part, group_key:'', order_in_test:n,
      audio_path:find('audio',['.mp3','.wav','.m4a','.ogg']), image_path:part === 1 ? find('image',['.jpg','.jpeg','.png','.webp','.gif']) : '',
      material_title:`Part ${part} - Câu ${n}`, question_text:r.question_text || '',
      A:String(r.A || '').trim() || 'A', B:String(r.B || '').trim() || 'B', C:String(r.C || '').trim() || 'C', D:part === 1 ? String(r.D || '').trim() || 'D' : String(r.D || '').trim()};
  });
  for (const f of media) if (!used.has(f.rel)) errors.push(error({file:f.rel},'file','File không ghép được với câu nào. Đặt tên bằng số câu và kiểm tra Excel.'));
  return result;
}
module.exports = { quickRows };
