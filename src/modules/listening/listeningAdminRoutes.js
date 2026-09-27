const express = require("express");
const router = express.Router();

const controller = require("./listeningAdminController");
const { authMiddleware } = require("../../middlewares/auth");
const { upload } = require("../../middlewares/upload");

// Listening Materials Routes
router.get(
  "/materials",
  authMiddleware,
  controller.requireAdmin,
  controller.getListeningMaterials
);
router.get(
  "/materials/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.getListeningMaterialById
);
router.post(
  "/materials",
  authMiddleware,
  controller.requireAdmin,
  controller.createListeningMaterial
);
router.put(
  "/materials/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.updateListeningMaterial
);
router.delete(
  "/materials/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.deleteListeningMaterial
);

// Listening Questions Routes
router.get(
  "/questions/part/:part",
  authMiddleware,
  controller.requireAdmin,
  controller.getListeningQuestionsByPart
);
router.get(
  "/questions/part/:part/grouped",
  authMiddleware,
  controller.requireAdmin,
  controller.getListeningQuestionsGrouped
);
router.get(
  "/materials/:materialId/questions",
  authMiddleware,
  controller.requireAdmin,
  controller.getQuestionsByMaterialId
);
router.post(
  "/questions/part/:part",
  authMiddleware,
  controller.requireAdmin,
  controller.createListeningQuestion
);
router.delete(
  "/questions/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.deleteListeningQuestion
);

// Import/Export Routes
router.post(
  "/questions/import",
  authMiddleware,
  controller.requireAdmin,
  controller.importListeningQuestions
);
router.post(
  "/questions/import-zip",
  authMiddleware,
  controller.requireAdmin,
  upload.single("file"),
  controller.importListeningQuestionsZip
);

// Statistics
router.get(
  "/statistics",
  authMiddleware,
  controller.requireAdmin,
  controller.getListeningStatistics
);

module.exports = router;
