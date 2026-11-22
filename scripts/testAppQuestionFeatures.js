const test=require('node:test'),assert=require('node:assert/strict');
const {buildAppQuestionPreview,fingerprint}=require('../src/modules/ai/appQuestionFeatures');
const q={question_id:10,part_number:7,question_text:'Why?',correct_answer:'A',choices:[{label:'A',text:'One'}]};
const row=(user,overrides={})=>({user_id:user,question_id:10,is_completed:true,end_time:'2026-01-01T00:00:00Z',user_answer:'A',question_snapshot:q,...overrides});
const build=evidence=>buildAppQuestionPreview({question:q,userId:1,evidence,asOf:'2026-01-02T00:00:00Z'});
test('only previously completed answers, not current/future groups, enter features',()=>{
 const p=build([row(1),row(1,{is_completed:false}),row(1,{end_time:'2026-01-02T00:00:00Z'}),row(1,{user_answer:null})]);
 assert.equal(p.features.attempt_count,1);assert.equal(p.features.user_question_count,1);
});
test('personal history does not become crowd question difficulty',()=>{
 const p=build([row(1),row(1),row(2,{user_answer:'B'})]);assert.equal(p.features.user_question_count,2);assert.equal(p.features.question_count,1);assert.equal(p.evidence.other_learners_for_question,1);
});
test('edited questions cannot reuse item-specific evidence from old snapshots',()=>{
 const p=build([row(1,{question_snapshot:{...q,question_text:'Different'}})]);assert.equal(p.features.attempt_count,1);assert.equal(p.features.user_question_count,0);assert.notEqual(fingerprint(q),fingerprint({...q,correct_answer:'B'}));
});
test('unmapped tags remain explicit blockers; no artificial Riiid mapping/model call',()=>{
 const p=build([]);assert.equal(p.features.question_count,0);assert.equal(p.features.question_acc,.5);assert.equal(p.model_called,false);assert.ok(p.missing_v3_features.includes('tag_acc'));assert.ok(p.blockers.length);
});
