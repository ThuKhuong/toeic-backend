// Synthetic evidence exists in memory only. Never connect to PostgreSQL.
const test=require('node:test'),assert=require('node:assert/strict');
const {version,history,wilson,assertDesign,evaluate,candidatePairs,summarize}=require('./partStudyPolicy');
const {fingerprint}=require('../src/modules/ai/appQuestionFeatures');
const t='2026-11-20T12:00:00Z',start='2026-11-20T12:01:00Z',end='2026-11-20T12:02:00Z';
const q=(id,actual=1,part=5)=>({question_id:id,user_answer:actual===null?null:actual?'A':'B',first_answer_at:'2026-11-20T12:01:10Z',
 question_snapshot:{question_id:id,part_number:part,question_text:'Memory fixture '+id,correct_answer:'A',choices:['A','B','C','D'].map(choice_label=>({choice_label,choice_text:choice_label}))}});
function setup(){
 const questions=[q(1),q(2,0)];
 const protocol={version,protocol_sha256:'protocol',frozen_at:'2026-11-20T11:00:00Z',
  design:{participants:[{user_id:10,cohort:'confirmation'}],forms:[{part:5,target_test_id:2,target_items:questions.map(x=>({id:x.question_id,fingerprint:fingerprint(x.question_snapshot)}))}]}};
 const frozen={version,protocol_sha256:'protocol',user_id:10,as_of:t,recorded_at:t,exposed_ids:[],exposed_fingerprints:[],
  parts:[{part:5,status:'ready',probability:.6,baseline_probability:.5,input:{part_answered_count:10,part_correct_count:5}}]};
 const attempt={attempt_id:2,user_id:10,test_id:2,is_completed:true,start_time:start,end_time:end,answers:questions};
 return {protocol,frozen,attempt,run(a=[attempt]){return evaluate(frozen,a,protocol);}};
}
test('paired model/baseline use independent target and correct frozen baseline',()=>{
 const x=setup(),r=x.run();assert.equal(r.units.length,1);assert.equal(r.units[0].observed_rate,.5);
 assert.ok(Math.abs(r.mae_model-.1)<1e-10);assert.equal(r.mae_baseline,0);assert.equal(r.response_metrics.model.rows,2);
 assert.equal(r.production_ai_enabled,false);
});
test('first presentation cannot be skipped for an incomplete or unfavourable target',()=>{
 const x=setup();const first={...x.attempt,attempt_id:1,is_completed:false,start_time:'2026-11-20T12:00:30Z'};
 assert.equal(x.run([x.attempt,first]).excluded[0].reason,'first_target_incomplete');
});
test('capture after target start is rejected even if first answer is later',()=>{
 const x=setup();x.attempt.start_time=t;assert.equal(x.run().excluded[0].reason,'target_not_after_capture');
});
test('wrong owner never supplies a target',()=>{
 const x=setup();x.attempt.user_id=11;assert.equal(x.run().excluded[0].reason,'target_not_started');
});
test('missing first revision does not fall back to mutable answered_at',()=>{
 const x=setup();delete x.attempt.answers[0].first_answer_at;assert.equal(x.run().excluded[0].reason,'missing_first_revision_or_invalid_timing');
});
test('blank is not relabelled wrong in primary labels; completion sensitivity remains explicit',()=>{
 const x=setup();x.attempt.answers[1].user_answer=null;const r=x.run();
 assert.equal(r.units[0].answered,1);assert.equal(r.units[0].blank,1);assert.equal(r.units[0].observed_rate,1);
 assert.equal(r.units[0].all_issued_rate_sensitivity,.5);assert.equal(r.response_metrics.model.rows,1);
});
test('repeated content with changed ID is excluded',()=>{
 const x=setup();x.frozen.exposed_fingerprints=[fingerprint(x.attempt.answers[0].question_snapshot)];
 assert.equal(x.run().excluded[0].reason,'repeat_target');
});
test('an intervening incomplete exposure is excluded',()=>{
 const x=setup();const h={...x.attempt,attempt_id:3,test_id:9,is_completed:false,start_time:'2026-11-20T12:00:10Z'};
 assert.equal(x.run([h,x.attempt]).excluded[0].reason,'intervening_target_exposure');
});
test('changed content or duplicate question cannot enter registered form',()=>{
 const x=setup();x.attempt.answers[0].question_snapshot.question_text='changed';
 assert.equal(x.run().excluded[0].reason,'target_content_changed');
});
test('invalid probability and forged baseline fail closed',()=>{
 const x=setup();x.frozen.parts[0].probability=2;assert.throws(()=>x.run(),/probabilities/);
 x.frozen.parts[0].probability=.6;x.frozen.parts[0].baseline_probability=.9;assert.throws(()=>x.run(),/probabilities/);
});
test('history keeps repeated answers in V2 counts but tracks distinct content separately',()=>{
 const a={attempt_id:1,user_id:10,is_completed:true,start_time:'2026-11-20T10:00:00Z',end_time:'2026-11-20T11:00:00Z',answers:[q(1),q(1)]};
 const h=history([a,{...a,attempt_id:2,end_time:'2026-11-21T11:00:00Z'}],10,t);
 assert.equal(h.parts[4].input.part_answered_count,2);assert.equal(h.parts[4].distinct,1);
 assert.deepEqual(h.parts[4].observed_wilson_95,wilson(1,1));
 assert.equal(h.parts[0].input.part_answered_count,0);assert.deepEqual(h.source_attempt_ids,[1]);
});
test('uncertainty is observed Wilson, not fake confidence on V2',()=>{
 assert.equal(wilson(0,0),null);assert.ok(wilson(0,1)[1]>.5);assert.ok(wilson(10,10)[0]<1);
 const p=[{part:1,status:'ready',probability:.2,baseline_probability:.8,first_correct_rate:.8,observed_wilson_95:[.7,.9]},
  {part:2,status:'ready',probability:.8,baseline_probability:.2,first_correct_rate:.2,observed_wilson_95:[.1,.3]}];
 assert.equal(candidatePairs(p).pairs[0].status,'model_history_disagree');
 p[0].probability=.9;assert.equal(candidatePairs(p).pairs[0].status,'research_candidate_only');
 assert.equal(candidatePairs(p).production_ai_enabled,false);
});
test('ranking uses model, gives ties half loss, and only independent eligible Parts',()=>{
 const x=setup();const extra=q(3,1,1);x.protocol.design.forms.push({part:1,target_test_id:3,target_items:[{id:3,fingerprint:fingerprint(extra.question_snapshot)}]});
 x.frozen.parts.push({...x.frozen.parts[0],part:1,probability:.9});
 const a={...x.attempt,attempt_id:3,test_id:3,answers:[extra]};const r=x.run([x.attempt,a]);
 assert.equal(r.ranking.pairs[0].model_loss,0);assert.equal(r.ranking.pairs[0].baseline_loss,.5);
 assert.equal(r.ranking.complete_seven_parts,false);
});
test('empty cohort and unreviewed criteria cannot approve production',()=>{
 const s=summarize([],{planning:{confirmation_learners:20},acceptance:{}});
 assert.equal(s.acceptance_criteria_reviewed,false);assert.equal(s.production_ai_enabled,false);
 assert.equal(s.cohorts.confirmation.paired_learner_mae_delta_95,null);
});
test('draft forms, reused forms and unregistered users fail design validation',()=>{
 assert.throws(()=>assertDesign({version,participants:[],forms:[]}),/participants/);
 const d={version,participants:[{user_id:1,cohort:'confirmation'}],forms:Array.from({length:7},(_,i)=>({part:i+1}))};
 assert.throws(()=>assertDesign(d),/Forms/);
});
test('complete pre-registration is accepted; changing cohort counts or overlapping forms is rejected',()=>{
 const d={version,planning:{development_learners:1,confirmation_learners:1},measurement_conditions:'Supervised equivalent forms',
  participants:[{user_id:1,cohort:'development'},{user_id:2,cohort:'confirmation'}],
  forms:Array.from({length:7},(_,i)=>({part:i+1,history_test_id:i*2+1,target_test_id:i*2+2,
   reviewed_by:'Memory reviewer',reviewed_at:t,content_reviewed:true,comparable_measurement:true,comparability_rationale:'Memory test'}))};
 assert.doesNotThrow(()=>assertDesign(d));d.participants[0].cohort='confirmation';assert.throws(()=>assertDesign(d),/planned cohort/);
 d.participants[0].cohort='development';d.forms[1].target_test_id=d.forms[0].target_test_id;assert.throws(()=>assertDesign(d),/distinct/);
});
test('checksums detect protocol modifications and code/artifact mismatch without connecting to DB',()=>{
 const {hashes,digest,verifyProtocol}=require('./partStudy');
 const p={version,hashes:hashes(),design:{}};p.protocol_sha256=digest(p);
 p.hashes['toeic-ai/models/v2/lightgbm_v2.joblib']='tampered';assert.throws(()=>verifyProtocol(p),/hash mismatch/);
});
test('summary calibration uses actual answered counts and never creates a label for blank',()=>{
 const x=setup(),r=x.run();const s=summarize([r],{planning:{confirmation_learners:20},acceptance:{}});
 assert.equal(s.cohorts.confirmation.calibration_model.bins[0].answered,2);
 assert.ok(Math.abs(s.cohorts.confirmation.calibration_model.ece-.1)<1e-12);
 assert.equal(s.review_conditions.all_observed_intervals_within_reviewed_width,false);
});
