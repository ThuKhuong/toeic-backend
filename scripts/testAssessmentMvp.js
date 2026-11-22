// In-memory fixtures + a separate ephemeral HTTP server; no database writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildAssessment}=require('./legacy/assessment');
const {createAssessmentServer}=require('./legacy/startAssessmentMvp');
const base=Date.UTC(2026,0,1),iso=n=>new Date(n).toISOString();
function fixture(){
 const proof={question_version:'v1',status:'confirmed_original_correct',reviewed_by:'TEST ONLY',reviewed_at:iso(base-10000),source:'RAM test fixture'};
 const q={question_id:11,part_number:5,correct_answer:'A',choices:['A','B','C','D'].map(choice_label=>({choice_label,choice_text:choice_label})),learning_version:{question_version:'v1',media_verified:true,media:[]}};
 return {snapshot_id:'TEST ONLY',database:'TEST ONLY',cutoff_ms:base+10000,users:[{user_id:1,full_name:'Fixture'},{user_id:2,full_name:'Empty'}],
  attempts:[{attempt_id:1,user_id:1,is_completed:true,start_ms:base,end_ms:base+1000}],
  answers:[{attempt_id:1,question_id:11,position:1,question_snapshot:q,user_answer:'B',is_correct:false}],
  events:[{event_id:'e1',user_id:1,attempt_id:1,question_id:11,event_type:'ANSWER_SUBMITTED',received_ms:base+500,event_payload:{}}],
  observations:[{observation_id:'o1',user_id:1,attempt_id:1,question_id:11,answer:'B',correctness:false,observed_ms:base+1000,mapping_version:'map1',question_version:'v1',taxonomy_version:'test-v1',primary_kc:'r_vocabulary_context',secondary_kcs:[],bkt_eligible_at_capture:true}],
  mappings:[{mapping_version:'map1',question_id:11,question_version:'v1',taxonomy_version:'test-v1',primary_kc:'r_vocabulary_context',secondary_kcs:[],review_status:'approved',content_verified:true,audio_verified:false,reviewed_by:'TEST ONLY',reviewed_at:iso(base-10000),provenance:{content_confirmation:proof}}],
  taxonomy:[{kc_code:'r_vocabulary_context',name:'TEST KC',section:'reading',applicable_parts:'5',taxonomy_version:'test-v1'}],quality_question_ids:[],available_parts:[1,4,5]};
}
test('All seven Parts and two sections exist; zero evidence yields null accuracy',()=>{
 const r=buildAssessment(fixture(),2);assert.equal(r.parts.length,7);assert.equal(r.sections.length,2);assert.equal(r.total.accuracy,null);assert.equal(r.status,'insufficient_data');assert.equal(r.knowledge_components.status,'insufficient_data');
});
test('Actual answers are labels; LightGBM probability and events are not correctness',()=>{
 const f=fixture();f.answers[0].probability=0.99;f.events[0].event_payload={is_correct:true};const r=buildAssessment(f,1);
 assert.equal(r.total.correct,0);assert.equal(r.total.incorrect,1);assert.equal(r.method.model_inference_used,false);assert.equal(r.knowledge_components.results[0].mastery,null);
});
test('Blank excluded from answered accuracy but retained in completion denominator',()=>{
 const f=fixture();f.answers.push({...f.answers[0],question_id:12,user_answer:null});const r=buildAssessment(f,1);
 assert.equal(r.total.presented,2);assert.equal(r.total.answered,1);assert.equal(r.total.unanswered,1);assert.equal(r.total.completion_rate,0.5);
});
test('Pending, revoked, unapproved and incomplete provenance mappings are blocked',()=>{
 for(const change of [m=>m.review_status='pending_review',m=>m.review_status='rejected',m=>m.content_verified=false,m=>m.provenance={},m=>m.question_version='other',m=>m.primary_kc='unknown']){
  const f=fixture();change(f.mappings[0]);assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,0);
 }
});
test('Approval after capture cannot retrospectively relabel old evidence',()=>{
 const f=fixture();f.mappings[0].reviewed_at=iso(base+2000);assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,0);
 const g=fixture();g.observations[0].bkt_eligible_at_capture=false;assert.equal(buildAssessment(g,1).knowledge_components.eligible_observations,0);
});
test('One answer with multiple KC has exactly one primary observation',()=>{
 const f=fixture();f.taxonomy.push({...f.taxonomy[0],kc_code:'secondary'});f.mappings[0].secondary_kcs=['secondary'];f.observations[0].secondary_kcs=['secondary'];
 const r=buildAssessment(f,1);assert.equal(r.knowledge_components.results.length,1);assert.equal(r.knowledge_components.eligible_observations,1);
});
test('Repeats are reported separately without losing actual answers',()=>{
 const f=fixture();f.attempts.push({...f.attempts[0],attempt_id:2,end_ms:base+2000});f.answers.push({...f.answers[0],attempt_id:2});
 const r=buildAssessment(f,1);assert.equal(r.total.first_answers,1);assert.equal(r.total.repeat_answers,1);assert.equal(r.total.answered,2);
});
test('Incomplete, future and reversed-time attempts do not enter performance',()=>{
 for(const change of [a=>a.is_completed=false,a=>a.end_ms=base+20000,a=>a.start_ms=base+2000]){
  const f=fixture();change(f.attempts[0]);assert.equal(buildAssessment(f,1).total.answered,0);
 }
});
test('Cutoff and owner filtering exclude other learner evidence',()=>{
 const f=fixture();assert.equal(buildAssessment(f,1,{cutoffMs:base+500}).total.answered,0);assert.equal(buildAssessment(f,2).learning_events.total,0);
 assert.throws(()=>buildAssessment(f,999));assert.throws(()=>buildAssessment(f,1,{cutoffMs:base+20000}));
});
test('Deduplicates answer/event IDs and exposes stored correctness mismatch',()=>{
 const f=fixture();f.answers[0].is_correct=true;f.answers.push({...f.answers[0]});f.events.push({...f.events[0]});const r=buildAssessment(f,1);
 assert.equal(r.total.answered,1);assert.equal(r.learning_events.total,1);assert.equal(r.diagnostics.stored_correctness_mismatches,1);assert.equal(r.diagnostics.duplicate_attempt_questions,1);
});
test('Content quality needs explicit original-version resolution',()=>{
 const f=fixture();f.quality_question_ids=[11];assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,0);
 f.mappings[0].provenance.quality_resolution={...f.mappings[0].provenance.content_confirmation};assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,1);
});
test('Listening needs verified audio and versioned audio provenance',()=>{
 const f=fixture();f.answers[0].question_snapshot.part_number=4;f.taxonomy[0].section='listening';f.taxonomy[0].applicable_parts='4';
 assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,0);
 f.mappings[0].audio_verified=true;f.mappings[0].provenance.audio_confirmation={...f.mappings[0].provenance.content_confirmation,status:'verified',comparison_result:'matches_script'};
 assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,1);
 f.answers[0].question_snapshot.learning_version.media_verified=false;assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,0);
});
test('Malformed/invalid observation and secondary mapping are not verified evidence',()=>{
 for(const mutate of [f=>f.observations[0].user_id=2,f=>f.observations[0].correctness=true,f=>f.observations[0].observed_ms=base+9999,f=>f.mappings[0].secondary_kcs=['unknown']]){
  const f=fixture();mutate(f);assert.equal(buildAssessment(f,1).knowledge_components.eligible_observations,0);
 }
});
test('Builder is immutable and KC block does not erase raw Part statistics',()=>{
 const f=fixture();f.mappings=[];const before=JSON.stringify(f),r=buildAssessment(f,1);assert.equal(JSON.stringify(f),before);assert.equal(r.total.answered,1);assert.equal(r.knowledge_components.status,'insufficient_data');
});
test('Isolated API: health, report, unknown learner, cutoff, write and origin/host guards',async()=>{
 const server=createAssessmentServer(fixture());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/assessment-api`;
 try {
  assert.equal((await(await fetch(url+'/health')).json()).database_connected,false);
  assert.equal((await(await fetch(url+'/learners/1')).json()).total.answered,1);
  assert.equal((await fetch(url+'/learners/999')).status,404);
  assert.equal((await fetch(url+'/learners/1?cutoff=bad')).status,400);
  assert.equal((await fetch(url+'/learners/1',{method:'POST'})).status,405);
  assert.equal((await fetch(url+'/learners',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const hostStatus=await new Promise((resolve,reject)=>{const req=require('node:http').request({hostname:'127.0.0.1',port:server.address().port,path:'/assessment-api/learners',headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(hostStatus,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
const snapshotPath=path.resolve(__dirname,'../private/assessment-mvp/snapshot.json');
test('Actual Thủy snapshot: 3 tests, 58 responses, 198 events, zero verified KC', {skip:!fs.existsSync(snapshotPath)},()=>{
 const f=JSON.parse(fs.readFileSync(snapshotPath,'utf8')),r=buildAssessment(f,1);
 assert.equal(r.total.attempt_count,3);assert.equal(r.total.answered,58);assert.equal(r.total.correct,32);assert.equal(r.total.incorrect,26);assert.equal(r.total.unanswered,8);
 assert.equal(r.parts[3].accuracy,9/22);assert.equal(r.parts[3].correct_of_presented,9/30);assert.equal(r.learning_events.total,198);assert.equal(r.knowledge_components.eligible_observations,0);
});
