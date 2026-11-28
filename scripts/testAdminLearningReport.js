// HTTP/auth tests with in-memory query doubles; no PostgreSQL fixtures or writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createAdminLearningReport, buildAdminReport } = require('../src/modules/ai/adminLearningReport');
const { createAdminLearningReportRouter } = require('../src/modules/ai/adminLearningReportRoutes');
const secret = 'PHASE2_UNIT_TEST_ONLY';
process.env.JWT_SECRET = secret;
const context = { database:'toeic_learning_system', marker:'TOEIC_UNIFIED_DEVELOPMENT',
  read_only:'on', as_of:'2026-11-18T03:00:00Z' };
const learner = {user_id:1,full_name:'Memory learner A',email:'not-for-client',password:'private'};
const hashes={v2:'a'.repeat(64),v3:'b'.repeat(64)};
const attempt=(id=10,user=1)=>({attempt_id:id,user_id:user,start_time:'2026-11-18T01:00:00Z',end_time:'2026-11-18T02:00:00Z'});
const answer=(id,part=5,user=1,aid=10,value='A')=>({user_id:user,attempt_id:aid,end_time:'2026-11-18T02:00:00Z',position:id,question_id:id,
  user_answer:value,question_snapshot:{part_number:part,correct_answer:'A',question_text:'Memory only '+id,
    choices:[...(part===2?'ABC':'ABCD')].map(choice_label=>({choice_label,choice_text:choice_label}))}});
function report(rows=[],attempts=[attempt()],events=[]){return buildAdminReport(learner,rows,attempts,events,context,hashes,[1,2,3,4,5,6,7]);}

test('seven Parts, blank vs missing, first/repeat and insufficient/descriptive remain distinct',()=>{
  const rows=Array.from({length:10},(_,i)=>answer(i+1));
  rows.push(answer(40,2,1,10,null),answer(1,5,1,11,'B'));
  const r=report(rows,[attempt(),attempt(11)]);
  assert.equal(r.parts.length,7);
  assert.equal(r.parts[0].evidence_status,'no_data');
  assert.equal(r.parts[1].evidence_status,'insufficient_data');
  assert.equal(r.parts[1].unanswered,1);
  assert.equal(r.parts[4].evidence_status,'descriptive_history');
  assert.equal(r.parts[4].first_answers,10);
  assert.equal(r.parts[4].repeat_answers,1);
  assert.equal(r.parts[4].incorrect,1);
  assert.equal(r.parts[4].attempt_count,2);
  assert.equal(r.policy.strength_weakness_enabled,false);
});

test('foreign learner, future attempts and malformed answers cannot change learner totals',()=>{
  const future={...attempt(12),end_time:'2026-11-18T04:00:00Z'};
  const r=report([answer(1),answer(2,5,2,20),answer(3,5,1,12),answer(4,2,1,10,'D')],
    [attempt(),attempt(20,2),future]);
  assert.equal(r.total.answered,1);
  assert.equal(r.total.unanswered,1);
  assert.equal(r.total.attempt_count,1);
  assert.equal(r.diagnostics.invalid_answers,1);
  assert.equal(r.source.last_completed_at,'2026-11-18T02:00:00.000Z');
});

test('saved experimental AI is distinct from ability; reject late/bad artifact records',()=>{
  const a=attempt();
  a.question_predictions={status:'ready',version:'app_question_catalog_v1',mode:'app_observation_only',
    model:'lightgbm_question_catalog_v3',artifact_sha256:hashes.v3,as_of:a.start_time,recorded_at:'2026-11-18T01:00:01Z',
    questions:[{question_id:1,part:5,probability:0.6},{question_id:999,part:5,probability:0.8}]};
  a.ai_prediction={as_of:a.end_time,completed_at:'2026-11-18T02:00:01Z',parts:[{status:'ready',part:5,model:'lightgbm_v2',artifact_sha256:hashes.v2,probability:0.7}]};
  const r=report([answer(1)],[a]);
  assert.equal(r.parts[4].ai.status,'ready');
  assert.equal(r.parts[4].evidence_status,'insufficient_data');
  assert.equal(r.parts[4].ai.v2_forecasts,1);
  assert.equal(r.parts[4].ai.v3_question_predictions,1);
  assert.equal(r.diagnostics.rejected_prediction_records,1);
  a.question_predictions.recorded_at='2026-11-18T02:30:00Z';
  a.ai_prediction.parts[0].artifact_sha256='wrong';
  assert.equal(report([answer(1)],[a]).parts[4].ai.status,'not_recorded');
});

function memoryPool(options={}) {
  const calls=[];let connections=0,releases=0;
  const pool={async connect(){connections++;return {release(){releases++;},async query(sql,args=[]){
    calls.push({sql,args});
    if(/^(BEGIN|ROLLBACK|SET LOCAL)/.test(sql))return {rows:[]};
    if(sql.includes('current_database()'))return {rows:[{...context,...options.context}]};
    if(options.fail)throw Error('private database credential error');
    if(sql.includes('FROM "User"'))return {rows:args.length?(args[0]===1?[learner]:[]):[learner]};
    if(sql.includes('ai_prediction,question_predictions'))return {rows:[attempt()]};
    if(sql.includes('aq.position,aq.question_id')){assert.equal(args[0],1);assert.equal(args[1],context.as_of);return {rows:[answer(1)]};}
    if(sql.includes('GROUP BY e.event_type')){assert.equal(args[0],1);assert.match(sql,/e.user_id=\$1/);assert.match(sql,/a.user_id=\$1/);return {rows:[{event_type:'ANSWER_SUBMITTED',count:1,after_completion:0,latest_received_at:context.as_of}]};}
    if(sql.includes('SELECT DISTINCT q.part_number'))return {rows:[{part_number:5}]};
    throw Error('Unexpected SQL '+sql);
  }}}};
  return {pool,calls,get connections(){return connections;},get releases(){return releases;}};
}
async function httpServer(options={}){
  const mem=memoryPool(options),app=express();
  app.use('/api/admin/learning-reports',createAdminLearningReportRouter({pool:mem.pool,hashes}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/admin/learning-reports`;
  return {mem,close:()=>new Promise(r=>server.close(r)),request:(p,role='ADMIN',method='GET')=>fetch(base+p,{method,
    headers:role?{Authorization:'Bearer '+jwt.sign({user_id:88,role},secret)}:{}})};
}

test('HTTP requires JWT/admin before opening DB; rejects write methods',async()=>{
  const s=await httpServer();try{
    assert.equal((await s.request('/learners',null)).status,401);
    assert.equal((await s.request('/learners','STUDENT')).status,403);
    assert.equal(s.mem.connections,0);
    assert.equal((await s.request('/learners','ADMIN','POST')).status,404);
    assert.equal(s.mem.connections,0);
  }finally{await s.close();}
});

test('HTTP DTO excludes answer keys, raw events, account fields and model inputs',async()=>{
  const s=await httpServer();try{
    const list=await s.request('/learners');assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');
    assert.deepEqual((await list.json()).learners,[{user_id:1,full_name:learner.full_name}]);
    const r=await s.request('/learners/1');assert.equal(r.status,200);const data=await r.json();
    assert.equal(data.total.answered,1);assert.equal(data.learning_events.total,1);
    const keys=[];const visit=x=>{if(x&&typeof x==='object')for(const[k,v]of Object.entries(x)){keys.push(k);visit(v);}};visit(data);
    for(const key of ['email','password','correct_answer','question_snapshot','choices','event_payload','probability','features','ai_prediction','question_predictions'])assert.ok(!keys.includes(key),key);
    assert.ok(s.mem.calls.some(q=>q.sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert.ok(!s.mem.calls.some(q=>/^(INSERT|UPDATE|DELETE|COMMIT|CREATE)/.test(q.sql)));
    assert.equal(s.mem.releases,2);
    assert.equal((await s.request('/learners/2')).status,404);
    assert.equal((await s.request('/learners/1e0')).status,400);
  }finally{await s.close();}
});

test('actual DB guard rejects source DB/incorrect marker and releases transaction',async()=>{
  for(const change of [{database:'toeic_learning_events_dev'},{marker:'wrong'},{read_only:'off'}]){
    const s=await httpServer({context:change});try{
      assert.equal((await s.request('/learners')).status,503);
      assert.ok(!s.mem.calls.some(q=>q.sql.includes('FROM "User"')));
      assert.match(s.mem.calls.at(-1).sql,/ROLLBACK/);assert.equal(s.mem.releases,1);
    }finally{await s.close();}
  }
});

test('DB failure is an error, not fabricated zeros or leaked connection details',async()=>{
  const mem=memoryPool({fail:true});
  await assert.rejects(createAdminLearningReport({pool:mem.pool,hashes}).list());
  assert.equal(mem.releases,1);
  const s=await httpServer({fail:true});try{
    const r=await s.request('/learners');assert.equal(r.status,503);
    const text=await r.text();assert.ok(!text.includes('credential'));assert.ok(!text.includes('total'));
  }finally{await s.close();}
});
