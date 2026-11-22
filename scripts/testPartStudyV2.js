// In-memory fixtures only. No PostgreSQL writes or model training.
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('./partStudyV2Policy');
const {fingerprint}=require('../src/modules/ai/appQuestionFeatures');
function setup(){
 const s={context:{as_of:'2026-11-21T12:00:00Z'},users:[{user_id:10}],tests:[],questions:[],attempts:[]};
 const design={version:p.version,purpose:'workflow_pilot',participants:[{user_id:10}],history_floor_distinct:10,
  measurement_conditions:'Memory fixture controlled session; no B feedback before measurement',maximum_target_hours:24,reviewed_by:'Fixture reviewer',acceptance:{},forms:[]};
 let id=0;
 for(let part=1;part<=7;part++){
  const a=part===1||part===5?[part*10+1,part*10+2]:[part*10+1],b=part*10+3;
  design.forms.push({part,history_test_ids:a,target_test_id:b,history_mode:'existing_or_new',content_reviewed:true,comparable_measurement:true,reviewed_by:'Fixture reviewer',reviewed_at:'2026-11-21T09:00:00Z',comparability_rationale:'Memory fixture only'});
  for(const test_id of [...a,b]){
   s.tests.push({test_id,title:'Memory '+test_id,is_active:true,publication_status:'published'});
   const qs=Array.from({length:part===1?6:10},()=>({question_id:++id,test_id,part_number:part,question_text:'Memory '+id,correct_answer:'A',
    choices:(part===2?['A','B','C']:['A','B','C','D']).map(choice_label=>({choice_label,choice_text:'Choice '+choice_label})),
    material_audio:part<=4?'/uploads/'+test_id+'.mp3':null,image_url:part===1?'/uploads/'+id+'.png':null,passage_content:part>=6?'Passage '+test_id:null}));
   s.questions.push(...qs);
   if(a.includes(test_id))s.attempts.push({attempt_id:test_id,user_id:10,test_id,is_completed:true,start_time:'2026-11-21T09:00:00Z',end_time:'2026-11-21T10:00:00Z',answers:qs.map(q=>({question_id:q.question_id,question_snapshot:q,user_answer:'A'}))});
  }
 }
 const frozen=p.freezeDesign(design,s),protocol={version:p.version,protocol_sha256:'memory',frozen_at:'2026-11-21T11:00:00Z',design:frozen};
 return {s,design,protocol};
}
test('two six-question A forms supply 12 distinct Part 1 answers, existing Part 5 needs no replay',()=>{
 const x=setup(),r=p.readiness(x.protocol,x.s,10);assert.equal(r.ready,true);assert.equal(r.history.parts[0].distinct,12);assert.equal(r.history.parts[4].input.part_answered_count,20);
});
test('missing one A form and blanks below distinct floor block capture',()=>{
 const x=setup();x.s.attempts=x.s.attempts.filter(a=>a.test_id!==12);const r=p.readiness(x.protocol,x.s,10);assert.equal(r.ready,false);assert.ok(r.blockers.some(b=>b.test_id===12));assert.ok(r.blockers.some(b=>b.reason==='insufficient_distinct_answered_history'));
});
test('explicit after-registration mode rejects old history',()=>{
 const x=setup();x.protocol.design.forms[4].history_mode='after_registration';assert.equal(p.readiness(x.protocol,x.s,10).ready,false);
});
test('incomplete B exposure prevents registration and capture even without submitted answers',()=>{
 const x=setup(),f=x.protocol.design.forms[0];x.s.attempts.push({attempt_id:999,user_id:10,test_id:f.target_test_id,is_completed:false,start_time:'2026-11-21T10:00:00Z',answers:[]});
 assert.throws(()=>p.freezeDesign(x.design,x.s),/exposed/);assert.ok(p.readiness(x.protocol,x.s,10).blockers.some(b=>b.reason==='target_already_exposed'));
});
test('changed A content and wrong owner cannot satisfy required history',()=>{
 const x=setup();x.s.attempts[0].answers[0].question_snapshot={...x.s.attempts[0].answers[0].question_snapshot,question_text:'Changed'};
 assert.equal(p.readiness(x.protocol,x.s,10).ready,false);assert.throws(()=>p.readiness(x.protocol,x.s,11),/Unregistered/);
});
test('content review, horizon and confirmation criteria cannot be fabricated by defaults',()=>{
 const x=setup();x.design.forms[0].content_reviewed=false;assert.throws(()=>p.freezeDesign(x.design,x.s),/review/);
 x.design.forms[0].content_reviewed=true;x.design.maximum_target_hours=null;assert.throws(()=>p.assertDesign(x.design),/horizon/);
 x.design.maximum_target_hours=24;x.design.purpose='confirmation';assert.throws(()=>p.assertDesign(x.design),/acceptance/);
});
test('overlapping form IDs, shared stimuli and unpublished forms are rejected',()=>{
 const x=setup();x.design.forms[0].target_test_id=11;assert.throws(()=>p.freezeDesign(x.design,x.s),/distinct/);
 const y=setup();y.s.questions.find(q=>q.test_id===13).material_audio='/uploads/11.mp3';assert.throws(()=>p.freezeDesign(y.design,y.s),/overlap/);
 const z=setup();z.s.tests.find(t=>t.test_id===13).publication_status='draft';assert.throws(()=>p.freezeDesign(z.design,z.s),/unpublished/);
});
test('all V2 output features and model identity must match frozen history',()=>{
 const x=setup(),h=p.readiness(x.protocol,x.s,10).history;
 const rs=h.parts.map(a=>({part:a.part,model:'lightgbm_v2',artifact_sha256:'hash',probability:.6,features:{part:a.part,user_acc:(a.input.correct_count+1)/(a.input.answered_count+2),user_part_acc:a.baseline_probability,attempt_count:a.input.answered_count,user_part_count:a.input.part_answered_count,prior_elapsed_seconds:21,elapsed_time_missing:1}}));
 assert.doesNotThrow(()=>p.validatePredictions(h,rs,'hash',21));rs[0].features.attempt_count++;assert.throws(()=>p.validatePredictions(h,rs,'hash',21),/mismatch/);assert.throws(()=>p.validatePredictions(h,rs.slice(1),'hash',21),/seven/);
});
function measured(){
 const x=setup(),h=p.readiness(x.protocol,x.s,10).history;
 const frozen={version:p.version,protocol_sha256:'memory',user_id:10,as_of:x.s.context.as_of,recorded_at:'2026-11-21T12:00:01Z',...h,parts:h.parts.map(a=>({...a,status:'ready',probability:.7}))};
 const targets=x.protocol.design.forms.map(f=>({attempt_id:f.target_test_id,user_id:10,test_id:f.target_test_id,is_completed:true,start_time:'2026-11-21T12:01:00Z',end_time:'2026-11-21T12:02:00Z',answers:x.s.questions.filter(q=>q.test_id===f.target_test_id).map(q=>({question_id:q.question_id,question_snapshot:q,user_answer:'A',first_answer_at:'2026-11-21T12:01:05Z'}))}));
 return {...x,frozen,targets};
}
test('new protocol reuses old independent target evaluator without approving production',()=>{
 const x=measured(),r=p.evaluate(x.frozen,[...x.s.attempts,...x.targets],x.protocol);assert.equal(r.units.length,7);assert.equal(r.version,p.version);assert.equal(r.production_ai_enabled,false);assert.equal(r.cohort,'development');
});
test('pre-capture target, changed target, missing revisions and time horizon are excluded',()=>{
 for(const [mutate,reason] of [
  [a=>a.start_time='2026-11-21T12:00:00Z','target_not_after_capture'],
  [a=>a.answers[0].first_answer_at=null,'missing_first_revision_or_invalid_timing'],
  [a=>a.end_time='2026-11-23T12:00:00Z','outside_registered_measurement_horizon'],
  [a=>a.answers[0].question_snapshot={...a.answers[0].question_snapshot,question_text:'Changed'},'target_content_changed']]){
  const x=measured();mutate(x.targets[0]);const r=p.evaluate(x.frozen,x.targets,x.protocol);assert.ok(r.excluded.some(e=>e.part===1&&e.reason===reason));
 }
});
test('first incomplete target is not replaced with a later completed target',()=>{
 const x=measured();const first={...x.targets[0],attempt_id:999,is_completed:false,start_time:'2026-11-21T12:00:30Z'};
 assert.ok(p.evaluate(x.frozen,[...x.targets,first],x.protocol).excluded.some(e=>e.reason==='first_target_incomplete'));
});
test('invalid timestamps and checksum changes fail closed',()=>{
 const x=setup();x.s.attempts[0].start_time='bad';assert.throws(()=>p.readiness(x.protocol,x.s,10),/timestamps/);
 const {verify}=require('./partStudyV2');assert.throws(()=>verify({version:p.version}),/checksum/);
});
test('valid new protocol verifies locally; editing a form invalidates its checksum',()=>{
 const x=setup(),cli=require('./partStudyV2');
 const protocol={...x.protocol,hashes:cli.hashes()};delete protocol.protocol_sha256;
 protocol.protocol_sha256=cli.digest(protocol);assert.doesNotThrow(()=>cli.verify(protocol));
 protocol.design.forms[0].target_test_id=999;assert.throws(()=>cli.verify(protocol),/checksum/);
});
test('draft failure does not mutate caller design or pretend to register participants',()=>{
 const x=setup(),original=structuredClone(x.design);x.s.tests[0].publication_status='draft';
 assert.throws(()=>p.freezeDesign(x.design,x.s));assert.deepEqual(x.design,original);
});
