const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Pool,Client}=require('pg');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const {gradeAttempt}=require('../src/modules/tests/grading');
const {estimateSection}=require('../src/modules/tests/toeicEstimate');
// Never create grading fixtures in the configured application database.
const database='toeic_learning_events_test';
if(database===process.env.DB_NAME)throw Error('Refusing configured application database');
const host=process.env.DB_HOST||'localhost';
if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('Local isolated test database required');
const base={host,port:process.env.DB_PORT||5432,user:process.env.DB_USER||'postgres',password:process.env.DB_PASS||'',database};
const schema='grading_'+randomUUID().replaceAll('-','');
const admin=new Client(base);
const pool=new Pool({...base,options:`-c search_path=${schema} -c timezone=Asia/Ho_Chi_Minh`});
// This suite tests grading/snapshots, never inference or event collection.
process.env.LEARNING_EVENTS_ENABLED='0';
process.env.AI_QUESTION_SHADOW_ENABLED='0';
(async()=>{
 let created=false,client,transactionOpen=false,previousDb;
 const dbPath=require.resolve('../db');
 const originalConnect=pool.connect;
 try{
 await admin.connect();
 const context=(await admin.query(`SELECT current_database() AS database,
   shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
 assert.equal(context.database,database);
 assert.equal(context.marker,'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT','Isolated test database marker required');
 assert.match(schema,/^grading_[a-f0-9]{32}$/);
 assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount,0);
 await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
 const ddl=fs.readFileSync(path.join(__dirname,'../database/toeic_learning_system.sql'),'utf8');
 assert.equal(/SET\s+search_path|CREATE\s+DATABASE|public\./i.test(ddl),false,'DDL must stay within the unique test schema');
 await pool.query(ddl);
 for(const file of ['20261026_question_source.sql','20261027_source_question_number.sql','20261027_attempt_grading.sql','20261105_attempt_prediction.sql','20261105_question_predictions.sql']){
  await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations',file),'utf8'));
 }
 previousDb=require.cache[dbPath];
 require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:pool};
 const counts=[6,25,39,30,30,16,54];
 const perfect=counts.flatMap((count,index)=>Array.from({length:count},()=>({part_number:index+1,correct_answer:'A',user_answer:'A'})));
 assert.equal(gradeAttempt(perfect).toeic.total,990);
 assert.equal(gradeAttempt(perfect.map(q=>({...q,user_answer:null}))).toeic.total,10);
 assert.equal(gradeAttempt(perfect.slice(0,6)).toeic.total,null);
 assert.equal(gradeAttempt(perfect.slice(0,100)).toeic.reading,null);
 assert.equal(gradeAttempt(Array.from({length:200},()=>perfect[0])).toeic.total,null);
 for(const section of ['listening','reading']){let previous=0;for(let n=0;n<=100;n++){const score=estimateSection(n,section);assert.ok(score>=previous&&score>=5&&score<=495);assert.equal(score%5,0);previous=score;}}
 client=await pool.connect();await client.query('BEGIN');transactionOpen=true;
 let depth=0;
 pool.connect=async()=>({async query(sql,args){
   // Map READ ONLY and plain BEGIN alike: an inner COMMIT must never commit
   // fixture data outside this suite's outer rollback transaction.
   if(/^BEGIN(?:\s|$)/i.test(sql))return client.query('SAVEPOINT grade_test_'+(++depth));
   if(/^COMMIT\s*$/i.test(sql))return client.query('RELEASE SAVEPOINT grade_test_'+depth--);
   if(/^ROLLBACK\s*$/i.test(sql)){
     await client.query('ROLLBACK TO SAVEPOINT grade_test_'+depth);
     return client.query('RELEASE SAVEPOINT grade_test_'+depth--);
   }
   return client.query(sql,args);
 },release(){}});
  const service=require('../src/modules/tests/attemptService');const token=require('node:crypto').randomUUID();
  const user=(await client.query('INSERT INTO "User"(email,password_hash,full_name) VALUES ($1,\'fixture\',\'Grading fixture\') RETURNING user_id',[`grading-${token}@example.invalid`])).rows[0].user_id;
  const test=(await client.query("INSERT INTO tests(test_name,test_type,time_limit,is_active,publication_status) VALUES ('Grading fixture','full_test',120,true,'published') RETURNING test_id")).rows[0].test_id;
  await client.query(`INSERT INTO questions(test_id,question_type,part_number,question_text,correct_answer,explanation,order_in_test)
    SELECT $1,CASE WHEN n<=100 THEN 'listening' ELSE 'reading' END,
      CASE WHEN n<=6 THEN 1 WHEN n<=31 THEN 2 WHEN n<=70 THEN 3 WHEN n<=100 THEN 4 WHEN n<=130 THEN 5 WHEN n<=146 THEN 6 ELSE 7 END,
      'Grading fixture','A','Original explanation',n FROM generate_series(1,200) n`,[test]);
  await client.query(`INSERT INTO answer_choices(question_id,choice_label,choice_text,is_correct)
    SELECT q.question_id,label,label,label='A' FROM questions q CROSS JOIN unnest(ARRAY['A','B','C','D']) label
    WHERE q.test_id=$1 AND NOT(q.part_number=2 AND label='D')`,[test]);
  const attempt=await service.startAttempt(user,test);assert.equal(attempt.questions.length,200);
  assert.ok(attempt.questions.every(q=>!('correct_answer' in q)));
  assert.equal(attempt.questions.find(q=>q.part_number===2).choices.length,3);
  await assert.rejects(service.getAttemptResults(attempt.attempt_id,user),e=>e.status===409);
  const answers=attempt.questions.flatMap((q,i)=>{
    const n=i<100?i:i-100;const correct=i<100?n<80:n<70;const wrong=i<100?n>=80&&n<90:n>=70&&n<90;
    return correct||wrong?[{question_id:q.question_id,user_answer:correct?'A':'B',time_spent:1}]:[];
  });
  await service.saveProgress(attempt.attempt_id,user,{current_index:199,elapsed_seconds:180,answers});
  await client.query("UPDATE questions SET correct_answer='B',explanation='Changed after start' WHERE test_id=$1",[test]);
  const completed=await service.finishAttempt(attempt.attempt_id,user);
  assert.equal(completed.grading.toeic.total,720);assert.equal(completed.grading.toeic.listening,420);assert.equal(completed.grading.toeic.reading,300);
  assert.equal(completed.grading.correct,150);assert.equal(completed.grading.incorrect,30);assert.equal(completed.grading.unanswered,20);
  assert.equal(completed.score,75);assert.equal(completed.grading.parts.length,7);
  const repeat=await service.finishAttempt(attempt.attempt_id,user);assert.deepEqual(repeat.grading,completed.grading);
  const stats=(await client.query('SELECT tests_completed FROM user_stats WHERE user_id=$1',[user])).rows[0];assert.equal(stats.tests_completed,1);
  const result=await service.getAttemptResults(attempt.attempt_id,user);assert.equal(result.grading.toeic.total,720);assert.equal(result.answers[0].correct_answer,'A');
  assert.equal(result.answers.filter(a=>a.answer_status==='unanswered').length,20);
  await assert.rejects(service.getAttemptResults(attempt.attempt_id,user+1000000),e=>e.status===404);
  await assert.rejects(service.submitAnswer(attempt.attempt_id,attempt.questions[0].question_id,'B',1,user),e=>e.status===409);
  console.log('PASS: isolated TEST schema only; 200-question snapshot grading, 720/990 estimate, section scores, wrong/blank counts, no pre-submit answer disclosure, Part 2 choices, ownership, duplicate completion, stored grading and immutable snapshots. Fixture transaction rolled back in cleanup.');
 }finally{
  pool.connect=originalConnect;
  if(client){if(transactionOpen)await client.query('ROLLBACK');client.release();}
  await pool.end();
  if(previousDb)require.cache[dbPath]=previousDb;else delete require.cache[dbPath];
  if(created){
   assert.match(schema,/^grading_[a-f0-9]{32}$/);
   assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name,database);
   await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await admin.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
