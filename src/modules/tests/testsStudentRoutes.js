const express = require("express");
const router = express.Router();
const controller = require("./testsStudentController");
const { authMiddleware } = require("../../middlewares/auth");

router.get("/", controller.getAllTests);

// Attempt-related routes MUST come before the catch-all ":id" route
router.get(
  "/attempts/user/:user_id",
  authMiddleware,
  controller.getUserAttempts
);
router.post("/:id/attempt", authMiddleware, controller.startAttempt);
const attempts = require('./attemptService');
router.get('/attempts/:attempt_id/resume',authMiddleware,async(req,res)=>{
  try { res.json(await attempts.resumeAttempt(req.params.attempt_id,req.user.user_id)); }
  catch(e) { res.status(e.status || 500).json({error:e.status ? e.message : 'Server error'}); }
});
router.put('/attempts/:attempt_id/progress',authMiddleware,async(req,res)=>{
  try { res.json(await attempts.saveProgress(req.params.attempt_id,req.user.user_id,req.body)); }
  catch(e) { res.status(e.status || 500).json({error:e.status ? e.message : 'Server error'}); }
});
router.put(
  "/attempts/:attempt_id/answer",
  authMiddleware,
  controller.submitAnswer
);
router.put(
  "/attempts/:attempt_id/complete",
  authMiddleware,
  controller.finishAttempt
);
router.get(
  "/attempts/:attempt_id/results",
  authMiddleware,
  controller.getResults
);

// Test detail (placed last to avoid swallowing /attempts/...)
router.get("/:id", controller.getTest);

module.exports = router;
