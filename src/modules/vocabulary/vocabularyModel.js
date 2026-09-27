const pool = require("../../../db");

module.exports = {
  // COMMON


  getById(id) {
    return pool.query(`SELECT * FROM vocabulary WHERE vocab_id = $1`, [id]);
  },

  // STUDENT
  getStudentList() {
    return pool.query(`
      SELECT vocab_id, word, pronunciation, meaning_vi, meaning_en,
             part_of_speech, difficulty_level,
             example_sentence, example_translation,
             audio_url, image_url, tags, topic_id
      FROM vocabulary
      ORDER BY topic_id ASC NULLS LAST, word ASC
    `);
  },


  getRandom(count, topicId) {
    if (topicId) {
      return pool.query(
        `SELECT vocab_id, word, meaning_vi, meaning_en, pronunciation, topic_id
         FROM vocabulary 
         WHERE topic_id = $1
         ORDER BY RANDOM() LIMIT $2`,
        [topicId, count]
      );
    }
    return pool.query(
      `SELECT vocab_id, word, meaning_vi, meaning_en, pronunciation, topic_id
       FROM vocabulary
       ORDER BY RANDOM() LIMIT $1`,
      [count]
    );
  },

  getRandomDistractors(excludeId, limit) {
    return pool.query(
      `SELECT meaning_vi FROM vocabulary WHERE vocab_id <> $1 ORDER BY RANDOM() LIMIT $2`,
      [excludeId, limit]
    );
  },

  getCategories() {
    return pool.query(`
      SELECT vt.topic_id, vt.name AS topic_name, COUNT(v.vocab_id) AS word_count
      FROM vocabulary_topics vt
      LEFT JOIN vocabulary v ON v.topic_id = vt.topic_id
      GROUP BY vt.topic_id, vt.name
      ORDER BY vt.topic_id ASC
    `);
  },

  // =====================
  // ADMIN CRUD
  // =====================


  delete(id) {
    return pool.query("DELETE FROM vocabulary WHERE vocab_id=$1 RETURNING *", [
      id,
    ]);
  },



  create(data) {
    const {
      word,
      pronunciation,
      meaning_vi,
      meaning_en,
      part_of_speech,
      example_sentence,
      example_translation,
      audio_url,
      image_url,
      difficulty_level,
      tags,
      topic_id,
    } = data;
    return pool.query(
      `INSERT INTO vocabulary 
      (word, pronunciation, meaning_vi, meaning_en, part_of_speech, example_sentence, example_translation,
       audio_url, image_url, difficulty_level, tags, topic_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        word,
        pronunciation,
        meaning_vi,
        meaning_en,
        part_of_speech || null,
        example_sentence || null,
        example_translation || null,
        audio_url || null,
        image_url || null,
        difficulty_level,
        tags || null,
        topic_id || null,
      ]
    );
  },

  update(id, data) {
    const {
      word,
      pronunciation,
      meaning_vi,
      meaning_en,
      part_of_speech,
      example_sentence,
      example_translation,
      audio_url,
      image_url,
      difficulty_level,
      tags,
      topic_id,
    } = data;
    return pool.query(
      `UPDATE vocabulary
       SET word=$1, pronunciation=$2, meaning_vi=$3, meaning_en=$4,
           part_of_speech=$5, example_sentence=$6, example_translation=$7,
           audio_url=$8, image_url=$9, difficulty_level=$10, tags=$11, topic_id=$12, updated_at=CURRENT_TIMESTAMP
       WHERE vocab_id=$13
       RETURNING *`,
      [
        word,
        pronunciation,
        meaning_vi,
        meaning_en,
        part_of_speech || null,
        example_sentence || null,
        example_translation || null,
        audio_url || null,
        image_url || null,
        difficulty_level,
        tags || null,
        topic_id || null,
        id,
      ]
    );
  },

  getAll() {
    return pool.query(`
      SELECT vocab_id, word, pronunciation, meaning_vi, meaning_en,
             part_of_speech, example_sentence, example_translation,
             audio_url, image_url, difficulty_level, tags, topic_id
      FROM vocabulary
      ORDER BY vocab_id ASC
    `);
  },

  getTopics() {
    return pool.query(
      `SELECT topic_id, name FROM vocabulary_topics ORDER BY name`
    );
  },

  createTopic(name) {
    return pool.query(
      `INSERT INTO vocabulary_topics (name) VALUES ($1) RETURNING *`,
      [name]
    );
  },

  updateTopic(id, name) {
    return pool.query(
      `UPDATE vocabulary_topics SET name=$1 WHERE topic_id=$2 RETURNING *`,
      [name, id]
    );
  },

  deleteTopic(id) {
    return pool.query(
      `DELETE FROM vocabulary_topics WHERE topic_id=$1 RETURNING *`,
      [id]
    );
  },

  getTopicById(id) {
    return pool.query(
      `SELECT topic_id, name FROM vocabulary_topics WHERE topic_id=$1`,
      [id]
    );
  },
};

