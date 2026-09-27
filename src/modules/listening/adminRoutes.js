const express = require("express");
const { authMiddleware } = require("../../middlewares/auth");
const { upload } = require("../../middlewares/upload");
const listeningAdminController = require("./listeningAdminController");

const router = express.Router();

router.use(authMiddleware, listeningAdminController.requireAdmin);

router.get("/materials", (req, res) =>
  listeningAdminController.getListeningMaterials(req, res)
);
router.get("/materials/:id", (req, res) =>
  listeningAdminController.getListeningMaterialById(req, res)
);
router.post("/materials", (req, res) =>
  listeningAdminController.createListeningMaterial(req, res)
);
router.put("/materials/:id", (req, res) =>
  listeningAdminController.updateListeningMaterial(req, res)
);
router.delete("/materials/:id", (req, res) =>
  listeningAdminController.deleteListeningMaterial(req, res)
);

router.get("/questions/part/:part", (req, res) =>
  listeningAdminController.getListeningQuestionsByPart(req, res)
);
router.get("/questions/part/:part/grouped", (req, res) =>
  listeningAdminController.getListeningQuestionsGrouped(req, res)
);
router.get("/materials/:materialId/questions", (req, res) =>
  listeningAdminController.getQuestionsByMaterialId(req, res)
);
router.post("/questions/part/:part", (req, res) =>
  listeningAdminController.createListeningQuestion(req, res)
);
router.put("/questions/:id", (req, res) =>
  listeningAdminController.updateListeningQuestion(req, res)
);
router.delete("/questions/:id", (req, res) =>
  listeningAdminController.deleteListeningQuestion(req, res)
);
router.post("/questions/import", (req, res) =>
  listeningAdminController.importListeningQuestions(req, res)
);
router.post("/questions/import-zip", upload.single("file"), (req, res) =>
  listeningAdminController.importListeningQuestionsZip(req, res)
);
router.post("/fix-media-urls", (req, res) =>
  listeningAdminController.fixMediaUrls(req, res)
);

module.exports = router;
