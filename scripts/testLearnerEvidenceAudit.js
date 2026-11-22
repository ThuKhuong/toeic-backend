// Pure in-memory fixtures: no learners inserted and no database connection.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyze}=require('./auditLearnerEvidence');
const {gradeAttempt}=require('../src/modules/tests/grading');
const {versionOf}=require('../src/modules/learning/version');
function fixture() {
  const q={question_id:11,part_number:5,correct_answer:'A',choices:[{choice_label:'A',is_correct:true},{choice_label:'B',is_correct:false}],learning_version:{question_version:'unit-test-only'}};
  const row={attempt_id:1,question_id:11,question_snapshot:q,user_answer:'A',is_correct:true,time_spent:4};
  const a={attempt_id:1,user_id:7,is_completed:true,valid_time_window:true,total_questions:1,total_correct:1,grading_result:gradeAttempt([row]),elapsed_wall_seconds:4};
  return {attempts:[a],answers:[row],events:[{event_id:'e1',event_type:'ANSWER_SUBMITTED',attempt_id:1,question_id:11,question_version:versionOf(q),client_session_id:'s',client_sequence:1,user_id:7,source:'client',event_payload:{new_answer:'A'}},
    {event_id:'e2',event_type:'ATTEMPT_COMPLETED',attempt_id:1,user_id:7,source:'server',event_payload:{}}],
    observations:[{attempt_id:1,question_id:11,answer:'A',correctness:true,question_version:versionOf(q),prior_response_count:0,is_first_response:true,exclusion_reason:'no_approved_mapping'}],
    revisions:[{attempt_id:1,question_id:11,new_answer:'A',correctness:true,baseline_known:true}],bktReady:0};
}
test('Actual correctness and descriptive output never invent KC mastery',()=>{
  const r=analyze(fixture());assert.deepEqual(r.issues,[]);assert.equal(r.parts[0].correct,1);assert.equal(r.observations.eligible,0);assert.equal(r.kc_assessment_status,'insufficient_approved_evidence');
});
test('Detects corrupted grading, version and duplicate event evidence',()=>{
  const d=fixture();d.answers[0].is_correct=false;d.events[0].question_version='wrong';d.events.push({...d.events[0]});
  const types=analyze(d).issues.map(i=>i.type);for(const t of ['grading_mismatch','event_version_mismatch','duplicate_events'])assert.ok(types.includes(t));
});
test('A blank is not a BKT answer observation',()=>{
  const d=fixture();d.answers[0].user_answer=null;const r=analyze(d);assert.equal(r.parts[0].unanswered,1);assert.ok(r.issues.some(i=>i.type==='blank_has_observation'));
});
test('Detects client answer disagreement with persisted final response',()=>{
  const d=fixture();d.events[0].event_payload.new_answer='B';assert.ok(analyze(d).issues.some(i=>i.type==='client_final_differs_from_persisted'));
});
test('Later revisions with baseline_known=false do not imply missing initial baseline',()=>{
  const d=fixture();d.revisions.push({attempt_id:1,question_id:11,new_answer:'B',correctness:false,baseline_known:false});assert.equal(analyze(d).revisions.baseline_unknown,0);
});
test('Repeat indicator is verified rather than trusted',()=>{
  const d=fixture();d.observations[0].is_first_response=false;assert.ok(analyze(d).issues.some(i=>i.type==='first_repeat_mismatch'));
});
