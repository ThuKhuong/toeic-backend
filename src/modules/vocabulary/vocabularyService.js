const VocabularyModel = require("./vocabularyModel");
const pool = require("../../../db");

module.exports = {
  // ======= STUDENT =======
  async getStudentVocabulary() {
    const rows = (await VocabularyModel.getStudentList()).rows;

    // Lấy danh sách topic; nếu lỗi (ví dụ bảng topic trống) thì fallback sang mảng rỗng
    let topics = [];
    try {
      topics = (await VocabularyModel.getTopics()).rows;
    } catch (_) {
      topics = [];
    }

    const idToName = new Map(topics.map((t) => [t.topic_id, t.name]));

    const slug = (s) =>
      String(s || "others")
        .toLowerCase()
        .replace(/\s+/g, "_");

    const grouped = {};
    const categoriesSet = new Set();

    const enriched = rows.map((r) => {
      const name = idToName.get(r.topic_id) || r.category || "Others";
      const key = slug(name);
      categoriesSet.add(key);
      if (!grouped[key]) grouped[key] = [];
      const item = { ...r, category: key };
      grouped[key].push(item);
      return item;
    });

    // ensure all topics appear even nếu chưa có từ nào mapping
    for (const t of topics) {
      categoriesSet.add(slug(t.name));
    }

    return {
      success: true,
      data: enriched,
      grouped,
      categories: Array.from(categoriesSet),
    };
  },

  async getRandom(count, topicId) {
    const result = await VocabularyModel.getRandom(count, topicId);
    return result.rows;
  },

  async generateQuiz(count = 10, lang = "vi", topicId) {
    const rows = (await VocabularyModel.getRandom(count, topicId)).rows;
    const quiz = [];
    for (const r of rows) {
      const distractorsRes = await VocabularyModel.getRandomDistractors(
        r.vocab_id,
        3
      );
      const distractors = distractorsRes.rows
        .map((d) => (lang === "vi" ? d.meaning_vi : d.meaning_en))
        .filter(Boolean);
      const correct = lang === "vi" ? r.meaning_vi : r.meaning_en;
      const choicesTexts = [correct, ...distractors].filter(Boolean);
      // Ensure 4 choices; if missing, fill with word itself variants
      while (choicesTexts.length < 4) choicesTexts.push(`${r.word}`);
      // Shuffle choices
      const labels = ["A", "B", "C", "D"];
      const shuffled = choicesTexts.sort(() => Math.random() - 0.5).slice(0, 4);
      const correctIdx = shuffled.findIndex((t) => t === correct);
      const item = {
        vocab_id: r.vocab_id,
        word: r.word,
        prompt:
          lang === "vi"
            ? `Nghĩa đúng của từ "${r.word}" là gì?`
            : `What is the correct meaning of "${r.word}"?`,
        choices: shuffled.map((t, i) => ({ label: labels[i], text: t })),
        correct_label: labels[Math.max(0, correctIdx)],
      };
      quiz.push(item);
    }
    return quiz;
  },

  async getCategories() {
    const result = await VocabularyModel.getCategories();
    return result.rows;
  },

  // ======= ADMIN =======
  async getAll() { return (await VocabularyModel.getAll()).rows; },

  async getTopics() { return (await VocabularyModel.getTopics()).rows; },

  async createTopic(name) {
    const result = await VocabularyModel.createTopic(name);
    return result.rows[0];
  },

  async updateTopic(id, name) {
    const result = await VocabularyModel.updateTopic(id, name);
    return result.rows[0];
  },

  async deleteTopic(id) {
    // Check if topic is being used by any vocabulary
    const vocabCount = await pool.query(
      `SELECT COUNT(*) as count FROM vocabulary WHERE topic_id=$1`,
      [id]
    );
    if (parseInt(vocabCount.rows[0].count) > 0) {
      throw new Error("Không thể xóa topic đang được sử dụng bởi từ vựng");
    }
    const result = await VocabularyModel.deleteTopic(id);
    return result.rows[0];
  },

  async getOne(id) {
    const result = await VocabularyModel.getById(id);
    return result.rows[0] || null;
  },

  async create(data) { return (await VocabularyModel.create(data)).rows[0]; },

  async update(id, data) { return (await VocabularyModel.update(id, data)).rows[0] || null; },

  async delete(id) {
    const result = await VocabularyModel.delete(id);
    return result.rows[0] || null;
  },

  async import(items) { return require('../imports/importController').importJson(items, 'vocabulary'); },
};

