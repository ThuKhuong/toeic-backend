// All fixture writes are confined to a fresh, uniquely named schema.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), {Pool}=require('pg');
const admin=require('../db');
const schema='part7_review_'+require('node:crypto').randomUUID().replaceAll('-','');
const pool=new Pool({...admin.options,options:`-c search_path=${schema}`});
async function main() {
 try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(fs.readFileSync(path.join(__dirname,'../database/toeic_learning_system.sql'),'utf8'));
  for(const file of ['20261026_question_source.sql','20261027_source_question_number.sql','20261027_attempt_grading.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations',file),'utf8'));
  require.cache[require.resolve('../db')].exports=pool;
  const {validateItems,saveBatch}=require('../src/modules/imports/importService');
  const passage={title:'Flyer',content:'',image_url:'https://example.invalid/flyer.png',translation:'Vietnamese translation',explanation:'Passage evidence'};
  const items=validateItems([149,150].map(number=>({part_number:7,source_set:'Isolated Part 7',order_in_test:number,group_key:'149-150',question_text:`Question ${number}`,correct_answer:'A',explanation:`Explanation ${number}`,choices:['A','B','C','D'].map(label=>({label,text:label})),passages:[passage]})),'reading');
  const saved=await saveBatch(items,'reading');assert.equal(saved.created,2);
  const stored=(await pool.query('SELECT * FROM reading_passages')).rows;assert.equal(stored.length,1);assert.equal(stored[0].translation,passage.translation);assert.equal(stored[0].explanation,passage.explanation);
  const user=(await pool.query("INSERT INTO \"User\"(email,password_hash,full_name) VALUES ('part7@example.invalid','fixture','Part 7 fixture') RETURNING user_id")).rows[0].user_id;
  const test=(await pool.query("INSERT INTO tests(test_name,test_type,is_active) VALUES ('Part 7 fixture','part_test',true) RETURNING test_id")).rows[0].test_id;
  await pool.query('UPDATE questions SET test_id=$1',[test]);
  const questions=require('../src/modules/questions/questionService');
  const student=await questions.getQuestionById(saved.items[0].question_id,false);
  assert.equal('passage_translation' in student,false);assert.equal('translation' in student.passages[0],false);assert.equal('explanation' in student.passages[0],false);
  const attempts=require('../src/modules/tests/attemptService');
  const started=await attempts.startAttempt(user,test);
  for(const q of started.questions){assert.equal('passage_translation' in q,false);assert.equal('passage_explanation' in q,false);assert.equal('explanation' in q,false);assert.equal('translation' in q.passages[0],false);assert.equal('explanation' in q.passages[0],false);assert.ok(q.passages[0].image_url);}
  const resumed=await attempts.resumeAttempt(started.attempt_id,user);assert.equal('translation' in resumed.questions[0].passages[0],false);
  await assert.rejects(()=>attempts.getAttemptResults(started.attempt_id,user),e=>e.status===409);
  await attempts.submitAnswer(started.attempt_id,saved.items[0].question_id,'A',5,user);
  const finished=await attempts.finishAttempt(started.attempt_id,user);
  assert.equal(finished.grading.feedback.version,'attempt_feedback_v1');
  const repeated=await attempts.finishAttempt(started.attempt_id,user);
  assert.deepEqual(repeated.grading.feedback,finished.grading.feedback);
  assert.equal((await pool.query('SELECT tests_completed FROM user_stats WHERE user_id=$1',[user])).rows[0].tests_completed,1);
  const result=await attempts.getAttemptResults(started.attempt_id,user);assert.equal(result.answers.length,2);
  assert.ok(result.answers.every(a=>a.passages[0].translation===passage.translation && a.passages[0].explanation===passage.explanation && a.explanation));
  assert.equal(result.answers[0].is_correct,true);assert.equal(result.answers[1].is_correct,false);
  if(process.env.TEST_REAL_MODEL==='1') {
    const {createAttemptPredictor}=require('../src/modules/ai/attemptPrediction');
    let failures=0;
    const offline=createAttemptPredictor({pool,fetchImpl:async()=>{failures++;throw Error('offline fixture');}});
    const failed=await offline(started.attempt_id,user);assert.equal(failed.status,'failed');assert.equal(failures,1);
    assert.equal((await pool.query('SELECT is_completed FROM user_test_attempts WHERE attempt_id=$1',[started.attempt_id])).rows[0].is_completed,true);
    const frozen=failed.inputs;
    const future=(await pool.query("INSERT INTO user_test_attempts(user_id,test_id,is_completed,end_time) VALUES ($1,$2,true,CURRENT_TIMESTAMP+interval '1 day') RETURNING attempt_id",[user,test])).rows[0].attempt_id;
    await pool.query('INSERT INTO attempt_questions(attempt_id,question_id,position,question_snapshot) SELECT $1,question_id,position,question_snapshot FROM attempt_questions WHERE attempt_id=$2',[future,started.attempt_id]);
    await pool.query("INSERT INTO user_answers(attempt_id,question_id,user_answer,is_correct) SELECT $1,question_id,'A',true FROM attempt_questions WHERE attempt_id=$1",[future]);
    let calls=0;
    const real=createAttemptPredictor({pool,baseUrl:process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',fetchImpl:async(...args)=>{calls++;return fetch(...args);}});
    const prediction=await real(started.attempt_id,user,{retry:true});
    assert.equal(prediction.status,'ready',JSON.stringify(prediction));assert.equal(calls,1);assert.deepEqual(prediction.inputs,frozen);
    assert.equal(prediction.inputs[0].answered_count,1);assert.equal(prediction.parts[0].model,'lightgbm_v2');assert.match(prediction.parts[0].artifact_sha256,/^[a-f0-9]{64}$/);
    assert.ok(prediction.parts[0].probability>=0 && prediction.parts[0].probability<=1);
    assert.deepEqual(await real(started.attempt_id,user),prediction);assert.equal(calls,1);
    await assert.rejects(()=>real(started.attempt_id,user+999),e=>e.status===404);
    await pool.query('UPDATE user_test_attempts SET ai_prediction=NULL WHERE attempt_id=$1',[started.attempt_id]);calls=0;
    const concurrent=await Promise.all([real(started.attempt_id,user),real(started.attempt_id,user)]);assert.equal(calls,1);assert.ok(concurrent.some(p=>p.status==='ready'));
    const app=require('../server'),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    try {
      const token=require('jsonwebtoken').sign({user_id:user,role:'STUDENT'},process.env.JWT_SECRET || 'secret123');
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/tests/attempts/${started.attempt_id}/results`,{headers:{Authorization:`Bearer ${token}`}});
      const body=await response.json();assert.equal(response.status,200);assert.equal(body.ai_prediction.status,'ready');assert.equal(body.ai_prediction.parts[0].model,'lightgbm_v2');
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
    console.log('PASS: real Python LightGBM inference through backend HTTP, DB persistence, frozen historical inputs, offline recovery, cached results, concurrent claims and ownership.');
  }
  assert.deepEqual(result.grading.feedback,finished.grading.feedback);
  assert.equal(result.grading.feedback.parts[0].correct,1);
  assert.equal(result.grading.feedback.parts[0].unanswered,1);
  await assert.rejects(()=>attempts.getAttemptResults(started.attempt_id,user+999),e=>e.status===404);
  await pool.query("UPDATE user_test_attempts SET grading_result=grading_result-'feedback' WHERE attempt_id=$1",[started.attempt_id]);
  const backfilled=await attempts.getAttemptResults(started.attempt_id,user);
  const reopened=await attempts.getAttemptResults(started.attempt_id,user);
  assert.deepEqual(backfilled.grading.feedback,reopened.grading.feedback);
  console.log('PASS: persisted feedback, repeated submission/stats idempotency, ownership and stable legacy-attempt backfill.');
  console.log('PASS: actual PostgreSQL Part 7 persistence, image/translation/explanation snapshots, start/resume redaction, pre-submit result denial and post-submit review. Isolated schema only.');
 }finally{await pool.end();assert.match(schema,/^part7_review_[a-f0-9]{32}$/);await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
