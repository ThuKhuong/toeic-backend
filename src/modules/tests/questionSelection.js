const invalid = message => Object.assign(new Error(message), { status: 400 });

function eligibility({ part_number, source_set }) {
  const part = Number(part_number);
  if (!Number.isInteger(part) || part < 1 || part > 7) throw invalid('Chọn Part từ 1 đến 7.');
  const params = [part];
  let where = `q.test_id IS NULL AND q.part_number=$1 AND (q.question_type=$2 OR
    (q.question_type IS NULL AND ${part <= 4 ? 'q.material_id' : 'q.passage_id'} IS NOT NULL))`;
  params.push(part <= 4 ? 'listening' : 'reading');
  if (part <= 4) where += ' AND q.material_id IS NOT NULL';
  if (source_set === '__unassigned__') where += ' AND q.source_set IS NULL';
  else if (source_set) { params.push(String(source_set).trim()); where += ` AND lower(q.source_set)=lower($${params.length})`; }
  return { where, params };
}

function groupKey(q, part) {
  if (![3,4,6,7].includes(Number(part))) return `question:${q.question_id}`;
  return q.group_id ? `group:${q.group_id}` : [3,4].includes(Number(part)) && q.material_id ? `audio:${q.material_id}` : q.passage_id ? `passage:${q.passage_id}` : `question:${q.question_id}`;
}

function chooseRows(rows, part, count, mode = 'ordered') {
  if (!Number.isInteger(count) || count < 1 || count > 200) throw invalid('Số câu phải từ 1 đến 200.');
  if (!['ordered', 'random'].includes(mode)) throw invalid('Cách lấy câu hỏi không hợp lệ.');
  const groups = new Map();
  for (const q of rows) {
    const key = groupKey(q, part);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const candidates = [...groups.values()];
  if (mode === 'random') {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = require('node:crypto').randomInt(i + 1);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }
  // Select whole passages/audio groups, including when their sizes differ.
  const sums = new Map([[0, []]]);
  for (const group of candidates) {
    for (const [size, selection] of [...sums.entries()].sort((a,b)=>b[0]-a[0])) {
      const next = size + group.length;
      if (next <= count && !sums.has(next)) sums.set(next, [...selection, group]);
    }
    if (sums.has(count)) break;
  }
  if (!sums.has(count)) throw invalid(`Không thể lấy đủ ${count} câu phù hợp. Hãy đổi số câu hoặc bộ đề; các nhóm audio/đoạn văn cần được chọn nguyên nhóm.`);
  return sums.get(count).flat().map(q => q.question_id);
}

async function selectQuestions(client, options) {
  const { where, params } = eligibility(options);
  const result = await client.query(`SELECT q.question_id,q.group_id,q.material_id,q.passage_id
    FROM questions q WHERE ${where}
    ORDER BY q.source_set NULLS LAST, COALESCE(q.source_question_number,q.order_in_test) NULLS LAST,q.question_id
    FOR UPDATE OF q`, params);
  if (options.question_ids) {
    const ids=options.question_ids;
    if(!Array.isArray(ids) || !ids.length || ids.length>200 || ids.some(id=>!Number.isSafeInteger(id)) || new Set(ids).size!==ids.length) throw invalid('Danh sách câu hỏi không hợp lệ.');
    const chosen=result.rows.filter(q=>ids.includes(q.question_id));
    if(chosen.length!==ids.length) throw invalid('Một số câu đã được gán hoặc không thuộc bộ đề/Part đã chọn. Vui lòng tải lại danh sách.');
    const keys=new Set(chosen.map(q=>groupKey(q,options.part_number)));
    if(result.rows.some(q=>keys.has(groupKey(q,options.part_number)) && !ids.includes(q.question_id))) throw invalid('Chọn đầy đủ các câu trong cùng nhóm audio hoặc đoạn văn.');
    return chosen.map(q=>q.question_id);
  }
  return chooseRows(result.rows, Number(options.part_number), Number(options.total_questions), options.selection_mode || 'ordered');
}

module.exports = { eligibility, chooseRows, selectQuestions };
