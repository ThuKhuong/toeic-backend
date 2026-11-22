const pool = require('../../../db');

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function positiveId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
    fail(400, 'ID không hợp lệ.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) fail(400, 'ID không hợp lệ.');
  return id;
}

function selection(body = {}) {
  const scope = body.scope ?? 'all';
  if (!['all', 'saved', 'review'].includes(scope)) fail(400, 'Phạm vi học không hợp lệ.');
  const topicId = body.topic_id == null ? null : positiveId(body.topic_id);
  const unassigned = body.unassigned === true;
  if (body.unassigned != null && typeof body.unassigned !== 'boolean') fail(400, 'Bộ lọc chủ đề không hợp lệ.');
  if (unassigned && topicId !== null) fail(400, 'Bộ lọc chủ đề bị trùng.');
  const count = body.count == null ? 10 : positiveId(body.count);
  if (count > 20) fail(400, 'Mỗi lượt tối đa 20 từ.');
  let ids = null;
  if (body.vocab_ids != null) {
    if (!Array.isArray(body.vocab_ids) || !body.vocab_ids.length || body.vocab_ids.length > 50) {
      fail(400, 'Danh sách từ cần có từ 1 đến 50 từ.');
    }
    ids = [...new Set(body.vocab_ids.map(positiveId))].sort((a, b) => a - b);
  }
  return { scope, topicId, count, ids, unassigned, key: 'personal:' + JSON.stringify([scope, topicId, ids, unassigned]) };
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function candidates(client, userId, options, random = false) {
  const { rows } = await client.query(`
    SELECT v.* FROM vocabulary v
    LEFT JOIN user_vocabulary_learning p ON p.vocab_id=v.vocab_id AND p.user_id=$1
    WHERE v.owner_user_id=$1 AND ($2::integer IS NULL OR v.topic_id=$2)
      AND ($3='all' OR ($3='saved' AND p.saved) OR ($3='review' AND p.needs_review))
      AND ($4::integer[] IS NULL OR v.vocab_id=ANY($4))
      AND (NOT $6::boolean OR v.topic_id IS NULL)
    ORDER BY ${random ? 'RANDOM()' : "(COALESCE(p.status,'new')='known'), p.last_studied_at ASC NULLS FIRST, v.vocab_id"}
    LIMIT $5`, [userId, options.topicId, options.scope, options.ids, options.count, options.unassigned]);
  return rows;
}

async function studyPayload(client, session) {
  const { rows: words } = await client.query(`
    SELECT v.* FROM unnest($1::integer[]) WITH ORDINALITY AS ids(id, position)
    JOIN vocabulary v ON v.vocab_id=ids.id AND v.owner_user_id=$2 ORDER BY ids.position`, [session.word_ids, session.user_id]);
  const reviewed = new Set(session.reviewed_ids);
  const currentIndex = words.filter(word => reviewed.has(word.vocab_id)).length;
  // Deleted words must not leave an unfinished session stuck forever.
  if (currentIndex === words.length && !session.completed_at) {
    await client.query('UPDATE vocabulary_study_sessions SET completed_at=NOW() WHERE session_id=$1', [session.session_id]);
    session.completed_at = new Date();
  }
  return {
    session_id: session.session_id, words, current_index: currentIndex,
    known_count: session.known_count, completed: Boolean(session.completed_at),
  };
}

async function recordLearning(client, userId, vocabId, known, quiz = false) {
  // INSERT SELECT tolerates vocabulary removed after the quiz snapshot was made.
  await client.query(`
    INSERT INTO user_vocabulary_learning
      (user_id, vocab_id, status, needs_review, learned_at, last_studied_at, wrong_count)
    SELECT $1, vocab_id, $3, $4, NOW(), NOW(), $5 FROM vocabulary WHERE vocab_id=$2 AND owner_user_id=$1
    ON CONFLICT (user_id, vocab_id) DO UPDATE SET
      status=EXCLUDED.status, needs_review=EXCLUDED.needs_review,
      learned_at=COALESCE(user_vocabulary_learning.learned_at, EXCLUDED.learned_at),
      last_studied_at=NOW(), wrong_count=user_vocabulary_learning.wrong_count+EXCLUDED.wrong_count`,
  [userId, vocabId, known ? 'known' : 'learning', !known, quiz && !known ? 1 : 0]);
}

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildQuestions(words, dictionary) {
  return words.flatMap(word => {
    const correct = (word.meaning_vi || word.meaning_en || '').trim();
    if (!correct) return [];
    const distractors = [...new Set(dictionary.map(w => (w.meaning_vi || w.meaning_en || '').trim()))]
      .filter(text => text && text !== correct);
    if (!distractors.length) return [];
    const choices = shuffle([correct, ...shuffle(distractors).slice(0, 3)])
      .map((text, index) => ({ label: 'ABCD'[index], text }));
    return [{
      vocab_id: word.vocab_id, word: word.word,
      prompt: `Nghĩa đúng của từ "${word.word}" là gì?`, choices,
      correct_label: choices.find(choice => choice.text === correct).label,
    }];
  });
}

function gradeQuiz(questions, answers) {
  if (!Array.isArray(answers)) fail(400, 'Câu trả lời không hợp lệ.');
  const byId = new Map(questions.map(question => [question.vocab_id, question]));
  const selected = new Map();
  for (const answer of answers) {
    const id = positiveId(answer?.vocab_id);
    const question = byId.get(id);
    if (!question || selected.has(id)) fail(400, 'Từ vựng không thuộc lượt quiz hoặc bị trùng.');
    const label = answer.selected_label ?? null;
    if (label !== null && !question.choices.some(choice => choice.label === label)) fail(400, 'Đáp án không hợp lệ.');
    selected.set(id, label);
  }
  const details = questions.map(question => ({
    ...question, selected_label: selected.get(question.vocab_id) ?? null,
    is_correct: selected.get(question.vocab_id) === question.correct_label,
  }));
  return { correct: details.filter(detail => detail.is_correct).length, total: details.length, details };
}

module.exports = {
  selection, buildQuestions, gradeQuiz,

  async getProgress(userId) {
    return (await pool.query(`SELECT p.* FROM user_vocabulary_learning p JOIN vocabulary v ON v.vocab_id=p.vocab_id
      WHERE p.user_id=$1 AND v.owner_user_id=$1`, [userId])).rows;
  },

  async saveWord(userId, rawId, saved) {
    const vocabId = positiveId(rawId);
    if (typeof saved !== 'boolean') fail(400, 'Trạng thái lưu từ không hợp lệ.');
    const { rows } = await pool.query(`
      INSERT INTO user_vocabulary_learning (user_id, vocab_id, saved)
      SELECT $1, vocab_id, $3 FROM vocabulary WHERE vocab_id=$2 AND owner_user_id=$1
      ON CONFLICT (user_id, vocab_id) DO UPDATE SET saved=EXCLUDED.saved RETURNING *`, [userId, vocabId, saved]);
    if (!rows.length) fail(404, 'Từ vựng không còn tồn tại.');
    return rows[0];
  },

  async startStudy(userId, body) {
    const options = selection(body);
    return transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock($1::integer)', [userId]);
      const existing = await client.query(`SELECT * FROM vocabulary_study_sessions
        WHERE user_id=$1 AND scope_key=$2 AND completed_at IS NULL`, [userId, options.key]);
      if (existing.rows.length) {
        const payload = await studyPayload(client, existing.rows[0]);
        if (!payload.completed) return payload;
      }
      const words = await candidates(client, userId, options);
      if (!words.length) return { session_id: null, words: [], current_index: 0, known_count: 0, completed: true };
      const { rows } = await client.query(`INSERT INTO vocabulary_study_sessions (user_id, scope_key, word_ids)
        VALUES ($1,$2,$3) RETURNING *`, [userId, options.key, words.map(word => word.vocab_id)]);
      return studyPayload(client, rows[0]);
    });
  },

  async rateCard(userId, rawSessionId, body) {
    const sessionId = positiveId(rawSessionId), vocabId = positiveId(body.vocab_id);
    if (typeof body.known !== 'boolean') fail(400, 'Đánh giá thẻ không hợp lệ.');
    return transaction(async client => {
      const { rows } = await client.query(`SELECT * FROM vocabulary_study_sessions
        WHERE session_id=$1 AND user_id=$2 AND scope_key LIKE 'personal:%' FOR UPDATE`, [sessionId, userId]);
      if (!rows.length) fail(404, 'Không tìm thấy lượt học.');
      const session = rows[0];
      const payload = await studyPayload(client, session);
      // Retry after a lost response must not rate the next card or double-count.
      if (session.reviewed_ids.includes(vocabId)) return payload;
      if (payload.completed || payload.words[payload.current_index]?.vocab_id !== vocabId) {
        fail(409, 'Tiến độ đã thay đổi. Vui lòng mở lại lượt học.');
      }
      await recordLearning(client, userId, vocabId, body.known);
      const updated = await client.query(`UPDATE vocabulary_study_sessions
        SET reviewed_ids=array_append(reviewed_ids,$2), known_count=known_count+$3
        WHERE session_id=$1 RETURNING *`, [sessionId, vocabId, body.known ? 1 : 0]);
      return studyPayload(client, updated.rows[0]);
    });
  },

  async startQuiz(userId, body) {
    const options = selection(body);
    return transaction(async client => {
      const words = await candidates(client, userId, options, true);
      if (!words.length) return { session_id: null, questions: [] };
      const dictionary = (await client.query('SELECT meaning_vi, meaning_en FROM vocabulary WHERE owner_user_id=$1', [userId])).rows;
      const questions = buildQuestions(words, dictionary);
      if (!questions.length) fail(422, 'Cần ít nhất hai nghĩa khác nhau trong thư viện để tạo quiz.');
      const { rows } = await client.query(`INSERT INTO vocabulary_quiz_sessions (user_id, questions)
        VALUES ($1,$2::jsonb) RETURNING session_id`, [userId, JSON.stringify(questions)]);
      return { session_id: rows[0].session_id, questions: questions.map(({ correct_label, ...question }) => question) };
    });
  },

  async finishQuiz(userId, rawSessionId, body) {
    const sessionId = positiveId(rawSessionId);
    return transaction(async client => {
      const { rows } = await client.query(`SELECT * FROM vocabulary_quiz_sessions
        WHERE session_id=$1 AND user_id=$2 AND is_personal FOR UPDATE`, [sessionId, userId]);
      if (!rows.length) fail(404, 'Không tìm thấy lượt quiz.');
      const session = rows[0];
      if (session.result) return session.result;
      const result = gradeQuiz(session.questions, body.answers);
      result.duration_minutes = Math.max(1, Math.ceil((Date.now() - new Date(session.created_at).getTime()) / 60000));
      // Lock progress rows in a stable order when two quizzes finish together.
      for (const detail of [...result.details].sort((a, b) => a.vocab_id - b.vocab_id)) {
        await recordLearning(client, userId, detail.vocab_id, detail.is_correct, true);
      }
      await client.query(`UPDATE vocabulary_quiz_sessions SET result=$2::jsonb, completed_at=NOW()
        WHERE session_id=$1`, [sessionId, JSON.stringify(result)]);
      return result;
    });
  },
};
