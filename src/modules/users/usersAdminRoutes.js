// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\users\usersAdminRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("./usersAdminController");
const { authMiddleware, adminMiddleware } = require("../../middlewares/auth");

router.get("/", authMiddleware, adminMiddleware, controller.list);
router.get("/:id", authMiddleware, adminMiddleware, controller.detail);
router.put("/:id", authMiddleware, adminMiddleware, controller.update);
router.put(
  "/:id/activate",
  authMiddleware,
  adminMiddleware,
  controller.activate
);
router.put(
  "/:id/deactivate",
  authMiddleware,
  adminMiddleware,
  controller.deactivate
);
router.delete("/:id", authMiddleware, adminMiddleware, controller.delete);

module.exports = router;
