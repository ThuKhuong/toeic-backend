// src/modules/questions/admin.routes.js
const express = require("express");
const router = express.Router();

const controller = require("./adminController");
const { authMiddleware } = require("../../middlewares/auth");
const { upload } = require("../../middlewares/upload");

router.get(
  "/",
  authMiddleware,
  controller.requireAdmin,
  controller.getQuestions
);
router.get(
  "/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.getQuestionById
);
router.post(
  "/",
  authMiddleware,
  controller.requireAdmin,
  controller.createQuestion
);
router.post(
  "/import",
  authMiddleware,
  controller.requireAdmin,
  controller.importQuestions
);
router.post(
  "/import-zip/part7",
  authMiddleware,
  controller.requireAdmin,
  upload.single("file"),
  controller.importPart7Zip
);
router.post(
  "/import-zip/part6",
  authMiddleware,
  controller.requireAdmin,
  upload.single("file"),
  controller.importPart6Zip
);
router.put(
  "/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.updateQuestion
);
router.delete(
  "/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.deleteQuestion
);
router.get(
  "/statistics/summary",
  authMiddleware,
  controller.requireAdmin,
  controller.getStatistics
);

// Passage group endpoints (for Part 6/7)
router.delete(
  "/passage/:passageId",
  authMiddleware,
  controller.requireAdmin,
  controller.deletePassageGroup
);
router.put(
  "/passage/:passageId",
  authMiddleware,
  controller.requireAdmin,
  controller.updatePassageGroup
);

module.exports = router;
