// src/modules/admin/admin.routes.js
const express = require("express");
const router = express.Router();

const adminController = require("./adminController");

const { authMiddleware } = require("../../middlewares/auth");


router.get(
  "/dashboard-stats",
  authMiddleware,
  adminController.requireAdmin,
  adminController.dashboardStats
);

router.get(
  "/dashboard-trends",
  authMiddleware,
  adminController.requireAdmin,
  adminController.dashboardTrends
);

router.get(
  "/users",
  authMiddleware,
  adminController.requireAdmin,
  adminController.users
);

module.exports = router;
