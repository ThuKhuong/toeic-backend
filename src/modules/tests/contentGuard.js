const pool = require('../../../db');

function conflict() {
  return Object.assign(new Error('Không thể thay đổi nội dung đề thi đã có lượt làm bài. Hãy tạo đề mới; bạn vẫn có thể ngừng xuất bản hoặc xóa đề để giữ lịch sử.'),
    { status: 409, code: 'HAS_ATTEMPTS' });
}

// Keep the lock until commit. startAttempt takes a share lock on the same row,
// so an attempt cannot start between this check and the content update.
async function assertTestsEditable(client, ids) {
  const testIds = [...new Set(ids.filter(id => id != null).map(Number))].sort((a, b) => a - b);
  if (!testIds.length) return;
  const tests = await client.query('SELECT test_id, deleted_at FROM tests WHERE test_id=ANY($1::integer[]) ORDER BY test_id FOR UPDATE', [testIds]);
  if (tests.rows.length !== testIds.length || tests.rows.some(t => t.deleted_at)) {
    throw Object.assign(new Error('Không tìm thấy đề thi hoặc đề đã bị xóa.'), { status: 404 });
  }
  if ((await client.query('SELECT 1 FROM user_test_attempts WHERE test_id=ANY($1::integer[]) LIMIT 1', [testIds])).rowCount) throw conflict();
}

async function assertQuestionsEditable(client, ids) {
  if (!ids.length) return;
  const questions = await client.query('SELECT question_id,test_id FROM questions WHERE question_id=ANY($1::integer[])', [ids]);
  await assertTestsEditable(client, questions.rows.map(q => q.test_id));
  // Also protect questions retained by an older attempt after reassignment.
  if ((await client.query(`SELECT 1 FROM attempt_questions WHERE question_id=ANY($1::integer[])
      UNION ALL SELECT 1 FROM user_answers WHERE question_id=ANY($1::integer[]) LIMIT 1`, [ids])).rowCount) throw conflict();
}

async function assertQuestionsDeletable(client, questions) {
  const testIds = [...new Set(questions.map(q => q.test_id).filter(Boolean))].sort((a, b) => a - b);
  if (testIds.length) {
    const tests = await client.query('SELECT test_id,deleted_at FROM tests WHERE test_id=ANY($1::integer[]) ORDER BY test_id FOR UPDATE', [testIds]);
    if (tests.rows.some(t => !t.deleted_at)) {
      throw Object.assign(new Error('Không thể xóa: câu hỏi đang thuộc đề thi chưa bị xóa. Hãy gỡ câu hỏi khỏi đề trước.'), { status: 409, code: 'IN_TEST' });
    }
  }
  const ids = questions.map(q => q.question_id);
  const used = await client.query(`SELECT 1 FROM user_test_attempts WHERE test_id=ANY($1::integer[])
    UNION ALL SELECT 1 FROM attempt_questions WHERE question_id=ANY($2::integer[])
    UNION ALL SELECT 1 FROM user_answers WHERE question_id=ANY($2::integer[]) LIMIT 1`, [testIds, ids]);
  if (used.rowCount) {
    throw Object.assign(new Error('Không thể xóa: câu hỏi cần được giữ lại để bảo toàn lịch sử làm bài, kể cả khi đề thi đã bị xóa.'), { status: 409, code: 'HAS_ATTEMPTS' });
  }
}

async function assertMaterialEditable(client, id) {
  const questions = await client.query(`SELECT q.question_id FROM questions q
    LEFT JOIN question_groups g ON g.group_id=q.group_id
    WHERE q.material_id=$1 OR g.material_id=$1`, [id]);
  await assertQuestionsEditable(client, questions.rows.map(q => q.question_id));
}

async function assertPassageEditable(client, id) {
  const questions = await client.query(`SELECT q.question_id FROM questions q
    WHERE q.passage_id=$1 OR q.group_id IN
      (SELECT group_id FROM question_group_passages WHERE passage_id=$1)`, [id]);
  await assertQuestionsEditable(client, questions.rows.map(q => q.question_id));
}

async function withContentTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { assertTestsEditable, assertQuestionsEditable, assertQuestionsDeletable, assertMaterialEditable, assertPassageEditable, withContentTransaction };
