const express = require('express');
const service = require('./vocabularyLearningService');
const router = express.Router();

const handle = work => async (req, res, next) => {
  try { res.json(await work(req)); } catch (error) { next(error); }
};
router.get('/learning', handle(req => service.getProgress(req.user.user_id)));
router.put('/:vocabId/saved', handle(req => service.saveWord(req.user.user_id, req.params.vocabId, req.body?.saved)));
router.post('/study/sessions', handle(req => service.startStudy(req.user.user_id, req.body ?? {})));
router.put('/study/sessions/:sessionId/card', handle(req => service.rateCard(req.user.user_id, req.params.sessionId, req.body ?? {})));
router.post('/quiz/sessions', handle(req => service.startQuiz(req.user.user_id, req.body ?? {})));
router.post('/quiz/sessions/:sessionId/finish', handle(req => service.finishQuiz(req.user.user_id, req.params.sessionId, req.body ?? {})));

module.exports = router;
