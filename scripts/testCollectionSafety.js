// In-memory unit tests only. No PostgreSQL connections or persisted fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { environmentStatus } = require('../src/modules/learning/environmentStatus');
const learning = require('../src/modules/learning/service');
const { versionOf } = require('../src/modules/learning/version');
process.env.LEARNING_EVENTS_ENABLED = '1';
const q = { question_id: 2, part_number: 5, correct_answer: 'A',
  question_text: 'Memory only', choices: [...'ABCD'].map(choice_label => ({choice_label,choice_text:choice_label})) };

test('pilot status requires actual isolated DB, marker, flag and every storage table', async () => {
  const state = { database:'toeic_learning_events_dev', marker:'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT',
    events:true, revisions:true, observations:true, progress_sync:true };
  const pool = { query: async sql => { assert.match(sql,/^SELECT/); return {rows:[state]}; } };
  const env = {LEARNING_EVENTS_ENABLED:'1',LEARNING_DATA_ENV:'isolated_development'};
  assert.equal((await environmentStatus(pool,env)).pilot_ready,true);
  state.database='toeic_learning_system';
  assert.equal((await environmentStatus(pool,env)).pilot_ready,false);
  state.database='toeic_learning_events_dev';state.observations=false;
  assert.equal((await environmentStatus(pool,env)).pilot_ready,false);
  state.observations=true;
  assert.equal((await environmentStatus(pool,{})).pilot_ready,false);
});

function eventStore() {
  const events=new Map();let completed=false;
  const client={ release(){}, async query(sql,args=[]) {
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(sql)) return {rows:[]};
    if(sql.includes('SELECT * FROM user_test_attempts'))return {rows:args[1]===7?[{attempt_id:1,user_id:7,is_completed:completed}]:[]};
    if(sql.includes('SELECT question_snapshot'))return {rows:[{question_snapshot:q}]};
    if(sql.includes('FROM learning_kc_mapping_versions'))return {rows:[]};
    if(sql.includes('SELECT user_id,client_event_sha256'))return {rows:events.has(args[0])?[events.get(args[0])]:[]};
    if(sql.includes('INSERT INTO learning_events')){
      events.set(args[0],{user_id:args[1],client_event_sha256:args[14]});return {rowCount:1,rows:[{event_id:args[0]}]};
    }
    throw Error('Unexpected SQL: '+sql);
  }};
  return {pool:{connect:async()=>client},events,complete(){completed=true;}};
}
const envelope=()=>({event_id:randomUUID(),user_id:7,attempt_id:1,question_id:2,
  client_session_id:randomUUID(),client_sequence:1,event_timestamp:new Date().toISOString(),
  event_type:'ANSWER_SUBMITTED',question_version:versionOf(q),event_payload:{new_answer:'A',previous_answer:null}});

test('retry after lost receipt stores same event once; altered payload rejected',async()=>{
  const store=eventStore(), e=envelope();
  assert.equal((await learning.ingest(store.pool,7,[e])).results[0].status,'accepted');
  store.complete(); // delayed receipt retry remains idempotent after completion
  assert.equal((await learning.ingest(store.pool,7,[e])).results[0].status,'duplicate');
  assert.equal(store.events.size,1);
  assert.equal((await learning.ingest(store.pool,7,[{...e,event_payload:{new_answer:'B',previous_answer:null}}])).results[0].code,409);
});

test('wrong learner cannot submit another learner event or attempt',async()=>{
  const store=eventStore(),e=envelope();
  assert.equal((await learning.ingest(store.pool,8,[e])).results[0].code,403);
  assert.equal((await learning.ingest(store.pool,8,[{...e,user_id:8}])).results[0].code,404);
  assert.equal(store.events.size,0);
});

test('client cannot supply correctness or probability as answer evidence',async()=>{
  const store=eventStore(),e=envelope();
  for(const field of ['is_correct','probability','correct_answer']){
    assert.equal((await learning.ingest(store.pool,7,[{...e,event_payload:{...e.event_payload,[field]:true}}])).results[0].code,400);
  }
  assert.equal(store.events.size,0);
});

test('repeated completion calls grading/observations/stats only once',async()=>{
  let attempt={attempt_id:1,user_id:7,is_completed:false,start_time:new Date(),end_time:null};
  const writes={completion:0,stats:0,observations:0,events:0};
  const client={release(){},async query(sql,args=[]){
    if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
    if(sql.includes('SELECT * FROM user_test_attempts'))return {rows:args[1]===7?[{...attempt}]:[]};
    if(sql.includes('SELECT aq.question_id,aq.question_snapshot,ua.user_answer FROM user_test_attempts'))return {rows:[]};
    if(sql.includes('SELECT aq.question_id,aq.question_snapshot,ua.user_answer'))return {rows:[{question_id:2,question_snapshot:q,user_answer:'A'}]};
    if(sql.includes('UPDATE user_answers'))return {rows:[]};
    if(sql.includes('COUNT(*)::integer AS total'))return {rows:[{total:1,correct:1,answered:1}]};
    if(sql.includes('UPDATE user_test_attempts SET end_time')){
      writes.completion++;attempt={...attempt,is_completed:true,end_time:new Date(),total_questions:args[1],total_correct:args[2],grading_result:JSON.parse(args[4]),time_spent:0};return {rows:[{...attempt}]};
    }
    if(sql.includes('INSERT INTO user_stats')){writes.stats++;return {rows:[]};}
    if(sql.includes('FROM learning_kc_mapping_versions'))return {rows:[]};
    if(sql.includes('INSERT INTO learning_answer_observations')){writes.observations++;return {rows:[]};}
    if(sql.includes('INSERT INTO learning_events')){writes.events++;return {rows:[]};}
    throw Error('Unexpected SQL: '+sql);
  }};
  const dbPath=require.resolve('../db');
  const previous=require.cache[dbPath];
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{connect:async()=>client}};
  try{
    const service=require('../src/modules/tests/attemptService');
    const first=await service.finishAttempt(1,7),again=await service.finishAttempt(1,7);
    assert.equal(first.grading.correct,1);
    assert.equal(again.grading.correct,1);
    assert.deepEqual(writes,{completion:1,stats:1,observations:1,events:1});
    await assert.rejects(service.finishAttempt(1,8),e=>e.status===404);
  }finally{if(previous)require.cache[dbPath]=previous;else delete require.cache[dbPath];}
});
