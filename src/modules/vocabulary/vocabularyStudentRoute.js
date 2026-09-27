const express = require("express");
const router = express.Router();
const controller = require("./vocabularyStudentController");

router.get("/", controller.getVocabulary);
router.get("/random/:count", controller.getRandom);
router.get("/categories/list", controller.getCategories);
router.get("/quiz", controller.getQuiz);

module.exports = router;
