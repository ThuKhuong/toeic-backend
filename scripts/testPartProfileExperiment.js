const test=require('node:test'),assert=require('node:assert/strict');
const {demoOverview,estimateProfile}=require('../src/modules/ai/partProfileExperiment');
const hash='a'.repeat(64);
function predict(fn=p=>p/10){return async i=>({part:i.part,model:'lightgbm_v2',artifact_sha256:hash,probability:fn(i.part),features:{part:i.part,user_acc:(i.correct_count+1)/(i.answered_count+2),user_part_acc:(i.part_correct_count+1)/(i.part_answered_count+2),attempt_count:i.answered_count,user_part_count:i.part_answered_count,prior_elapsed_seconds:21,elapsed_time_missing:1}});}
const run=(id,options={})=>estimateProfile(demoOverview(id),{synthetic:true,artifactHash:hash,medianSeconds:21,predict:predict(),...options});
test('new learner keeps all Parts empty without calling AI',async()=>{
 const r=await run('new',{predict:async()=>{throw Error('must not call');}});assert.equal(r.parts.length,7);assert.equal(r.experiment.inference_requests,0);assert.equal(r.experiment.order_low_to_high.length,0);assert.ok(r.parts.every(p=>p.ai.probability===null));
});
test('one Part may have a model signal but cannot establish relative strength',async()=>{
 const r=await run('single');assert.equal(r.parts[4].ai.probability,.5);assert.equal(r.experiment.order_low_to_high.length,0);assert.deepEqual(r.experiment.demo_recommendations,[]);assert.equal(r.policy.strength_weakness_enabled,false);
});
test('model affects priority, recommendations and order; statistics remain unchanged',async()=>{
 const a=await run('seven'),b=await run('seven',{predict:predict(p=>(8-p)/10)});
 assert.equal(a.experiment.order_low_to_high[0].part,1);assert.equal(b.experiment.order_low_to_high[0].part,7);
 assert.equal(a.experiment.demo_recommendations[0].part,1);assert.equal(b.experiment.demo_recommendations[0].part,7);
 assert.equal(a.recommendations[0].part,1);assert.equal(b.recommendations[0].part,7);
 assert.equal(a.experiment.learner_ai_recommendations_enabled,true);
 assert.equal(a.experiment.strength_weakness_enabled,true);
 assert.ok(a.parts.every(p=>p.history_points.length===3&&p.repeat_answers===10&&p.content_distinct_answered===40));
});
test('real learner view enables AI competency ranking and recommendations when at least two Parts meet evidence floor',async()=>{
 const r=await run('seven',{synthetic:false});assert.equal(r.source.mode,'live_readonly');
 assert.equal(r.experiment.demo_recommendations[0].part,1);
 assert.equal(r.experiment.strength_weakness_enabled,true);
 assert.equal(r.experiment.learner_ai_recommendations_enabled,true);
 assert.equal(r.parts[0].ai.relative_role,'weakness');
 assert.equal(r.parts[6].ai.relative_role,'strength');
});
test('AI outage preserves statistics and does not substitute baseline for AI',async()=>{
 const original=demoOverview('seven'),r=await run('seven',{predict:async()=>{throw Error('offline');}});
 assert.deepEqual(r.totals,original.totals);assert.equal(r.experiment.order_low_to_high.length,0);assert.ok(r.parts.every(p=>p.ai.status==='unavailable'&&p.ai.probability===null));
});
test('bad model, feature, artifact and probability responses fail closed',async()=>{
 for(const change of [r=>r.artifact_sha256='wrong',r=>r.model='wrong',r=>r.features.user_acc=NaN,r=>r.features.elapsed_time_missing=0,r=>r.probability=2]){
  const r=await run('single',{predict:async i=>{const r=await predict()(i);change(r);return r;}});assert.equal(r.parts[4].ai.status,'unavailable');
 }
});
test('model ties do not invent a unique demo priority',async()=>{const r=await run('seven',{predict:predict(()=>.5)});assert.equal(r.experiment.order_low_to_high.length,7);assert.deepEqual(r.experiment.demo_recommendations,[]);});
test('only fixed demo names accepted; original overview is immutable',async()=>{
 assert.throws(()=>demoOverview('Vy'),e=>e.status===400);const o=demoOverview('seven'),before=JSON.stringify(o);await estimateProfile(o,{synthetic:true,predict:predict(),artifactHash:hash,medianSeconds:21});assert.equal(JSON.stringify(o),before);assert.equal(JSON.stringify(o).includes('user_id'),false);
});
test('duplicate content IDs cannot meet ranking floor',async()=>{
 const {buildLearningOverview}=require('../src/modules/ai/learningOverview');const snapshot={part_number:5,question_text:'Same',correct_answer:'A',choices:[{choice_label:'A',choice_text:'one'},{choice_label:'B',choice_text:'two'}]};
 const o=buildLearningOverview(Array.from({length:20},(_,i)=>({question_id:i,attempt_id:1,end_time:'2026-11-01',position:i,question_snapshot:snapshot,user_answer:'A'})));
 const r=await estimateProfile(o,{asOf:'2026-11-02',artifactHash:hash,medianSeconds:21,predict:predict()});assert.equal(r.parts[4].content_distinct_answered,1);assert.equal(r.parts[4].ai.rank_eligible,false);
});
test('demo API requires auth, cannot accept user IDs and never queries learner DB',async()=>{
 const db=require.resolve('../db'),previous=require.cache[db],realFetch=global.fetch;let dbCalls=0;
 require.cache[db]={id:db,filename:db,loaded:true,exports:{connect:async()=>{dbCalls++;throw Error('No DB in demo');}}};
 process.env.JWT_SECRET='DEMO_MEMORY_TEST';const express=require('express'),jwt=require('jsonwebtoken'),app=express();app.use(express.json());app.use('/api/ai',require('../src/modules/ai/routes'));
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/ai/me/part-assessment/experiment`,token=jwt.sign({user_id:2,role:'STUDENT'},process.env.JWT_SECRET);
 try{
  const request=(body,auth=true)=>realFetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  assert.equal((await request({demo:'new'},false)).status,401);
  assert.equal((await request({demo:'new',user_id:5})).status,400);
  assert.equal((await request({demo:'invalid'})).status,400);
  const r=await request({demo:'new'});assert.equal(r.status,200);assert.equal((await r.json()).experiment.synthetic,true);assert.equal(dbCalls,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(previous)require.cache[db]=previous;else delete require.cache[db];}
});
