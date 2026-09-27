// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\auth\authRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("./authController");

router.post("/login", controller.login);
router.post("/register", controller.register);

module.exports = router;
