const pool = require('../../../db');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function id(value) {
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    fail(400, 'ID không hợp lệ.');
  }
  return Number(value);
}
function text(value, name, limit, required = false) {
  if (value != null && typeof value !== 'string') fail(400, `${name} không hợp lệ.`);
  const result = (value ?? '').trim();
  if ((required && !result) || result.length > limit) fail(400, `${name}${required ? ' bắt buộc,' : ''} tối đa ${limit} ký tự.`);
  return result || null;
}
function wordInput(body = {}) {
  return {
    word: text(body.word, 'Từ vựng', 255, true),
    meaning_vi: text(body.meaning_vi, 'Nghĩa tiếng Việt', 3000, true),
    pronunciation: text(body.pronunciation, 'Phiên âm', 255),
    part_of_speech: text(body.part_of_speech, 'Loại từ', 50),
    meaning_en: text(body.meaning_en, 'Nghĩa tiếng Anh', 3000),
    example_sentence: text(body.example_sentence, 'Ví dụ', 3000),
    example_translation: text(body.example_translation, 'Dịch ví dụ', 3000),
    topic_id: body.topic_id == null ? null : id(body.topic_id),
  };
}
async function checkTopic(client, userId, topicId) {
  if (topicId == null) return;
  const result = await client.query('SELECT topic_id FROM vocabulary_topics WHERE topic_id=$1 AND owner_user_id=$2 FOR KEY SHARE', [topicId, userId]);
  if (!result.rows.length) fail(404, 'Chủ đề không tồn tại trong sổ từ của bạn.');
}
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') fail(409, 'Bạn đã có chủ đề với tên này.');
    if (error.code === '23503') fail(409, 'Dữ liệu đang được sử dụng. Vui lòng tải lại rồi thử lại.');
    throw error;
  } finally { client.release(); }
}

module.exports = {
  wordInput,
  async list(userId) {
    const rows = (await pool.query('SELECT * FROM vocabulary WHERE owner_user_id=$1 ORDER BY topic_id NULLS LAST, lower(word), vocab_id', [userId])).rows;
    return { success: true, data: rows };
  },
  async topics(userId) {
    return (await pool.query(`SELECT t.topic_id, t.name AS topic_name, COUNT(v.vocab_id)::integer AS word_count
      FROM vocabulary_topics t LEFT JOIN vocabulary v ON v.topic_id=t.topic_id AND v.owner_user_id=$1
      WHERE t.owner_user_id=$1 GROUP BY t.topic_id ORDER BY lower(t.name), t.topic_id`, [userId])).rows;
  },
  async createWord(userId, body) {
    const data = wordInput(body);
    return transaction(async client => {
      await checkTopic(client, userId, data.topic_id);
      const fields = Object.keys(data);
      return (await client.query(`INSERT INTO vocabulary (owner_user_id, ${fields.join(',')})
        VALUES ($1, ${fields.map((_, index) => '$' + (index + 2)).join(',')}) RETURNING *`, [userId, ...Object.values(data)])).rows[0];
    });
  },
  async updateWord(userId, rawId, body) {
    const vocabId = id(rawId), data = wordInput(body);
    return transaction(async client => {
      await checkTopic(client, userId, data.topic_id);
      const owned = await client.query('SELECT * FROM vocabulary WHERE vocab_id=$1 AND owner_user_id=$2 FOR UPDATE', [vocabId, userId]);
      if (!owned.rows.length) fail(404, 'Không tìm thấy từ trong sổ của bạn.');
      const fields = Object.keys(data);
      const result = await client.query(`UPDATE vocabulary SET ${fields.map((field, index) => `${field}=$${index + 3}`).join(',')}, updated_at=NOW()
        WHERE vocab_id=$1 AND owner_user_id=$2 RETURNING *`, [vocabId, userId, ...Object.values(data)]);
      // A changed meaning needs a fresh review, while preserving saved status/history.
      const previous = owned.rows[0];
      if (previous.word !== data.word || previous.meaning_vi !== data.meaning_vi || previous.meaning_en !== data.meaning_en) {
        await client.query(`UPDATE user_vocabulary_learning SET status=CASE WHEN learned_at IS NULL THEN 'new' ELSE 'learning' END,
          needs_review=(learned_at IS NOT NULL) WHERE user_id=$1 AND vocab_id=$2`, [userId, vocabId]);
      }
      return result.rows[0];
    });
  },
  async deleteWord(userId, rawId) {
    return transaction(async client => {
      const result = await client.query('DELETE FROM vocabulary WHERE vocab_id=$1 AND owner_user_id=$2 RETURNING vocab_id', [id(rawId), userId]);
      if (!result.rows.length) fail(404, 'Không tìm thấy từ trong sổ của bạn.');
      return { deleted: true };
    });
  },
  async createTopic(userId, body) {
    const name = text(body.name, 'Tên chủ đề', 100, true).replace(/\s+/g, ' ');
    return transaction(async client => (await client.query(`INSERT INTO vocabulary_topics (name,owner_user_id)
      VALUES ($1,$2) RETURNING topic_id,name AS topic_name`, [name, userId])).rows[0]);
  },
  async updateTopic(userId, rawId, body) {
    const name = text(body.name, 'Tên chủ đề', 100, true).replace(/\s+/g, ' ');
    return transaction(async client => {
      const result = await client.query(`UPDATE vocabulary_topics SET name=$1 WHERE topic_id=$2 AND owner_user_id=$3
        RETURNING topic_id,name AS topic_name`, [name, id(rawId), userId]);
      if (!result.rows.length) fail(404, 'Không tìm thấy chủ đề của bạn.');
      return result.rows[0];
    });
  },
  async deleteTopic(userId, rawId) {
    const topicId = id(rawId);
    return transaction(async client => {
      const topic = await client.query('SELECT topic_id FROM vocabulary_topics WHERE topic_id=$1 AND owner_user_id=$2 FOR UPDATE', [topicId, userId]);
      if (!topic.rows.length) fail(404, 'Không tìm thấy chủ đề của bạn.');
      await client.query('UPDATE vocabulary SET topic_id=NULL WHERE topic_id=$1 AND owner_user_id=$2', [topicId, userId]);
      await client.query('DELETE FROM vocabulary_topics WHERE topic_id=$1 AND owner_user_id=$2', [topicId, userId]);
      return { deleted: true };
    });
  },
};
