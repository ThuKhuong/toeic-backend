const express = require("express");
const { authMiddleware } = require("../../middlewares/auth");
const { upload } = require("../../middlewares/upload");
const listeningAdminController = require("./listeningAdminController");

const router = express.Router();

router.use(authMiddleware, listeningAdminController.requireAdmin);
const quickImport = require('../imports/quickController');
router.post('/source-sets/assign', async (req,res,next) => {
  const ids=req.body.question_ids;
  const name=String(req.body.source_set || '').trim().replace(/\s+/g,' ');
  if(!Array.isArray(ids) || !ids.length || ids.length>100 || ids.some(id=>!Number.isSafeInteger(id)||id<=0) || !name || name.length>150) return res.status(400).json({error:'Chọn câu hỏi và nhập tên bộ đề hợp lệ.'});
  const client=await require('../../../db').connect();
  try {
    await client.query('BEGIN');
    const rows=await client.query("SELECT question_id FROM questions WHERE question_id=ANY($1::int[]) AND question_type='listening' FOR UPDATE",[ids]);
    if(rows.rows.length!==new Set(ids).size) throw Object.assign(new Error('Một số câu hỏi không tồn tại hoặc không thuộc Listening.'),{status:400});
    await client.query('UPDATE questions SET source_set=$1, source_question_number=COALESCE(source_question_number,order_in_test) WHERE question_id=ANY($2::int[])',[name,ids]);
    await client.query('COMMIT');res.json({updated:rows.rows.length});
  } catch(e){await client.query('ROLLBACK');res.status(e.code==='23505'?409:e.status||500).json({error:e.code==='23505'?'Bộ đề đã có số câu này. Kiểm tra các câu đã chọn.':e.message});} finally {client.release();}
});
router.get('/source-sets', async (req,res,next) => {
  try { const result=await require('../../../db').query('SELECT DISTINCT source_set FROM questions WHERE source_set IS NOT NULL ORDER BY source_set'); res.json(result.rows.map(r=>r.source_set)); } catch(e){next(e);}
});

router.post('/quick-import/:part/:action', (req,res,next) => {
  if (!['preview','commit'].includes(req.params.action)) return res.status(404).json({error:'Không tìm thấy thao tác.'});
  next();
}, quickImport.upload, quickImport.handle);

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
