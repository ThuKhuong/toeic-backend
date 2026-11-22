const router=require('express').Router();
const {authMiddleware}=require('../../middlewares/auth');
const pool=require('../../../db');
const service=require('./service');
router.use(authMiddleware);
router.post('/batch',async(req,res)=>{
  try {res.json(await service.ingest(pool,req.user.user_id,req.body.events));}
  catch(error){res.status(error.status||503).json({error:error.status?error.message:'Event storage unavailable; retain queue and retry'});}
});
router.get('/attempts/:attempt_id/questions/:question_id/history',async(req,res)=>{
  try {
    if(!service.enabled())return res.status(503).json({error:'Learning tracking is not enabled'});
    const a=Number(req.params.attempt_id),q=Number(req.params.question_id);
    if(!Number.isSafeInteger(a)||a<1||!Number.isSafeInteger(q)||q<1)return res.status(400).json({error:'Invalid ID'});
    res.json(await service.answerHistory(pool,req.user.user_id,a,q));
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:'Server error'});}
});
module.exports=router;
