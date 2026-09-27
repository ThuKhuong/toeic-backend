// src/modules/questions/student.routes.js
const express = require("express");
const router = express.Router();

const controller = require("./studentController");

router.get("/", controller.getQuestions);
router.get("/random/:count", controller.getRandom);
router.get("/:id", controller.getQuestionById);

module.exports = router;
