const crypto = require('node:crypto');
const pool = require('../../../db');
const MAX_ROWS = 2000;
const text = value => String(value ?? '').trim();
function error(source, column, message) {
  return { index: source?.index ?? 0, file: source?.file || 'JSON', sheet: source?.sheet || 'items', row: source?.row ?? (source?.index ?? 0) + 1, column, error: message };
}
function invalid(errors, total = 0) {
  return Object.assign(new Error('Dữ liệu nhập có lỗi. Chưa lưu bản ghi nào.'), { status: 422, errors, total });
}
function validateItems(input, kind, initialErrors = []) {
  const errors = [...initialErrors];
  if (!Array.isArray(input) || !input.length || input.length > MAX_ROWS) throw invalid([...initialErrors, error(null, 'items', `Cần từ 1 đến ${MAX_ROWS} dòng dữ liệu.`)], input?.length || 0);
  const items = input.map((raw, index) => {
    const source = { index, ...raw?._source };
    const fail = (column, message) => errors.push(error(source, column, message));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { fail('items', 'Dòng phải là một object.'); return { _source: source }; }
    const q = { ...raw, _source: source, difficulty_level: 1 };
    if (kind === 'vocabulary') {
      q.word = text(raw.word); q.meaning_vi = text(raw.meaning_vi);
      if (!q.word || q.word.length > 255) fail('word', 'Từ vựng bắt buộc, tối đa 255 ký tự.');
      if (!q.meaning_vi) fail('meaning_vi', 'Thiếu nghĩa tiếng Việt.');
      q.topic_id = raw.topic_id == null || raw.topic_id === '' ? null : Number(raw.topic_id);
      if (q.topic_id !== null && (!Number.isSafeInteger(q.topic_id) || q.topic_id <= 0)) fail('topic_id', 'Mã chủ đề không hợp lệ.');
      if (raw.topic_name && !q.topic_id) fail('topic', 'Không tìm thấy chủ đề đã nhập.');
      if (q.tags != null && (!Array.isArray(q.tags) || q.tags.some(t => typeof t !== 'string'))) fail('tags', 'Tags phải là mảng chuỗi.');
      return q;
    }
    q.part_number = Number(raw.part_number);
    if (!(kind === 'listening' ? [1,2,3,4] : [5,6,7]).includes(q.part_number)) fail('part_number', 'Part không hợp lệ cho luồng nhập này.');
    q.question_text = text(raw.question_text); q.correct_answer = text(raw.correct_answer).toUpperCase(); q.explanation = text(raw.explanation) || null;
    if (q.part_number >= 3 && !q.question_text) fail('question_text', 'Thiếu nội dung câu hỏi.');
    const labels = q.part_number === 2 ? ['A','B','C'] : ['A','B','C','D'];
    q.choices = Array.isArray(raw.choices) ? raw.choices.map(c => ({ label: text(c?.label ?? c?.choice_label).toUpperCase(), text: text(c?.text ?? c?.choice_text) })) : [];
    if (q.choices.length !== labels.length || labels.some(label => q.choices.filter(c => c.label === label && c.text).length !== 1)) fail('choices', `Cần đúng các lựa chọn ${labels.join(', ')} và nội dung không rỗng.`);
    q.choices.sort((a,b) => a.label.localeCompare(b.label));
    if (!labels.includes(q.correct_answer)) fail('correct_answer', 'Đáp án đúng phải thuộc các lựa chọn của Part.');
    if (raw.order_in_test != null && (!Number.isInteger(Number(raw.order_in_test)) || Number(raw.order_in_test) <= 0)) fail('order_in_test', 'Thứ tự phải là số nguyên dương.');
    if (kind === 'listening') {
      if (!text(q.material?.audio_url)) fail('audio_url', 'Thiếu file audio.');
      if (q.part_number === 1 && !text(q.image_url)) fail('image_url', 'Part 1 bắt buộc có hình ảnh.');
      if (q.material) {
        q.material = { ...q.material, duration: Number(q.material.duration ?? 0), difficulty_level: q.difficulty_level };
        if (!Number.isInteger(q.material.duration) || q.material.duration < 0) fail('duration', 'Thời lượng audio phải là số giây nguyên không âm.');
      }
    }
    if (q.part_number >= 6) {
      q.passages = Array.isArray(raw.passages) ? raw.passages : raw.passage ? [raw.passage] : [];
      if (!q.passages.length || q.passages.length > (q.part_number === 6 ? 1 : 3)) fail('passage_keys', 'Part 6 cần 1 ngữ liệu; Part 7 cần từ 1 đến 3 ngữ liệu.');
      q.passages = q.passages.map(p => ({ title: text(p.title), content: text(p.content), image_url: text(p.image_url) || null, difficulty_level: 1 }));
      for (const p of q.passages) {
        if (!p.content && !p.image_url) fail('passage', 'Ngữ liệu cần nội dung hoặc hình ảnh.');
      }
      q.group_key = `${source.file || 'JSON'}:${q.part_number}:${text(raw.group_key || raw.passage_key) || JSON.stringify(q.passages)}`;
    } else if ([3,4].includes(q.part_number)) {
      q.group_key = `${source.file || 'JSON'}:${source.sheet}:${q.part_number}:${text(raw.group_key) || JSON.stringify(q.material)}`;
    }
    return q;
  });
  const groups = new Map();
  for (const q of items) if (q.group_key) { if (!groups.has(q.group_key)) groups.set(q.group_key, []); groups.get(q.group_key).push(q); }
  for (const group of groups.values()) {
    const first = group[0], part = first.part_number;
    const expected = part === 6 ? 4 : part <= 4 ? 3 : null;
    if ((expected && group.length !== expected) || (part === 7 && (group.length < 2 || group.length > 5 || (first.passages?.length > 1 && group.length !== 5)))) {
      for (const q of group) errors.push(error(q._source, 'group_key', expected ? `Nhóm Part ${part} cần đúng ${expected} câu.` : 'Part 7 cần 2–5 câu; nhóm nhiều ngữ liệu cần 5 câu.'));
    }
    for (const q of group) if (JSON.stringify(q.passages ?? q.material) !== JSON.stringify(first.passages ?? first.material)) errors.push(error(q._source, 'group_key', 'Các câu cùng nhóm phải dùng cùng ngữ liệu theo cùng thứ tự.'));
  }
  if (errors.length) throw invalid(errors, input.length);
  return items;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(k => k !== '_source').sort().map(k => [k, canonical(value[k])]));
  return value;
}
async function saveBatch(items, kind, context = {}) {
  const fingerprint = context.fingerprint || crypto.createHash('sha256').update(JSON.stringify(canonical(items))).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`import:${kind}:${fingerprint}`]);
    const previous = await client.query('SELECT row_count FROM import_batches WHERE kind=$1 AND fingerprint=$2', [kind, fingerprint]);
    if (previous.rows.length) { await client.query('COMMIT'); return { created: 0, skipped: previous.rows[0].row_count, duplicate: true, total: items.length, errors: [], items: [] }; }
    if (kind === 'vocabulary') {
      const ids = [...new Set(items.map(q => q.topic_id).filter(Boolean))];
      const found = new Set((await client.query('SELECT topic_id FROM vocabulary_topics WHERE topic_id=ANY($1::integer[])', [ids])).rows.map(r => r.topic_id));
      const errors = items.filter(q => q.topic_id && !found.has(q.topic_id)).map(q => error(q._source, 'topic_id', 'Chủ đề không tồn tại.'));
      if (errors.length) throw invalid(errors, items.length);
    }
    const results = [], materials = new Map(), groups = new Map();
    for (const q of items) {
      try {
        if (kind === 'vocabulary') {
          const fields = ['word','pronunciation','meaning_vi','meaning_en','part_of_speech','example_sentence','example_translation','audio_url','image_url','difficulty_level','tags','topic_id'];
          const row = (await client.query(`INSERT INTO vocabulary (${fields.join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`, fields.map(f => q[f] ?? null))).rows[0];
          results.push(row); continue;
        }
        let materialId = null, groupId = null, passageId = null;
        if (q.material) {
          const key = JSON.stringify(q.material);
          if (!materials.has(key)) {
            const m = q.material;
            const row = (await client.query(`INSERT INTO listening_materials(title,audio_url,transcript,duration,difficulty_level,topic,speaker_count,accent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING material_id`, [m.title || null,m.audio_url,m.transcript || null,m.duration,q.difficulty_level,m.topic || null,Number(m.speaker_count || 1),m.accent || null])).rows[0];
            materials.set(key,row.material_id);
          }
          materialId = materials.get(key);
        }
        if (q.group_key) {
          if (!groups.has(q.group_key)) {
            const g = (await client.query('INSERT INTO question_groups(title,part_number,material_id) VALUES ($1,$2,$3) RETURNING group_id', [q.passages?.[0]?.title || q.material?.title || null,q.part_number,materialId])).rows[0];
            let firstId = null;
            for (const [i,p] of (q.passages || []).entries()) {
              const row = (await client.query('INSERT INTO reading_passages(title,content,image_url,difficulty_level) VALUES ($1,$2,$3,$4) RETURNING passage_id', [p.title,p.content,p.image_url,p.difficulty_level])).rows[0];
              if (i === 0) firstId = row.passage_id;
              await client.query('INSERT INTO question_group_passages(group_id,passage_id,position) VALUES ($1,$2,$3)', [g.group_id,row.passage_id,i+1]);
            }
            groups.set(q.group_key,{groupId:g.group_id,passageId:firstId});
          }
          ({groupId,passageId} = groups.get(q.group_key));
        }
        const row = (await client.query(`INSERT INTO questions(question_text,question_type,part_number,passage_id,material_id,group_id,image_url,correct_answer,explanation,difficulty_level,order_in_test) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [q.question_text || null,kind === 'listening' ? 'listening' : 'reading',q.part_number,passageId,materialId,groupId,q.image_url || null,q.correct_answer,q.explanation,q.difficulty_level,q.order_in_test || null])).rows[0];
        for (const c of q.choices) await client.query('INSERT INTO answer_choices(question_id,choice_label,choice_text,is_correct) VALUES ($1,$2,$3,$4)', [row.question_id,c.label,c.text,c.label===q.correct_answer]);
        results.push({...row,choices:q.choices,passages:q.passages || []});
      } catch (e) {
        if (/^(22|23)/.test(e.code || '')) throw invalid([error(q._source, 'data', 'Dữ liệu không phù hợp ràng buộc database: ' + (e.constraint || e.column || e.code))], items.length);
        throw e;
      }
    }
    await client.query('INSERT INTO import_batches(kind,fingerprint,row_count) VALUES ($1,$2,$3)', [kind,fingerprint,results.length]);
    if (context.publish) await context.publish();
    await client.query('COMMIT');
    context.committed = true;
    return { created:results.length,skipped:0,total:items.length,errors:[],items:results };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
module.exports = { MAX_ROWS, text, error, invalid, validateItems, saveBatch };

