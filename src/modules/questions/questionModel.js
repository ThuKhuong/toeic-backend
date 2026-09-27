// src/modules/questions/questions.model.js
const pool = require("../../../db");

exports.buildWhereClause = (filters) => {
  const { test_id, question_type, part_number, difficulty, search } = filters;

  let conditions = [];
  let params = [];
  let i = 0;

  if (test_id) {
    i++;
    conditions.push(`q.test_id = $${i}`);
    params.push(test_id);
  }

  if (question_type) {
    i++;
    conditions.push(`q.question_type = $${i}`);
    params.push(question_type);
  }

  if (part_number) {
    i++;
    conditions.push(`q.part_number = $${i}`);
    params.push(part_number);
  }

  if (difficulty) {
    i++;
    conditions.push(`q.difficulty_level = $${i}`);
    params.push(difficulty);
  }

  if (search) {
    i++;
    conditions.push(`q.question_text ILIKE $${i}`);
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  return { whereClause, params, paramCount: i };
};

exports.countQuestions = (whereClause, params) =>
  pool.query(`SELECT COUNT(*) FROM questions q ${whereClause}`, params);

exports.getQuestions = (whereClause, params, limit, offset) =>
  pool.query(
    `
      SELECT q.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('passage_id',p.passage_id,'title',p.title,'content',p.content,'image_url',p.image_url,'position',gp.position) ORDER BY gp.position) FROM question_group_passages gp JOIN reading_passages p USING(passage_id) WHERE gp.group_id=q.group_id),'[]'::jsonb) AS passages, 
             t.test_name,
             rp.title as passage_title, rp.content as passage_content, rp.image_url as passage_image_url,
             lm.title as material_title, lm.audio_url as material_audio,
             v.word as vocab_word, v.meaning_vi as vocab_meaning,
             v.topic_id as vocab_topic_id, vt.name as vocab_topic_name
      FROM questions q
      LEFT JOIN tests t ON q.test_id = t.test_id
      LEFT JOIN reading_passages rp ON q.passage_id = rp.passage_id
      LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
      LEFT JOIN vocabulary v ON q.vocab_id = v.vocab_id
      LEFT JOIN vocabulary_topics vt ON v.topic_id = vt.topic_id
      ${whereClause}
      ORDER BY q.test_id, q.order_in_test, q.question_id
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `,
    params
  );

exports.getAnswerChoices = (question_id, includeCorrect = false) => {
  let query = `
    SELECT choice_id, choice_text, choice_label
    FROM answer_choices 
    WHERE question_id = $1 
    ORDER BY choice_label
  `;
  if (includeCorrect) {
    query = `
      SELECT choice_id, choice_text, choice_label, is_correct
      FROM answer_choices 
      WHERE question_id = $1 
      ORDER BY choice_label
    `;
  }
  return pool.query(query, [question_id]);
};

exports.getQuestionById = (id) =>
  pool.query(
    `
      SELECT q.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('passage_id',p.passage_id,'title',p.title,'content',p.content,'image_url',p.image_url,'position',gp.position) ORDER BY gp.position) FROM question_group_passages gp JOIN reading_passages p USING(passage_id) WHERE gp.group_id=q.group_id),'[]'::jsonb) AS passages, 
             t.test_name,
             rp.title as passage_title, rp.content as passage_content, rp.image_url as passage_image_url,
             lm.title as material_title, lm.audio_url as material_audio,
             lm.transcript as material_transcript,
             v.word as vocab_word, v.meaning_vi as vocab_meaning,
             v.topic_id as vocab_topic_id, vt.name as vocab_topic_name
      FROM questions q
      LEFT JOIN tests t ON q.test_id = t.test_id
      LEFT JOIN reading_passages rp ON q.passage_id = rp.passage_id
      LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
      LEFT JOIN vocabulary v ON q.vocab_id = v.vocab_id
      LEFT JOIN vocabulary_topics vt ON v.topic_id = vt.topic_id
      WHERE q.question_id = $1
    `,
    [id]
  );


