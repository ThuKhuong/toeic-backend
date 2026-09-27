const express = require("express");
const router = express.Router();
const controller = require("./vocabularyAdminController");
const { authMiddleware, adminMiddleware } = require("../../middlewares/auth");

// Topic management routes - must be before parameterized routes
router.get("/topics", authMiddleware, adminMiddleware, controller.getTopics);
router.post("/topics", authMiddleware, adminMiddleware, controller.createTopic);
router.put("/topics/:id",authMiddleware,adminMiddleware,controller.updateTopic);
router.delete("/topics/:id",authMiddleware,adminMiddleware, controller.deleteTopic);

// Vocabulary CRUD routes
router.get("/", authMiddleware, adminMiddleware, controller.getAll);
router.post("/import", authMiddleware, adminMiddleware, controller.import);
router.put("/:id", authMiddleware, adminMiddleware, controller.update);
router.delete("/:id", authMiddleware, adminMiddleware, controller.delete);

module.exports = router;
