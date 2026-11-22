// Memory-only Part profile / retired endpoint regression. Never connects to PostgreSQL.
const test = require('node:test'), assert = require('node:assert/strict');
const { buildLearningOverview } = require('../src/modules/ai/learningOverview');
const { attachPartAssessment } = require('../src/modules/ai/partAssessment');
const asOf='2026-11-20T10:00:00Z',end='2026-11-20T09:00:00Z',hash='a'.repeat(64);
const rows=Array.from({length:10},(_,i)=>({attempt_id:1,end_time:end,position:i+1,question_id:i+1,user_answer:'A',
  question_snapshot:{part_number:5,question_text:'RAM '+i,correct_answer:'A',choices:['A','B','C','D'].map(choice_label=>({choice_label,choice_text:choice_label}))}}));
const attempt=()=>({attempt_id:1,user_id:2,start_time:'2026-11-20T08:00:00Z',end_time:end,
  ai_prediction:{version:'attempt_lightgbm_v1',status:'ready',as_of:end,completed_at:'2026-11-20T09:00:01Z',
    inputs:[{part:5,answered_count:10,correct_count:10,part_answered_count:10,part_correct_count:10}],
    parts:[{part:5,status:'ready',model:'lightgbm_v2',artifact_sha256:hash,feature_version:'group_history_v1',probability:.7}]}});
const profile=(a=[attempt()],r=rows)=>attachPartAssessment(buildLearningOverview(r),a,{userId:2,asOf,artifactHash:hash});
test('one profile exposes seven Parts, saved V2 experiment and rules without mastery claims',()=>{
  const p=profile();assert.equal(p.parts.length,7);assert.equal(p.profile_version,'part_assessment_v1');
  assert.equal(p.parts[4].ai.probability,.7);assert.equal(p.parts[4].ai.status,'experimental_unvalidated');
  assert.equal(p.parts[4].ai.validation_status,'not_approved');assert.equal(p.policy.strength_weakness_enabled,false);
  assert.equal(p.policy.inference_called,false);assert.equal(p.skills,undefined);
  assert.equal(p.parts[0].correct_rate,null);assert.equal(p.parts[0].ai.probability,null);
  assert.equal(p.parts[4].trend.status,'insufficient_data');
  assert.equal(JSON.stringify(p).includes('correct_answer'),false);assert.equal(JSON.stringify(p).includes('inputs'),false);
});
test('wrong-owner, future, invalid artifact/window/probability/contract forecasts stay out',()=>{
  const variations=[a=>a.user_id=3,a=>a.ai_prediction.completed_at='2026-11-21T00:00:00Z',
    a=>a.ai_prediction.parts[0].artifact_sha256='bad',a=>a.ai_prediction.completed_at='2026-11-20T08:30:00Z',
    a=>a.ai_prediction.as_of='2026-11-20T08:00:00Z',a=>a.ai_prediction.parts[0].probability=2,
    a=>a.ai_prediction.version='history-v1',a=>a.ai_prediction.status='failed',a=>a.ai_prediction.inputs=[],
    a=>a.ai_prediction.parts[0].feature_version='wrong',a=>a.ai_prediction.inputs[0].part_correct_count=99];
  for(const mutate of variations){const a=attempt();mutate(a);assert.equal(profile([a]).parts[4].ai.probability,null);}
});
test('few distinct answers gate experiment independently of repeat counts',()=>{
  const r=rows.map(r=>({...r,question_id:1,question_snapshot:rows[0].question_snapshot}));
  const p=profile([attempt()],r);assert.equal(p.parts[4].first_answers.answered,1);
  assert.equal(p.parts[4].ai.status,'insufficient_data');assert.equal(p.parts[4].ai.probability,null);
});
test('PostgreSQL Date values preserve millisecond cutoff and match frozen ISO timestamps',()=>{
  const a=attempt();a.end_time=new Date('2026-11-20T09:00:00.880Z');
  a.start_time=new Date('2026-11-20T08:00:00.748Z');
  a.ai_prediction.as_of='2026-11-20T09:00:00.880Z';a.ai_prediction.completed_at='2026-11-20T09:00:01.012Z';
  const p=attachPartAssessment(buildLearningOverview(rows),[a],{userId:2,asOf:new Date('2026-11-20T10:00:00.203Z'),artifactHash:hash});
  assert.equal(p.parts[4].ai.status,'experimental_unvalidated');
  assert.equal(p.parts[4].ai.as_of,'2026-11-20T09:00:00.880Z');
  assert.equal(p.source.as_of,'2026-11-20T10:00:00.203Z');
});
test('reading forecasts never mutates the original attempt or invokes inference',()=>{
  const a=attempt(),before=JSON.stringify(a);profile([a]);assert.equal(JSON.stringify(a),before);
  assert.throws(()=>attachPartAssessment(buildLearningOverview([]),[],{userId:2,asOf:'invalid'}));
});
test('retired prediction/training/Node assessment APIs are not mounted; auth still applies',async()=>{
  const db=require.resolve('../db'),previous=require.cache[db];
  require.cache[db]={id:db,filename:db,loaded:true,exports:{connect:async()=>{throw Error('Retired routes must not query DB');}}};
  process.env.JWT_SECRET='MEMORY_PART_PROFILE_TEST';
  const express=require('express'),jwt=require('jsonwebtoken'),app=express();
  app.use(express.json());app.use('/api/ai',require('../src/modules/ai/routes'));
  app.use((req,res)=>res.status(404).json({error:'not_found'}));
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  const base=`http://127.0.0.1:${s.address().port}/api/ai`;
  const token=jwt.sign({user_id:2,role:'ADMIN'},process.env.JWT_SECRET);
  try {for(const [method,url]of [['POST','/admin/train'],['GET','/admin/status'],['POST','/me'],['GET','/me'],['POST','/me/predict']]){
    const response=await fetch(base+url,{method,headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,404,url);
  }assert.equal((await fetch(base+'/me/overview')).status,401);
  }finally{s.closeAllConnections();await new Promise(r=>s.close(r));if(previous)require.cache[db]=previous;else delete require.cache[db];}
});
