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
module.exports = router;
