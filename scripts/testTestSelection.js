const assert=require('node:assert/strict');
const {isolatedContentTest}=require('./support/isolatedContentTest');
const {chooseRows}=require('../src/modules/tests/questionSelection');
(async()=>{
 const rows=Array.from({length:7},(_,i)=>({question_id:i+1,group_id:i<3?1:2}));
 assert.equal(chooseRows(rows,3,3).length,3);
 assert.equal(chooseRows(rows,6,4).length,4);
 assert.throws(()=>chooseRows(rows,3,5),e=>e.status===400);
 assert.equal(new Set(chooseRows(rows,5,5,'random')).size,5);
 const fixture=await isolatedContentTest('selection');
 const {client}=fixture;
 try {
  const service=require('../src/modules/tests/testsService');
  const token=require('node:crypto').randomUUID();const source=`Selection ${token}`;
  const ids=[];
  for(const [number,name] of [[103,source],[101,source],[102,source],[101,`Other ${token}`]]) {
   ids.push((await client.query("INSERT INTO questions(question_type,part_number,question_text,correct_answer,difficulty_level,order_in_test,source_question_number,source_set) VALUES ('reading',5,'Fixture','A',1,$1,$1,$2) RETURNING question_id",[number,name])).rows[0].question_id);
  }
  const available=await service.adminGetAvailability({part_number:5,source_set:source});assert.equal(available.available,3);
  const listing=await service.adminGetUnassignedQuestions({part_number:5,source_set:source,page:1,limit:10});assert.deepEqual(listing.questions.map(q=>q.question_id),[ids[1],ids[2],ids[0]]);
  const options={test_name:`Test ${token}`,test_type:'part_test',parts:[5],part_number:5,time_limit:10,is_active:false,publication_status:'draft',source_set:source,selection_mode:'ordered',total_questions:2};
  const created=await service.adminCreateTestWithQuestions(options);assert.equal(created.assigned,2);
  const assigned=await client.query('SELECT question_id,order_in_test,source_question_number FROM questions WHERE test_id=$1 ORDER BY order_in_test',[created.test.test_id]);
  assert.deepEqual(assigned.rows.map(q=>q.question_id),[ids[1],ids[2]]);assert.deepEqual(assigned.rows.map(q=>q.source_question_number),[101,102]);
  assert.equal((await service.adminGetAvailability({part_number:5,source_set:source})).available,1);
  await assert.rejects(service.adminCreateTestWithQuestions(options),e=>e.status===409);
  await assert.rejects(service.adminCreateTestWithQuestions({...options,test_name:`Insufficient ${token}`}),e=>e.status===400);
  await assert.rejects(service.adminCreateTest({...options,test_name:`  TEST   ${token.toUpperCase()}  `}),e=>e.status===409);
  const manual=await service.adminCreateTestWithQuestions({...options,test_name:`Manual ${token}`,total_questions:1,question_ids:[ids[0]]});assert.equal(manual.assigned,1);
  await assert.rejects(service.adminUpdateTest(manual.test.test_id,{test_name:options.test_name}),e=>e.status===409);
  await service.adminUpdateTest(manual.test.test_id,{test_name:`  Manual   ${token}  `});
  await service.adminDeleteTest(manual.test.test_id);
  assert.equal((await client.query('SELECT test_id FROM questions WHERE question_id=$1',[ids[0]])).rows[0].test_id,null);
  assert.equal((await service.adminGetAvailability({part_number:5,source_set:source})).available,1);
  assert.ok((await client.query('SELECT deleted_at FROM tests WHERE test_id=$1',[manual.test.test_id])).rows[0].deleted_at);
  assert.equal(await service.adminDeleteTest(manual.test.test_id),undefined);
  const reused=await service.adminCreateTest({...options,test_name:`Manual ${token}`});assert.ok(reused.test_id);
  const learner=(await client.query('INSERT INTO "User"(email,password_hash) VALUES ($1,$2) RETURNING user_id',[`${token}@fixture.invalid`,'test-only'])).rows[0].user_id;
  await client.query('INSERT INTO user_test_attempts(user_id,test_id,is_completed) VALUES ($1,$2,false)',[learner,created.test.test_id]);
  await service.adminDeleteTest(created.test.test_id);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM questions WHERE test_id=$1',[created.test.test_id])).rows[0].n,2);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM user_test_attempts WHERE test_id=$1',[created.test.test_id])).rows[0].n,1);
  const listeningSource=`Audio ${token}`;
  for(let i=1;i<=2;i++){
   const material=(await client.query("INSERT INTO listening_materials(title,audio_url) VALUES ('Fixture','/fixture.mp3') RETURNING material_id")).rows[0].material_id;
   await client.query("INSERT INTO questions(question_type,part_number,correct_answer,material_id,source_set,source_question_number,order_in_test) VALUES ('listening',1,'A',$1,$2,$3,$3)",[material,listeningSource,i]);
  }
  const audio=await service.adminCreateTestWithQuestions({...options,parts:[1],part_number:1,source_set:listeningSource});assert.equal(audio.assigned,2);
  console.log('PASS: availability/list, ordered/manual selection, distinct Part 1 audio, exact counts and source numbering. Explicit marked toeic_learning_events_test only; fixtures rolled back and own schema removed.');
 }finally{await fixture.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
