const TestsService = require("./testsService");

exports.getAllTests = async (req, res) => {
  try {
    // Parse part từ query parameter
    let part = null;
    if (req.query.part !== undefined && req.query.part !== null) {
      // Parse part - có thể là string hoặc number
      const partValue = req.query.part;
      const parsedPart =
        typeof partValue === "string" ? parseInt(partValue, 10) : partValue;

      if (!isNaN(parsedPart) && parsedPart >= 1 && parsedPart <= 7) {
        part = parsedPart;
      }
    }

    const tests = await TestsService.listTests(part);
    res.json(tests);
  } catch (err) {
    console.error("Error getting tests:", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};

exports.getTest = async (req, res) => {
  try {
    const includeAns = false;
    const test = await TestsService.getFullTestForStudent(
      req.params.id,
      includeAns
    );

    if (!test) return res.status(404).json({ error: "Test not found" });

    res.json(test);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};

exports.startAttempt = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const attempt = await TestsService.startAttempt(user_id, req.params.id);

    if (!attempt) return res.status(404).json({ error: "Test not found" });

    res.json(attempt);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};

exports.submitAnswer = async (req, res) => {
  try {
    const { question_id, user_answer, time_spent } = req.body;

    const result = await TestsService.submitAnswer(
      req.params.attempt_id,
      question_id,
      user_answer,
      time_spent,
      req.user.user_id
    );

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};

exports.finishAttempt = async (req, res) => {
  try {
    const result = await TestsService.finishAttempt(req.params.attempt_id, req.user.user_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};

exports.getResults = async (req, res) => {
  try {
    const result = await TestsService.getAttemptResults(req.params.attempt_id, req.user.user_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};

exports.getUserAttempts = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (String(user_id) !== String(req.user.user_id)) return res.status(403).json({ error: "Forbidden" });
    const attempts = await TestsService.getUserAttempts(user_id);
    res.json(attempts);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  }
};
