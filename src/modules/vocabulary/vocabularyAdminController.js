const VocabularyService = require("./vocabularyService");

exports.getAll = async (req, res) => {
  try {
    const data = await VocabularyService.getAll();
    res.json(data);
  } catch (e) {
    console.error("Admin vocab:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getTopics = async (req, res) => {
  try {
    const topics = await VocabularyService.getTopics();
    res.json(topics);
  } catch (e) {
    console.error("Admin vocab topics:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.import = require('../imports/importController').json('vocabulary');

exports.update = async (req, res) => {
  try {
    const updated = await VocabularyService.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });

    res.json(updated);
  } catch (e) {
    console.error("Admin update vocab:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await VocabularyService.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });

    res.json({ message: "Deleted successfully" });
  } catch (e) {
    console.error("Admin delete vocab:", e);
    res.status(500).json({ error: "Server error" });
  }
};

// tao topic moi
exports.createTopic = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Topic name is required" });
    }
    const topic = await VocabularyService.createTopic(name);
    res.status(201).json(topic);
  } catch (e) {
    console.error("Admin create topic:", e);
    if (e.code === "23505") {
      // Unique constraint violation
      res.status(400).json({ error: "Topic name already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
};

exports.updateTopic = async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;
    if (!name) {
      return res.status(400).json({ error: "Topic name is required" });
    }
    const topic = await VocabularyService.updateTopic(id, name);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    res.json(topic);
  } catch (e) {
    console.error("Admin update topic:", e);
    if (e.code === "23505") {
      res.status(400).json({ error: "Topic name already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
};

exports.deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;
    await VocabularyService.deleteTopic(id);
    res.json({ message: "Topic deleted successfully" });
  } catch (e) {
    console.error("Admin delete topic:", e);
    if (e.message && e.message.includes("đang được sử dụng")) {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
};

