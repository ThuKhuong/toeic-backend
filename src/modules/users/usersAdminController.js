// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\users\usersAdminController.js
const UsersService = require("./usersService");

exports.list = async (req, res) => {
  try {
    const data = await UsersService.list(req.query);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

exports.detail = async (req, res) => {
  try {
    const data = await UsersService.getById(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const data = await UsersService.update(req.params.id, req.body);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

exports.activate = async (req, res) => {
  try {
    const data = await UsersService.activate(req.params.id);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const data = await UsersService.deactivate(req.params.id);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

exports.delete = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // Prevent user from deleting themselves
    if (req.user && req.user.user_id === userId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    const deleted = await UsersService.delete(userId);
    if (!deleted) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ message: "User deleted successfully", user: deleted });
  } catch (error) {
    console.error("Delete user error:", error);
    const errorMessage = error.message || "Failed to delete user";
    res.status(500).json({
      error: "Failed to delete user",
      details: errorMessage,
    });
  }
};
