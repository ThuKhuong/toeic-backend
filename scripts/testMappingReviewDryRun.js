// Synthetic decisions exist only in RAM; no approval files or database mutations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,projection,validTime}=require('./validateMappingReviewDryRun');
function fixture(part=5) {
  const source={mapping_id:'m1',question_id:11,taxonomy_version:'test-only',question_content_sha256:'source-hash',part_number:String(part),section:part<=4?'listening':'reading',evidence_status:'sufficient_for_proposal',media_urls:'',content_issue:''};
  const data={source_bundle_sha256:'test-only',questions:[{question_id:11,part_number:part,correct_answer:'A'}],mappings:[source],components:[{kc_code:'kc',applicable_parts:String(part),section:source.section}]};
  const decision={...source,review_status:'approved',reviewed_knowledge_component:'kc',reviewed_kc_role:'primary',reviewer:'Unit test reviewer',reviewed_at_utc:'2026-01-01T00:00:00.000Z',review_notes:'Test only',content_inspected:true,review_revision:1,assessment_eligible:false};
  const bundle={format_version:1,source_bundle_sha256:'test-only',events:[decision]};
  const content=[{question_id:11,question_content_sha256:'source-hash',taxonomy_version:'test-only',review_status:'confirmed_original_correct',confirmed_correct_answer:'A',reviewer:'Unit test reviewer',reviewed_at_utc:'2026-01-01T00:00:00.000Z',confirmation_source:'Test fixture only'}];
  return {data,bundle,content};
}
test('Complete offline review does not grant BKT eligibility or execute import',()=>{
  const f=fixture(),r=evaluate(f.data,f.bundle,f.content)[0];assert.equal(r.offline_review_ready,true);assert.equal(r.import_executed,false);assert.equal(r.bkt_eligible,false);
});
test('No decisions means zero approval, even if content is confirmed',()=>{
  const f=fixture();f.bundle.events=[];const r=evaluate(f.data,f.bundle,f.content)[0];assert.equal(r.offline_review_ready,false);assert.ok(r.blockers.includes('unresolved_mapping_edges'));
});
test('Unresolved secondary edge blocks a question with an approved primary',()=>{
  const f=fixture();f.data.mappings.push({...f.data.mappings[0],mapping_id:'m2'});assert.ok(evaluate(f.data,f.bundle,f.content)[0].blockers.includes('unresolved_mapping_edges'));
});
test('Two approved primary KC decisions are rejected',()=>{
  const f=fixture();f.data.mappings.push({...f.data.mappings[0],mapping_id:'m2'});f.data.components.push({...f.data.components[0],kc_code:'kc2'});f.bundle.events.push({...f.bundle.events[0],mapping_id:'m2',reviewed_knowledge_component:'kc2'});assert.throws(()=>evaluate(f.data,f.bundle,f.content));
});
test('Source version mismatch and missing revision are rejected',()=>{
  const f=fixture();f.bundle.events[0].question_content_sha256='other';assert.throws(()=>evaluate(f.data,f.bundle,f.content));
  const g=fixture();g.bundle.events[0].review_revision=2;assert.throws(()=>evaluate(g.data,g.bundle,g.content));
});
test('Wrong Part or missing reviewer cannot pass validation',()=>{
  const f=fixture();f.data.components[0].applicable_parts='7';assert.throws(()=>evaluate(f.data,f.bundle,f.content));
  const g=fixture();g.bundle.events[0].reviewer='';assert.throws(()=>evaluate(g.data,g.bundle,g.content));
});
test('Original key must be confirmed explicitly, not replaced with a corrected key',()=>{
  const f=fixture();f.content[0].confirmed_correct_answer='B';assert.ok(evaluate(f.data,f.bundle,f.content)[0].blockers.includes('versioned_content_and_original_key_confirmation_required'));
});
test('Omitting a flagged quality row cannot bypass a quality gate',()=>{
  const f=fixture();f.data.mappings[0].content_issue='Key needs review';assert.ok(evaluate(f.data,f.bundle,f.content)[0].blockers.includes('unresolved_content_quality_flag'));
});
test('A confirmed correction still blocks observations with the old key',()=>{
  const f=fixture();const quality=[{...f.content[0],review_status:'confirmed_correction_required'}];assert.ok(evaluate(f.data,f.bundle,f.content,quality)[0].blockers.includes('unresolved_content_quality_flag'));
});
test('Listening cannot pass just because media exists; a verified script match is required',()=>{
  const f=fixture(4);f.data.questions[0].material={audio_url:'/uploads/a.mp3'};f.data.mappings[0].media_urls='/uploads/a.mp3';
  f.data.questions[0].explanation='Test script';f.data.media=[{url:'/uploads/a.mp3',sha256:'testhash',question_ids:[11]}];
  const checks=new Map([['/uploads/a.mp3',true]]);
  const audio=[{question_ids:'11',audio_path:'/uploads/a.mp3',audio_sha256:'testhash',current_script:'Test script',taxonomy_version:'test-only',listening_review_status:'pending_listen'}];
  assert.ok(evaluate(f.data,f.bundle,f.content,[],audio,checks)[0].blockers.includes('verified_audio_script_match_required'));
  Object.assign(audio[0],{listening_review_status:'verified',comparison_result:'matches_script',confirmed_by:'Unit test reviewer',confirmed_at_utc:'2026-01-01T00:00:00.000Z',confirmation_source:'Test fixture'});
  assert.equal(evaluate(f.data,f.bundle,f.content,[],audio,checks)[0].offline_review_ready,true);
  checks.set('/uploads/a.mp3',false);assert.equal(evaluate(f.data,f.bundle,f.content,[],audio,checks)[0].offline_review_ready,false);
});
test('Insufficient graphic evidence stays blocked despite an approval claim',()=>{
  const f=fixture();f.data.mappings[0].evidence_status='insufficient_evidence';assert.throws(()=>evaluate(f.data,f.bundle,f.content));
});
test('Content projection detects changed key and normalizes source/snapshot layouts',()=>{
  const source={question_id:1,part_number:4,correct_answer:'A',material:{audio_url:'/uploads/a.mp3',transcript:'Text'},question_group:{image_url:null},choices:[]};
  const snapshot={question_id:1,part_number:4,correct_answer:'A',material_audio:'/uploads/a.mp3',material_transcript:'Text',choices:[]};
  assert.deepEqual(projection(source,true),projection(snapshot));snapshot.correct_answer='B';assert.notDeepEqual(projection(source,true),projection(snapshot));
});
test('Future timestamps and duplicate content confirmations are rejected',()=>{
  assert.equal(validTime('2099-01-01T00:00:00.000Z'),false);
  const f=fixture();f.content.push({...f.content[0]});assert.throws(()=>evaluate(f.data,f.bundle,f.content));
});
