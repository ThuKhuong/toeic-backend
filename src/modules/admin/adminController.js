// src/modules/admin/admin.controller.js
const AdminService = require("./adminService");

exports.requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "ADMIN") {
    return next();
  }
  res.status(403).json({ error: "Access denied. Admin required." });
};

exports.dashboardStats = async (req, res) => {
  try {
    const data = await AdminService.getDashboardStats();
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch dashboard statistics" });
  }
};

exports.users = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, search } = req.query;

    const data = await AdminService.getUsers(
      Number(page),
      Number(limit),
      role,
      search
    );

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

exports.dashboardTrends = async (req, res) => {
  try {
    const granularity = (req.query.granularity || "day").toLowerCase();
    const span = parseInt(req.query.span || (granularity === "week" ? 12 : 14));
    const data = await AdminService.getDashboardTrends(granularity, span);
    res.json({ granularity, span, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch dashboard trends" });
  }
};
