// src/modules/questions/student.controller.js
const QuestionService = require("./questionService");

exports.getQuestions = async (req, res) => {
  try {
    const data = await QuestionService.getQuestionsForStudent(req.query);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch questions" });
  }
};

exports.getQuestionById = async (req, res) => {
  try {
    const data = await QuestionService.getQuestionById(req.params.id, false);
    if (!data) return res.status(404).json({ error: "Question not found" });

    delete data.correct_answer;
    delete data.explanation;

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch question" });
  }
};

exports.getRandom = async (req, res) => {
  try {
    const questions = await QuestionService.getRandomQuestions(
      req.params.count,
      req.query
    );
    res.json(questions);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch random questions" });
  }
};
