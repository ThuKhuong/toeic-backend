const express = require("express");
const router = express.Router();
const { authMiddleware } = require('../../middlewares/auth');
const service = require('./vocabularyPersonalService');
router.use(authMiddleware);

router.use(require('./vocabularyLearningRoutes'));

const handle = work => async (req, res, next) => {
  try { res.json(await work(req)); } catch (error) { next(error); }
};
router.get('/', handle(req => service.list(req.user.user_id)));
router.get('/dictionary', handle(req => service.dictionary(req.query.q)));
router.get('/categories/list', handle(req => service.topics(req.user.user_id)));
router.post('/topics', handle(req => service.createTopic(req.user.user_id, req.body ?? {})));
router.put('/topics/:id', handle(req => service.updateTopic(req.user.user_id, req.params.id, req.body ?? {})));
router.delete('/topics/:id', handle(req => service.deleteTopic(req.user.user_id, req.params.id)));
router.post('/', handle(req => service.createWord(req.user.user_id, req.body ?? {})));
router.put('/:id', handle(req => service.updateWord(req.user.user_id, req.params.id, req.body ?? {})));
router.delete('/:id', handle(req => service.deleteWord(req.user.user_id, req.params.id)));

module.exports = router;
