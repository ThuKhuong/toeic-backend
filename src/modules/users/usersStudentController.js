const UsersService = require("./usersService");

// GET /api/users/me - Lấy thông tin user hiện tại (verify token)
exports.getMe = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    
    const user = await UsersService.getById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    
    res.json(user);
  } catch (e) {
    console.error("Get me error:", e);
    res.status(500).json({ error: "Server error" });
  }
};

exports.updateAvatar = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    const { avatar_url } = req.body || {};
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!avatar_url || typeof avatar_url !== "string") {
      return res.status(400).json({ error: "avatar_url is required" });
    }
    const updated = await UsersService.update(userId, { avatar_url });
    res.json({ user_id: updated.user_id, avatar_url: updated.avatar_url, full_name: updated.full_name });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const path = require("path");
    const { uploadsDir } = require("../../middlewares/upload");
    const rel = path.relative(uploadsDir, file.path).replace(/\\/g, "/");
    const publicUrl = `/uploads/${rel}`;
    const updated = await UsersService.update(userId, { avatar_url: publicUrl });
    res.json({ user_id: updated.user_id, avatar_url: updated.avatar_url, full_name: updated.full_name });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
};
