const test=require('node:test'),assert=require('node:assert/strict');
const {history}=require('./partStudyPolicy');
const {buildResearchProfile,auditForms}=require('./appPartResearchPolicy');
const asOf='2026-11-20T12:00:00Z',end='2026-11-20T11:00:00Z',hash='a'.repeat(64);
const question=(id,part=5)=>({question_id:id,part_number:part,question_text:'Memory '+id,correct_answer:'A',
 choices:(part===2?['A','B','C']:['A','B','C','D']).map(choice_label=>({choice_label,choice_text:choice_label})),
 ...(part<=4?{material_audio:'audio-'+id,image_url:'image-'+id}:{}),...(part>=6?{passage_content:'Passage '+id}:{})});
function setup(){
 const attempts=[{attempt_id:1,user_id:2,test_id:1,is_completed:true,start_time:'2026-11-20T10:00:00Z',end_time:end,
  answers:Array.from({length:10},(_,i)=>({question_id:i+1,user_answer:'A',question_snapshot:question(i+1),first_answer_at:'2026-11-20T10:01:00Z'}))}];
 const predictions=()=>history(attempts,2,asOf).parts.filter(p=>p.input.part_answered_count).map(p=>({part:p.part,model:'lightgbm_v2',artifact_sha256:hash,probability:.7,
  features:{part:p.part,user_acc:(p.input.correct_count+1)/(p.input.answered_count+2),user_part_acc:p.baseline_probability,
   attempt_count:p.input.answered_count,user_part_count:p.input.part_answered_count,prior_elapsed_seconds:21,elapsed_time_missing:1}}));
 return {attempts,predictions,run(ps){return buildResearchProfile({attempts,userId:2,asOf,predictions:ps??predictions(),artifactHash:hash,elapsedMedianSeconds:21});}};
}
test('seven-Part research profile leaves unseen Parts empty and never labels a single measured Part weak',()=>{
 const x=setup(),r=x.run();assert.equal(r.parts.length,7);assert.equal(r.parts[0].status,'no_data');
 assert.equal(r.parts[0].probability,null);assert.equal(r.parts[4].probability,.7);
 assert.equal(r.research.eligible_parts,1);assert.deepEqual(r.research.ai_order_low_to_high,[]);
 assert.equal(r.production.recommended_part,null);assert.equal(r.production.strength_weakness_enabled,false);
});
test('reject wrong artifact, nonfinite probability and feature mismatch',()=>{
 const x=setup();for(const change of [p=>p.artifact_sha256='bad',p=>p.probability=NaN,p=>p.features.user_part_count=0]){
  const ps=x.predictions();change(ps[0]);assert.throws(()=>x.run(ps),/contract/);
 }
});
test('model outage keeps observations and does not substitute baseline as AI',()=>{
 const r=setup().run([]);assert.equal(r.parts[4].status,'model_unavailable');
 assert.equal(r.parts[4].input.part_answered_count,10);assert.equal(r.parts[4].probability,null);
});
test('repeats cannot satisfy distinct floor or create artificial first-observation precision',()=>{
 const x=setup();x.attempts[0].answers=x.attempts[0].answers.map(q=>({...q,question_id:1,question_snapshot:question(1)}));
 const p=x.run().parts[4];assert.equal(p.distinct,1);assert.equal(p.repeat_answers,9);assert.equal(p.rank_eligible,false);
});
test('history is owner-scoped, ignores future completion, discloses missing revisions without backfill',()=>{
 const x=setup();x.attempts.push({...x.attempts[0],attempt_id:2,user_id:3});
 x.attempts[0].answers[0].first_answer_at=null;
 let r=x.run();assert.equal(r.parts[4].input.part_answered_count,10);assert.equal(r.parts[4].first_revision_answers,9);
 x.attempts[0].end_time='2026-11-21T00:00:00Z';r=x.run([]);assert.equal(r.parts[4].status,'no_data');
});
test('two-Part research ordering uses AI, retains ties, and never changes production decisions',()=>{
 const x=setup();x.attempts[0].answers.push(...Array.from({length:10},(_,i)=>({question_id:20+i,user_answer:'A',question_snapshot:question(20+i,1)})));
 let ps=x.predictions();ps.find(p=>p.part===1).probability=.2;
 let r=x.run(ps);assert.deepEqual(r.research.ai_order_low_to_high.map(p=>p.part),[1,5]);
 assert.deepEqual(r.research.lower_signal_candidates,[1]);assert.equal(r.production.ai_recommendations_enabled,false);
 ps=x.predictions();r=x.run(ps);assert.deepEqual(r.research.lower_signal_candidates,[1,5]);
});
const form=(id)=>({test_id:id,title:'Memory form',publication_status:'published',is_active:true,deleted_at:null});
test('technical A/B candidates still require content and difficulty review',()=>{
 const r=auditForms([form(1),form(2)],[{...question(1),test_id:1},{...question(2),test_id:2}]);
 assert.equal(r.by_part[4].technical_candidates,1);assert.equal(r.by_part[4].pairs[0].approved_for_validation,false);
 assert.equal(r.approved_parts,0);assert.equal(r.by_part[5].status,'missing_second_published_form');
});
test('copying content to a new question ID does not make an independent form',()=>{
 const a={...question(1),test_id:1},b={...a,test_id:2,question_id:99};
 const r=auditForms([form(1),form(2)],[a,b]);assert.equal(r.by_part[4].pairs[0].shared_content,1);
 assert.equal(r.by_part[4].technical_candidates,0);
});
test('shared audio bytes or passage text disqualifies A/B even when question text differs',()=>{
 const a={...question(1,3),test_id:1,audio_content_hash:'same'},b={...question(2,3),test_id:2,audio_content_hash:'same'};
 assert.equal(auditForms([form(1),form(2)],[a,b]).by_part[2].technical_candidates,0);
 const c={...question(1,7),test_id:1,passage_content:'Shared'},d={...question(2,7),test_id:2,passage_content:'Shared'};
 assert.equal(auditForms([form(1),form(2)],[c,d]).by_part[6].technical_candidates,0);
});
test('missing media, invalid Part 2 choices and passage gaps block technical approval',()=>{
 const a={...question(1,2),test_id:1,material_audio:null};a.choices.push({choice_label:'D',choice_text:'bad'});
 const r=auditForms([form(1)],[a]);assert.equal(r.forms[0].technical_issues.length,2);
});
test('image-only reading passages supported by the app are valid; identical image bytes are not independent',()=>{
 const a={...question(1,7),test_id:1,passage_content:null,passage_image_url:'/uploads/a.png',passage_image_content_hash:'same'};
 const b={...question(2,7),test_id:2,passage_content:null,passage_image_url:'/uploads/b.png',passage_image_content_hash:'same'};
 let r=auditForms([form(1),form(2)],[a,b]);assert.equal(r.forms[0].technical_issues.length,0);
 assert.equal(r.by_part[6].technical_candidates,0);
 b.passage_image_content_hash='different';r=auditForms([form(1),form(2)],[a,b]);assert.equal(r.by_part[6].technical_candidates,1);
});
test('asset checker refuses traversal and remote files; preview escapes text without network scripts',()=>{
 const {asset,preview}=require('./runAppPartResearch');
 assert.equal(asset('/uploads/../../outside.txt').status,'refused_outside_uploads');
 assert.equal(asset('https://outside.invalid/uploads/audio.mp3').status,'unverified_remote_reference');
 const p=setup().run();p.parts[4].status='<script>bad()</script>';
 const html=preview([p],asOf);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
test('invalid completed-history time cannot silently enter model inputs',()=>{
 const x=setup();x.attempts[0].start_time=null;assert.throws(()=>x.run([]),/timestamps/);
});
test('database collector requires READ ONLY, never writes, and rolls back both successful and rejected identity',async()=>{
 const pg=require('pg'),Original=pg.Client,calls=[];let correct=true;
 class Fake{async connect(){}async end(){calls.push('END');}async query(sql){calls.push(sql);
  assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  return {rows:sql.includes('current_database()')?[{database:correct?'toeic_learning_system':'wrong',read_only:'on',as_of:new Date(asOf)}]:[]};}}
 pg.Client=Fake;
 try{const {collect}=require('./runAppPartResearch');const s=await collect();assert.equal(s.users.length,0);
  assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-2),'ROLLBACK');
  calls.length=0;correct=false;await assert.rejects(collect(),/READ ONLY/);assert.equal(calls.at(-2),'ROLLBACK');
 }finally{pg.Client=Original;}
});
