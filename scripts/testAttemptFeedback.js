const test=require('node:test'),assert=require('node:assert/strict');
const {gradeAttempt}=require('../src/modules/tests/grading');
const {buildFeedback,withFeedback}=require('../src/modules/tests/attemptFeedback');
const row=(part,user_answer='A')=>({part_number:part,correct_answer:'A',user_answer});
test('describes actual evidence and prioritizes the lower score without claiming competence',()=>{
 const grading=gradeAttempt([row(3),row(3,'B'),row(3,null),row(4),row(4)]);
 const feedback=buildFeedback(grading);
 assert.equal(feedback.scope,'current_attempt');assert.equal(feedback.method,'descriptive_rules');
 assert.deepEqual(feedback.evidence,{total:5,answered:4,correct:3,incorrect:1,unanswered:1});
 assert.equal(feedback.recommendations[0].part,3);assert.match(feedback.summary,/Part 3/);
 assert.equal(feedback.parts[0].unanswered,1);assert.match(feedback.limitation,/không phải kết luận năng lực/);
});
test('blank attempts have insufficient evidence and no weak-Part recommendations',()=>{
 const f=buildFeedback(gradeAttempt([row(3,null),row(4,null)]));assert.equal(f.status,'insufficient_data');assert.deepEqual(f.recommendations,[]);
});
test('perfect attempts do not recommend weak Parts',()=>{
 const f=buildFeedback(gradeAttempt([row(3),row(4)]));assert.deepEqual(f.recommendations,[]);assert.match(f.summary,/đúng toàn bộ/);
});
test('ties and single-Part practice do not claim a uniquely weakest Part',()=>{
 for(const rows of [[row(3),row(3,'B')],[row(3),row(3,'B'),row(4),row(4,'B')]]){
  const f=buildFeedback(gradeAttempt(rows));assert.doesNotMatch(f.summary,/thấp nhất/);
 }
});
test('saved feedback stays stable and feedback failures preserve grading',()=>{
 const saved=withFeedback(gradeAttempt([row(3,'B')]));assert.equal(withFeedback(saved),saved);
 const malformed={total:1,score:0};const result=withFeedback(malformed);assert.equal(result.score,0);assert.equal(result.feedback.status,'unavailable');
});
