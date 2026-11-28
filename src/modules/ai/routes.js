const router = require('express').Router();
const { authMiddleware } = require('../../middlewares/auth');
const overviewForUser = require('./learningOverview').createLearningOverview({ pool: require('../../../db') });
router.use(authMiddleware);
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
router.get('/me/overview', handle(async (req, res) => {
  res.json(await overviewForUser(req.user.user_id));
}));
router.get('/me/part-assessment', handle(async (req, res) => {
  res.json(await overviewForUser(req.user.user_id));
}));
// Explicit stateless inference: GET remains read-only and never starts a model.
const {estimateProfile,demoOverview} = require('./partProfileExperiment');
const pending = new Set();
router.post('/me/part-assessment/experiment', handle(async (req,res) => {
  const body=req.body || {};
  if(Object.keys(body).some(k=>k!=='demo') || (body.demo!==undefined && typeof body.demo!=='string')) return res.status(400).json({error:'Chỉ nhận mã hồ sơ demo hoặc body rỗng cho lịch sử của bạn.'});
  const owner=req.user.user_id;
  if(pending.has(owner))return res.status(429).json({error:'Đang tính tín hiệu AI. Vui lòng chờ.'});
  pending.add(owner);
  try{
    const overview=body.demo===undefined?await overviewForUser(owner):demoOverview(body.demo);
    res.json(await estimateProfile(overview,{synthetic:body.demo!==undefined}));
  }finally{pending.delete(owner);}
}));
module.exports = router;
