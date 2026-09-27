// src/modules/questions/questions.controller.js
const QuestionService = require("./questionService");
// kiem tra quyen admin
exports.requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "ADMIN") return next();
  return res.status(403).json({ error: "Access denied" });
};

// Lay danh sach cau hoi
exports.getQuestions = async (req, res) => {
  try {
    const data = await QuestionService.getQuestions(req.query);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
};

// Lay cau hoi theo id
exports.getQuestionById = async (req, res) => {
  try {
    const data = await QuestionService.getQuestionById(req.params.id);
    if (!data) return res.status(404).json({ error: "Question not found" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch question" });
  }
};

// Tao cau hoi moi
exports.createQuestion = async (req, res) => {
  try {
    const question = await QuestionService.createQuestion(req.body);
    res.status(201).json(question);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create question" });
  }
};

exports.importQuestions = require('../imports/importController').json('reading');

exports.updateQuestion = async (req, res) => {
  try {
    const updated = await QuestionService.updateQuestion(
      req.params.id,
      req.body
    );
    if (!updated) return res.status(404).json({ error: "Question not found" });
    res.json(updated);
  } catch (e) {
    console.error("Error in updateQuestion controller:", e);

    // Kiểm tra nếu lỗi liên quan đến test_id
    const errorMsg = e.message || "Server error";
    if (
      errorMsg.includes("đang được sử dụng trong đề thi") ||
      (errorMsg.includes("Không thể sửa") && errorMsg.includes("đề thi"))
    ) {
      return res.status(400).json({
        error: errorMsg,
        code: "IN_TEST",
      });
    }

    res.status(500).json({ error: errorMsg });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const deleted = await QuestionService.deleteQuestion(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Question not found" });
    res.json({ message: "Question deleted successfully" });
  } catch (e) {
    const msg = e.message || "Failed to delete question";
    if (msg.startsWith("Không thể xóa")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
};

exports.getStatistics = async (req, res) => {
  try {
    const stats = await QuestionService.getStatistics();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
};

exports.deletePassageGroup = async (req, res) => {
  try {
    const passageId = parseInt(req.params.passageId);
    if (!passageId) {
      return res.status(400).json({ error: "Invalid passage ID" });
    }
    const result = await QuestionService.deletePassageGroup(passageId);
    if (!result.passage_id) {
      return res.status(404).json({ error: "Passage not found" });
    }
    res.json({
      message: "Passage group deleted successfully",
      deleted_questions: result.deleted_questions,
    });
  } catch (e) {
    console.error("Delete passage group error:", e);
    const errorMessage = e.message || "Failed to delete passage group";
    // Nếu là lỗi do đã được người dùng làm bài, trả về 400
    if (errorMessage.includes("đã được người dùng làm bài")) {
      return res.status(400).json({ error: errorMessage });
    }
    res.status(500).json({ error: errorMessage });
  }
};

exports.importPart6Zip = require('../imports/importController').zip(6);
exports.importPart7Zip = require('../imports/importController').zip(7);

exports.updatePassageGroup = async (req, res) => {
  try {
    const passageId = parseInt(req.params.passageId);
    if (!passageId) {
      return res.status(400).json({ error: "Invalid passage ID" });
    }
    const result = await QuestionService.updatePassageGroup(
      passageId,
      req.body
    );
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update passage group" });
  }
};

