// src/modules/questions/admin.routes.js
const express = require("express");
const router = express.Router();

const controller = require("./adminController");
const { authMiddleware } = require("../../middlewares/auth");
const { upload } = require("../../middlewares/upload");

const quickImport = require('../imports/quickController');
router.post('/quick-import/:part/:action', authMiddleware, controller.requireAdmin, (req,res,next) => {
  if (!['preview','commit'].includes(req.params.action)) return res.status(404).json({error:'Không tìm thấy thao tác.'});
  next();
}, quickImport.upload, quickImport.handleReading);

router.post('/source-sets/assign', authMiddleware, controller.requireAdmin, async (req,res,next) => {
  const ids=req.body.question_ids;
  const name=String(req.body.source_set || '').trim().replace(/\s+/g,' ');
  if(!Array.isArray(ids) || !ids.length || ids.length>100 || ids.some(id=>!Number.isSafeInteger(id)||id<=0) || !name || name.length>150) return res.status(400).json({error:'Chọn câu hỏi và nhập tên bộ đề hợp lệ.'});
  const client=await require('../../../db').connect();
  try {
    await client.query('BEGIN');
    const rows=await client.query("SELECT question_id FROM questions WHERE question_id=ANY($1::int[]) AND part_number=5 AND question_type='reading' FOR UPDATE",[ids]);
    if(rows.rows.length!==new Set(ids).size) throw Object.assign(new Error('Một số câu hỏi không tồn tại hoặc không thuộc Part 5.'),{status:400});
    await client.query('UPDATE questions SET source_set=$1, source_question_number=COALESCE(source_question_number,order_in_test) WHERE question_id=ANY($2::int[])',[name,ids]);
    await client.query('COMMIT');res.json({updated:rows.rows.length});
  } catch(e){await client.query('ROLLBACK');res.status(e.code==='23505'?409:e.status||500).json({error:e.code==='23505'?'Bộ đề đã có số câu này. Kiểm tra các câu đã chọn.':e.message});} finally {client.release();}
});
router.get('/source-sets', authMiddleware, controller.requireAdmin, async (req,res,next) => {
  try { const result=await require('../../../db').query('SELECT DISTINCT source_set FROM questions WHERE source_set IS NOT NULL ORDER BY source_set'); res.json(result.rows.map(r=>r.source_set)); } catch(e){next(e);}
});


router.get(
  "/",
  authMiddleware,
  controller.requireAdmin,
  controller.getQuestions
);
router.get(
  "/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.getQuestionById
);
router.post(
  "/",
  authMiddleware,
  controller.requireAdmin,
  controller.createQuestion
);
router.post(
  "/import",
  authMiddleware,
  controller.requireAdmin,
  controller.importQuestions
);
router.post(
  "/import-zip/part7",
  authMiddleware,
  controller.requireAdmin,
  upload.single("file"),
  controller.importPart7Zip
);
router.post(
  "/import-zip/part6",
  authMiddleware,
  controller.requireAdmin,
  upload.single("file"),
  controller.importPart6Zip
);
router.put(
  "/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.updateQuestion
);
router.delete(
  "/:id",
  authMiddleware,
  controller.requireAdmin,
  controller.deleteQuestion
);
router.get(
  "/statistics/summary",
  authMiddleware,
  controller.requireAdmin,
  controller.getStatistics
);

// Passage group endpoints (for Part 6/7)
router.delete(
  "/passage/:passageId",
  authMiddleware,
  controller.requireAdmin,
  controller.deletePassageGroup
);
router.put(
  "/passage/:passageId",
  authMiddleware,
  controller.requireAdmin,
  controller.updatePassageGroup
);

module.exports = router;
