const express = require("express");
const router = express.Router();
const controller = require("./testsAdminController");
const { authMiddleware, adminMiddleware } = require("../../middlewares/auth");

router.get("/", authMiddleware, adminMiddleware, controller.getAll);

// Các route cụ thể phải đặt TRƯỚC route /:id để tránh conflict
router.get("/availability", controller.availability);
router.get(
  "/unassigned-questions",
  authMiddleware,
  adminMiddleware,
  controller.getUnassignedQuestions
);
router.post(
  "/assign-questions",
  authMiddleware,
  adminMiddleware,
  controller.assignQuestions
);
router.post(
  "/create-with-questions",
  authMiddleware,
  adminMiddleware,
  controller.createWithQuestions
);
router.post(
  "/auto-generate",
  authMiddleware,
  adminMiddleware,
  controller.autoGenerateQuestions
);

// Test Attempts Management - Phải đặt TRƯỚC route /:id để tránh conflict
router.get(
  "/attempts/all",
  authMiddleware,
  adminMiddleware,
  controller.getAllAttempts
);
router.get(
  "/attempts/:attempt_id/detail",
  authMiddleware,
  adminMiddleware,
  controller.getAttemptDetail
);

// Route động phải đặt SAU các route cụ thể
router.get("/:id", authMiddleware, adminMiddleware, controller.getDetail);
router.put("/:id", authMiddleware, adminMiddleware, controller.update);
router.delete("/:id", authMiddleware, adminMiddleware, controller.remove);
router.get(
  "/:id/statistics",
  authMiddleware,
  adminMiddleware,
  controller.statistics
);

router.post("/", authMiddleware, adminMiddleware, controller.create);

module.exports = router;
