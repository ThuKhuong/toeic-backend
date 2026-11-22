const test=require('node:test'),assert=require('node:assert/strict');
test('GET results grades legacy snapshots in memory with READ ONLY and never writes or locks rows',async()=>{
  const calls=[], db=require.resolve('../db'),previous=require.cache[db];
  const storedForecast={status:'processing',token:'MEMORY_PRIVATE_TOKEN',inputs:[]};
  const snapshot={part_number:5,question_id:1,question_text:'RAM',correct_answer:'A',choices:['A','B','C','D'].map(choice_label=>({choice_label,choice_text:choice_label}))};
  const client={release(){},async query(sql,args){calls.push(sql);assert.doesNotMatch(sql,/\b(UPDATE|INSERT|DELETE)\b/);assert.doesNotMatch(sql,/FOR UPDATE/);
    if(sql.startsWith('SELECT * FROM user_test_attempts')){assert.deepEqual(args,[1,2]);return{rows:[{attempt_id:1,user_id:2,test_id:3,is_completed:true,grading_result:null,ai_prediction:storedForecast,end_time:'2026-11-20T08:00:00Z'}]};}
    if(sql.includes('FROM attempt_questions'))return{rows:[{question_snapshot:snapshot,question_id:1,attempt_id:1,user_answer:'A'}]};
    if(sql.includes('FROM tests'))return{rows:[{test_name:'RAM',test_type:'part_test'}]};return{rows:[]};}};
  require.cache[db]={id:db,filename:db,loaded:true,exports:{connect:async()=>client}};
  try {const service=require('../src/modules/tests/attemptService');const r=await service.getAttemptResults(1,2);
    assert.equal(r.grading.correct,1);assert.ok(r.grading.feedback);assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(calls.at(-1),'COMMIT');
    assert.equal(r.attempt.ai_prediction.token,undefined);assert.equal(storedForecast.token,'MEMORY_PRIVATE_TOKEN');
    assert.equal(r.question_prediction,undefined);assert.equal(r.attempt.question_predictions,undefined);
  }finally{if(previous)require.cache[db]=previous;else delete require.cache[db];}
});
