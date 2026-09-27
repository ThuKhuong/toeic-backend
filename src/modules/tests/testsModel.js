const pool = require("../../../db");

// TESTS
async function getAllTests(part = null, { includeDrafts = false } = {}) {
  let query = `
    SELECT t.test_id, t.test_name, t.description, t.time_limit, t.difficulty_level, t.parts,
      t.test_type, t.is_active, t.publication_status, t.created_at,
      (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.test_id) AS total_questions,
      (SELECT COUNT(*) FROM user_test_attempts uta WHERE uta.test_id = t.test_id) AS attempts_count
    FROM tests t
    WHERE ${includeDrafts ? 'TRUE' : 't.is_active = true'}
  `;

  const params = [];

  // Filter theo part nếu có
  if (part !== null && part >= 1 && part <= 7) {
    // Dùng operator = ANY() - đơn giản và đúng hơn cho PostgreSQL array
    query += ` AND t.parts IS NOT NULL AND $${
      params.length + 1
    } = ANY(t.parts)`;
    params.push(part);
  }

  query += ` ORDER BY t.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

async function getTestById(id, { includeDrafts = false } = {}) {
  const query = `
    SELECT t.*, u.full_name as created_by_name
    FROM tests t
    LEFT JOIN "User" u ON t.created_by = u.user_id
    WHERE t.test_id = $1 ${includeDrafts ? '' : 'AND t.is_active = true'}
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0];
}

async function getTestQuestions(test_id) {
  const query = `
        SELECT q.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('passage_id',p.passage_id,'title',p.title,'content',p.content,'image_url',p.image_url,'position',gp.position) ORDER BY gp.position) FROM question_group_passages gp JOIN reading_passages p USING(passage_id) WHERE gp.group_id=q.group_id),'[]'::jsonb) AS passages, 
          rp.title as passage_title, rp.content as passage_content,
          rp.image_url as passage_image_url,
           lm.title as material_title, lm.audio_url as material_audio,
           lm.transcript as material_transcript,
           v.word as vocab_word, v.meaning_vi as vocab_meaning,
           v.topic_id as vocab_topic_id, vt.name as vocab_topic_name
    FROM questions q
    LEFT JOIN reading_passages rp ON q.passage_id = rp.passage_id
    LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
    LEFT JOIN vocabulary v ON q.vocab_id = v.vocab_id
    LEFT JOIN vocabulary_topics vt ON v.topic_id = vt.topic_id
    WHERE q.test_id = $1
    ORDER BY q.order_in_test ASC, q.question_id ASC
  `;
  const result = await pool.query(query, [test_id]);
  return result.rows;
}

async function getQuestionChoices(question_id, includeCorrect = false) {
  let query = `
    SELECT choice_id, choice_text, choice_label
  `;
  if (includeCorrect) query += ", is_correct";

  query += `
    FROM answer_choices 
    WHERE question_id = $1
    ORDER BY choice_label
  `;

  const result = await pool.query(query, [question_id]);
  return result.rows;
}

async function createTest({
  test_name,
  test_type,
  description,
  time_limit,
  difficulty_level,
  parts,
  created_by,
  is_active = true,
  publication_status,
}) {
  const query = `
    INSERT INTO tests
    (test_name, test_type, description, time_limit, difficulty_level, parts, created_by, is_active, publication_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `;
  const result = await pool.query(query, [
    test_name,
    test_type,
    description,
    time_limit,
    difficulty_level,
    parts,
    created_by,
    is_active,
    publication_status,
  ]);
  return result.rows[0];
}

async function updateTest(id, data) {
  const {
    test_name,
    test_type,
    description,
    time_limit,
    difficulty_level,
    parts,
    is_active,
  } = data;

  const query = `
    UPDATE tests SET
      test_name = COALESCE($1, test_name),
      test_type = COALESCE($2, test_type),
      description = COALESCE($3, description),
      time_limit = COALESCE($4, time_limit),
      difficulty_level = COALESCE($5, difficulty_level),
      parts = COALESCE($6, parts),
      is_active = COALESCE($7, is_active),
      publication_status = COALESCE($9, publication_status),
      updated_at = CURRENT_TIMESTAMP
    WHERE test_id = $8
    RETURNING *
  `;

  const result = await pool.query(query, [
    test_name,
    test_type,
    description,
    time_limit,
    difficulty_level,
    parts,
    is_active,
    id,
    data.publication_status,
  ]);
  return result.rows[0];
}

async function softDeleteTest(id) {
  const query = `
    UPDATE tests SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE test_id = $1
    RETURNING *
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0];
}

// ATTEMPTS
async function getAttemptSummary(attempt_id) {
  const query = `
    SELECT uta.*, t.test_name, t.test_type, t.time_limit,
           u.full_name as user_name
    FROM user_test_attempts uta
    JOIN tests t ON uta.test_id = t.test_id
    JOIN "User" u ON uta.user_id = u.user_id
    WHERE uta.attempt_id = $1
  `;
  const result = await pool.query(query, [attempt_id]);
  return result.rows[0];
}

async function getUserAttempts(user_id) {
  const query = `
    SELECT uta.attempt_id, uta.user_id, uta.test_id, t.test_name,
           uta.start_time, uta.end_time, uta.total_correct, uta.total_questions,
           CASE WHEN uta.is_completed THEN uta.score END AS score,
           uta.time_spent, uta.is_completed,
           (SELECT COUNT(*)::integer FROM user_answers ua WHERE ua.attempt_id=uta.attempt_id AND ua.user_answer IS NOT NULL) AS answered_count
    FROM user_test_attempts uta
    JOIN tests t ON uta.test_id = t.test_id
    WHERE uta.user_id = $1
    ORDER BY uta.start_time DESC
  `;
  const result = await pool.query(query, [user_id]);
  return result.rows;
}

// ===============================
// STATISTICS
// ===============================
async function getTestStatistics(test_id) {
  const statsQuery = `
    SELECT 
      COUNT(*) as total_attempts,
      COUNT(CASE WHEN is_completed = true THEN 1 END) as completed_attempts,
      AVG(score) FILTER (WHERE is_completed) as avg_score,
      MAX(score) FILTER (WHERE is_completed) as max_score,
      MIN(score) FILTER (WHERE is_completed) as min_score
    FROM user_test_attempts 
    WHERE test_id = $1
  `;
  const stats = (await pool.query(statsQuery, [test_id])).rows[0];

  const partStatsQuery = `
    SELECT 
      (aq.question_snapshot->>'part_number')::integer AS part_number,
      COUNT(*) as total_answers,
      SUM(CASE WHEN ua.is_correct = true THEN 1 ELSE 0 END) as correct_answers
    FROM user_test_attempts uta
    JOIN attempt_questions aq ON aq.attempt_id = uta.attempt_id
    LEFT JOIN user_answers ua ON ua.attempt_id = aq.attempt_id
      AND ua.question_id = aq.question_id
    WHERE uta.test_id = $1 AND uta.is_completed = true
    GROUP BY (aq.question_snapshot->>'part_number')::integer
    ORDER BY part_number
  `;
  const partStats = (await pool.query(partStatsQuery, [test_id])).rows;

  return { stats, partStats };
}

module.exports = {
  getAllTests,
  getTestById,
  getTestQuestions,
  getQuestionChoices,
  createTest,
  updateTest,
  softDeleteTest,
  getAttemptSummary,
  getUserAttempts,
  getTestStatistics,
};

