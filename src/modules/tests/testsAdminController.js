const TestsService = require("./testsService");

exports.getAll = async (req, res) => {
  try {
    const tests = await TestsService.adminListTests(req.query);
    res.json(tests);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.getDetail = async (req, res) => {
  try {
    const test = await TestsService.adminGetTestDetails(req.params.id);
    if (!test) return res.status(404).json({ error: "Not found" });

    res.json(test);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const data = {
      ...req.body,
      created_by: req.user.user_id,
    };

    const newTest = await TestsService.adminCreateTest(data);
    res.status(201).json(newTest);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.createWithQuestions = async (req, res) => {
  try {
    const data = {
      ...req.body,
      created_by: req.user.user_id,
    };
    const result = await TestsService.adminCreateTestWithQuestions(data);
    res.status(201).json(result);
  } catch (err) {
    console.error("create-with-questions:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.autoGenerateQuestions = async (req, res) => {
  try {
    const result = await TestsService.adminAutoGenerateQuestions(req.body);
    res.status(200).json(result);
  } catch (err) {
    console.error("auto-generate:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await TestsService.adminUpdateTest(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });

    res.json(updated);
  } catch (err) {
    console.error("Error in update controller:", err);

    // Ràng buộc: Trả về lỗi nếu có người đã làm bài
    // Kiểm tra nếu lỗi liên quan đến attempts
    const errorMsg = err.message || "Server error";
    if (errorMsg.includes("đã có") && errorMsg.includes("lượt làm bài")) {
      return res.status(400).json({
        error: errorMsg,
        code: "HAS_ATTEMPTS",
      });
    }

    res.status(err.status || 500).json({ error: errorMsg });
  }
};

exports.remove = async (req, res) => {
  try {
    // console.log(`🗑️ Admin deleting test ID: ${req.params.id}`);
    const deleted = await TestsService.adminDeleteTest(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Test not found" });
    }

    res.json({
      message: "Test deleted successfully",
      deleted: {
        test_id: deleted.test_id,
        test_name: deleted.test_name,
      },
    });
  } catch (err) {
    console.error("Error in remove controller:", err);

    // Ràng buộc: Trả về lỗi nếu có người đã làm bài
    // Kiểm tra nếu lỗi liên quan đến attempts
    const errorMsg = err.message || "Server error";
    if (errorMsg.includes("đã có") && errorMsg.includes("lượt làm bài")) {
      return res.status(400).json({
        error: errorMsg,
        code: "HAS_ATTEMPTS",
      });
    }

    res.status(err.status || 500).json({ error: errorMsg });
  }
};

exports.statistics = async (req, res) => {
  try {
    const stats = await TestsService.adminGetStatistics(req.params.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.availability = async (req, res) => {
  try {
    const { part_number, difficulty_level } = req.query;
    const result = await TestsService.adminGetAvailability({
      part_number,
      difficulty_level,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// Test Attempts Management
exports.getAllAttempts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      test_id,
      user_id,
      date_from,
      date_to,
    } = req.query;
    const attempts = await TestsService.adminGetAllAttempts({
      page: Number(page),
      limit: Number(limit),
      test_id,
      user_id,
      date_from,
      date_to,
    });
    res.json(attempts);
  } catch (err) {
    console.error("getAllAttempts error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getAttemptDetail = async (req, res) => {
  try {
    const attemptId = req.params.attempt_id;
    if (!attemptId) {
      return res.status(400).json({ error: "Attempt ID is required" });
    }

      const detail = await TestsService.adminGetAttemptResults(attemptId);
    if (!detail || !detail.attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    res.json(detail);
  } catch (err) {
    console.error("getAttemptDetail error:", err);
    const errorMsg = err.message || "Server error";
      res.status(err.status || 500).json({ error: errorMsg });
  }
};

exports.getUnassignedQuestions = async (req, res) => {
  try {
    const { part_number, difficulty_level, page = 1, limit = 50 } = req.query;
    if (!part_number) {
      return res.status(400).json({ error: "part_number is required" });
    }
    const result = await TestsService.adminGetUnassignedQuestions({
      part_number,
      difficulty_level,
      page: Number(page),
      limit: Number(limit),
    });
    res.json(result);
  } catch (err) {
    console.error("getUnassignedQuestions error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.assignQuestions = async (req, res) => {
  try {
    const { test_id, question_ids } = req.body;
    if (!test_id || !Array.isArray(question_ids) || question_ids.length === 0) {
      return res
        .status(400)
        .json({ error: "test_id and question_ids array are required" });
    }
    const result = await TestsService.adminAssignQuestionsToTest({
      test_id,
      question_ids,
    });
    res.json(result);
  } catch (err) {
    console.error("assignQuestions error:", err);
    if (err.message === "TEST_NOT_FOUND") {
      return res.status(404).json({ error: "Test not found" });
    }
    res.status(500).json({ error: "Server error" });
  }
};
