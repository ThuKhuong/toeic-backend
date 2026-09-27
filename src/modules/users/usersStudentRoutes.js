const express = require("express");
const router = express.Router();
const controller = require("./usersStudentController");
const { authMiddleware } = require("../../middlewares/auth");
const { avatarUpload } = require("../../middlewares/upload");

// GET /api/users/me - Lấy thông tin user hiện tại (verify token)
router.get("/me", authMiddleware, controller.getMe);
router.put("/me/avatar", authMiddleware, controller.updateAvatar);
router.post("/me/avatar/upload", authMiddleware, avatarUpload.single("avatar"), controller.uploadAvatar);

module.exports = router;
