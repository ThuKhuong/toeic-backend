const VocabularyService = require("./vocabularyService");

exports.getVocabulary = async (req, res) => {
  try {
    const data = await VocabularyService.getStudentVocabulary();
    res.json(data);
  } catch (e) {
    console.error("Student vocabulary:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getRandom = async (req, res) => {
  try {
    const count = req.params.count || 10;
    const data = await VocabularyService.getRandom(count);
    res.json(data);
  } catch (e) {
    console.error("Student random vocab:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const data = await VocabularyService.getCategories();
    res.json(data);
  } catch (e) {
    console.error("Student category error:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getQuiz = async (req, res) => {
  try {
    const count = Number(req.query.count) || 10;
    const lang = String(req.query.lang || "vi");
    const topicId = req.query.topic_id
      ? Number(req.query.topic_id)
      : undefined;

    const data = await VocabularyService.generateQuiz(count, lang, topicId);
    res.json({ count: data.length, questions: data });
  } catch (e) {
    console.error("Vocabulary quiz error:", e);
    res.status(500).json({ error: "Server error" });
  }
};
