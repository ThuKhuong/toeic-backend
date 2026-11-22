const express = require('express');
const { authMiddleware, adminMiddleware } = require('../../middlewares/auth');
const { createAdminLearningReport } = require('./adminLearningReport');
function createAdminLearningReportRouter({ pool, hashes }) {
  const router = express.Router();
  const report = createAdminLearningReport({ pool, hashes });
  router.use(authMiddleware, adminMiddleware, (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  const handle = fn => async (req,res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'Không đọc được báo cáo. Kiểm tra backend 3000 và database toeic_learning_system.' }); }
  };
  router.get('/learners', handle(() => report.list()));
  router.get('/learners/:user_id', handle(req => {
    if (!/^[1-9]\d*$/.test(req.params.user_id)) throw Object.assign(Error('Mã người học không hợp lệ.'),{status:400});
    return report.detail(Number(req.params.user_id));
  }));
  return router;
}
module.exports = { createAdminLearningReportRouter };
