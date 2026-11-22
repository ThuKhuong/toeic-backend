// All synthetic learners/approvals live ONLY in a random schema of the guarded TEST database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const dev=require('./learningDevEnvironment');
const results=[];
const pass=(name,condition=true)=>{assert.ok(condition,name);results.push(name);};
async function main(){
  const before=await dev.fingerprintSource();
  fs.mkdirSync(dev.reportRoot,{recursive:true});
  const baseline=path.join(dev.reportRoot,'source_database_before.json');
  if(!fs.existsSync(baseline))fs.writeFileSync(baseline,JSON.stringify(before,null,2)+'\n');
  await dev.prepare('toeic_learning_events_test');
  const schema='events_'+randomUUID().replaceAll('-','');
  const admin=await dev.connect('toeic_learning_events_test');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new Pool({...dev.base,database:'toeic_learning_events_test',options:`-c search_path=${schema}`});
  let server,originalPool;
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20261114_learning_events.sql'),'utf8');
  try{
    await pool.query(fs.readFileSync(path.join(__dirname,'../database/toeic_learning_system.sql'),'utf8'));
    await pool.query(migration);await pool.query(migration);pass('additive migration can be applied twice');
    await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations/20261114_learning_events_rollback.sql'),'utf8'));
    pass('empty-evidence rollback removes only learning tables',(await pool.query("SELECT to_regclass('learning_events') AS t")).rows[0].t===null);
    await pool.query(migration);
    process.env.DB_NAME='toeic_learning_events_test';process.env.LEARNING_EVENTS_ENABLED='1';process.env.AI_QUESTION_SHADOW_ENABLED='0';
    process.env.LEARNING_VERSION_SECRET='TEST_ONLY_PERSISTENT_CONTENT_VERSION_SECRET_NOT_FOR_DEPLOYMENT';
    originalPool=require('../db');require.cache[require.resolve('../db')].exports=pool;
    server=require('../server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/api`;
    const request=async(method,route,token,body)=>{
      const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      return {status:r.status,body:await r.json()};
    };
    async function register(name){const r=await request('POST','/auth/register',null,{email:`${name}@example.invalid`,password:'Fixture-only-123',role:'STUDENT'});assert.equal(r.status,201);return r.body;}
    const user=await register('event_owner'),other=await register('event_other');
    const test=(await pool.query("INSERT INTO tests(test_name,test_type,time_limit,is_active) VALUES('EVENT TEST FIXTURE','part_test',20,true) RETURNING test_id")).rows[0].test_id;
    const qs=(await pool.query(`INSERT INTO questions(test_id,question_type,part_number,question_text,correct_answer,explanation,order_in_test)
      VALUES($1,'reading',5,'Fixture Q1','A','Fixture explanation',1),($1,'reading',5,'Fixture Q2','B','Fixture explanation',2),
      ($1,'listening',1,'Fixture audio question','A','Fixture script',3) RETURNING question_id`,[test])).rows.map(q=>q.question_id);
    await pool.query("UPDATE questions SET audio_url='/uploads/fixture.mp3' WHERE question_id=$1",[qs[2]]);
    for(const q of qs)for(const label of ['A','B','C','D'])await pool.query('INSERT INTO answer_choices(question_id,choice_label,choice_text,is_correct) VALUES($1,$2,$3,false)',[q,label,`Fixture choice ${label}`]);
    const start=await request('POST',`/tests/${test}/attempt`,user.token,{});assert.equal(start.status,200);const attempt=start.body.attempt_id;
    const version=start.body.questions[0].question_version,version2=start.body.questions[1].question_version;
    const version3=start.body.questions[2].question_version;
    pass('start snapshots content version without exposing answer key',version.length===64&&!Object.hasOwn(start.body.questions[0],'correct_answer'));
    const session=randomUUID();let sequence=0;
    const event=(type,patch={})=>({event_id:randomUUID(),client_session_id:session,client_sequence:++sequence,attempt_id:attempt,
      question_id:qs[0],event_type:type,event_timestamp:new Date().toISOString(),event_payload:{},question_version:version,...patch});
    const events=[event('QUESTION_VIEWED'),event('ANSWER_SUBMITTED',{event_payload:{previous_answer:null,new_answer:'A'}}),
      event('ANSWER_CHANGED',{event_payload:{previous_answer:'A',new_answer:'B'}}),event('ANSWER_CHANGED',{event_payload:{previous_answer:'B',new_answer:'C'}})];
    const batch=body=>request('POST','/learning-events/batch',user.token,{events:body});
    pass('event endpoint requires JWT',(await request('POST','/learning-events/batch',null,{events})).status===401);
    let received=await batch(events);pass('all client interactions accepted',received.body.results.every(r=>r.status==='accepted'));
    received=await batch(events);pass('lost response/offline retry deduplicates all IDs',received.body.results.every(r=>r.status==='duplicate'));
    received=await batch([{...events[0],event_payload:{changed:true}}]);pass('reused ID with different payload rejected',received.body.results[0].code===409);
    received=await request('POST','/learning-events/batch',other.token,{events:[event('QUESTION_VIEWED')]});pass('wrong owner cannot attach an event',received.body.results[0].code===404);
    pass('wrong user field rejected',(await batch([event('QUESTION_VIEWED',{user_id:other.user.user_id})])).body.results[0].code===403);
    pass('wrong attempt rejected',(await batch([event('QUESTION_VIEWED',{attempt_id:2147483647})])).body.results[0].code===404);
    pass('unpresented question rejected',(await batch([event('QUESTION_VIEWED',{question_id:2147483647})])).body.results[0].code===400);
    pass('question version mismatch rejected',(await batch([event('QUESTION_VIEWED',{question_version:'invalid'})])).body.results[0].code===409);
    pass('client probability cannot be a correctness label',(await batch([event('ANSWER_SUBMITTED',{event_payload:{new_answer:'A',probability:0.99}})])).body.results[0].code===400);
    pass('explanation before completion rejected',(await batch([event('EXPLANATION_VIEWED')])).body.results[0].code===409);
    pass('audio event matches presented Listening source',(await batch([event('AUDIO_PLAYED',{question_id:qs[2],question_version:version3,event_payload:{audio_url:'/uploads/fixture.mp3'}})])).body.results[0].status==='accepted');
    pass('unrelated audio cannot attach to question',(await batch([event('AUDIO_PLAYED',{question_id:qs[2],question_version:version3,event_payload:{audio_url:'/uploads/other.mp3'}})])).body.results[0].code===400);
    pass('client cannot forge completion',(await batch([event('ATTEMPT_COMPLETED',{question_id:null})])).body.results[0].code===400);
    const progress=(revision,answer)=>({progress_revision:revision,current_index:0,elapsed_seconds:revision+10,
      answers:[{question_id:qs[0],user_answer:answer,time_spent:revision},{question_id:qs[1],user_answer:'B',time_spent:2}]});
    assert.equal((await request('PUT',`/tests/attempts/${attempt}/progress`,user.token,progress(1,'A'))).status,200);
    pass('duplicate progress acknowledged without extra state revision',(await request('PUT',`/tests/attempts/${attempt}/progress`,user.token,progress(1,'A'))).body.duplicate===true);
    assert.equal((await request('PUT',`/tests/attempts/${attempt}/progress`,user.token,progress(2,'B'))).status,200);
    assert.equal((await request('PUT',`/tests/attempts/${attempt}/progress`,user.token,progress(3,'C'))).status,200);
    pass('stale progress cannot overwrite latest answer',(await request('PUT',`/tests/attempts/${attempt}/progress`,user.token,progress(2,'B'))).status===409);
    const historyPath=`/learning-events/attempts/${attempt}/questions/${qs[0]}/history`;
    let history=await request('GET',historyPath,user.token);
    pass('initial, every change, final and both change counts retained',history.body.initial_answer==='A'&&history.body.final_answer==='C'&&history.body.recorded_change_count===2&&history.body.persisted_change_count===2);
    pass('active history does not leak snapshot correctness',history.body.persisted_revisions.every(r=>!Object.hasOwn(r,'correctness')));
    pass('history enforces ownership',(await request('GET',historyPath,other.token)).status===404);
    const resume=await request('GET',`/tests/attempts/${attempt}/resume`,user.token);
    pass('resume retains attempt, latest answer, time, version and revision',resume.body.attempt_id===attempt&&resume.body.questions[0].user_answer==='C'&&resume.body.progress_revision===3&&resume.body.questions[0].question_version===version);
    // Approved/pending records below are explicitly synthetic review states ONLY in this isolated fixture schema.
    const approved=randomUUID();
    await pool.query(`INSERT INTO learning_kc_mapping_versions(mapping_version,question_id,question_version,taxonomy_version,review_status,primary_kc,secondary_kcs,content_verified,audio_verified,reviewed_by,reviewed_at,provenance)
      VALUES($1,$2,$3,'FIXTURE_ONLY','approved','fixture_primary','["fixture_secondary_a","fixture_secondary_b"]',true,false,'fixture_not_human',NOW(),'{"test_fixture":true}')`,[approved,qs[1],version2]);
    await pool.query(`INSERT INTO learning_kc_mapping_versions(mapping_version,question_id,question_version,taxonomy_version,review_status,primary_kc,provenance)
      VALUES($1,$2,$3,'FIXTURE_ONLY','pending_review','fixture_pending','{"test_fixture":true}')`,[randomUUID(),qs[0],version]);
    const complete=await request('PUT',`/tests/attempts/${attempt}/complete`,user.token,{});
    pass('completion grades actual final answers',complete.status===200&&complete.body.total_correct===1);
    assert.equal((await request('PUT',`/tests/attempts/${attempt}/complete`,user.token,{})).status,200);
    const completedEvents=(await pool.query("SELECT COUNT(*)::integer AS n FROM learning_events WHERE attempt_id=$1 AND event_type='ATTEMPT_COMPLETED'",[attempt])).rows[0].n;
    pass('completion retry creates one event and one stats increment',completedEvents===1&&(await pool.query('SELECT tests_completed FROM user_stats WHERE user_id=$1',[user.user.user_id])).rows[0].tests_completed===1);
    const observations=(await pool.query('SELECT * FROM learning_answer_observations WHERE attempt_id=$1 ORDER BY question_id',[attempt])).rows;
    pass('one observation per answered question, never per secondary KC',observations.length===2&&observations[1].secondary_kcs.length===2);
    pass('pending mapping never enters BKT',observations[0].mapping_version===null&&!observations[0].bkt_eligible_at_capture);
    pass('approved mapping and provenance captured',observations[1].mapping_version===approved&&observations[1].mapping_provenance.test_fixture===true&&observations[1].bkt_eligible_at_capture);
    pass('BKT view has exactly one primary observation',(await pool.query('SELECT COUNT(*)::integer AS n FROM bkt_ready_observations')).rows[0].n===1);
    pass('first encounter flagged',observations.every(o=>o.is_first_response&&o.prior_response_count===0));
    const late=event('ANSWER_CHANGED',{event_payload:{previous_answer:'C',new_answer:'A'}});
    pass('late offline interaction retained after completion',(await batch([late])).body.results[0].status==='accepted');
    pass('late telemetry never changes final graded answer',(await pool.query('SELECT user_answer,is_correct FROM user_answers WHERE attempt_id=$1 AND question_id=$2',[attempt,qs[0]])).rows[0].user_answer==='C');
    pass('post-completion explanation exposure accepted',(await batch([event('EXPLANATION_VIEWED')])).body.results[0].status==='accepted');
    const result=await request('GET',`/tests/attempts/${attempt}/results`,user.token);
    pass('results maintain correct/incorrect grading',result.status===200&&result.body.grading.correct===1&&result.body.answers[0].is_correct===false&&result.body.answers[1].is_correct===true);
    const second=await request('POST',`/tests/${test}/attempt`,user.token,{});const secondId=second.body.attempt_id;
    pass('stable HMAC content version across attempts',second.body.questions[0].question_version===version);
    assert.equal((await request('PUT',`/tests/attempts/${secondId}/progress`,user.token,progress(1,'A'))).status,200);
    assert.equal((await request('PUT',`/tests/attempts/${secondId}/complete`,user.token,{})).status,200);
    pass('repeat counts include prior answered attempt',(await pool.query('SELECT is_first_response,prior_response_count FROM learning_answer_observations WHERE attempt_id=$1',[secondId])).rows.every(r=>!r.is_first_response&&r.prior_response_count===1));
    await pool.query("UPDATE learning_kc_mapping_versions SET review_status='rejected' WHERE mapping_version=$1",[approved]);
    pass('revoked approval removes observations from ready view',(await pool.query('SELECT COUNT(*)::integer AS n FROM bkt_ready_observations')).rows[0].n===0);
    const sessionId=(await pool.query("INSERT INTO vocabulary_study_sessions(user_id,scope_key,word_ids) VALUES($1,'fixture','{}') RETURNING session_id",[user.user.user_id])).rows[0].session_id;
    const lesson=type=>event(type,{attempt_id:null,question_id:null,question_version:null,lesson_id:`vocabulary_study_session:${sessionId}`});
    pass('owned vocabulary lesson start accepted',(await batch([lesson('LESSON_STARTED')])).body.results[0].status==='accepted');
    pass('lesson completion requires server completion',(await batch([lesson('LESSON_COMPLETED')])).body.results[0].code===409);
    await pool.query('UPDATE vocabulary_study_sessions SET completed_at=NOW() WHERE session_id=$1',[sessionId]);
    pass('owned completed lesson accepted',(await batch([lesson('LESSON_COMPLETED')])).body.results[0].status==='accepted');
    await assert.rejects(pool.query("UPDATE learning_events SET event_type='QUESTION_VIEWED'"),/append-only/);pass('learning events are append-only');
    await assert.rejects(pool.query('DELETE FROM learning_answer_revisions'),/append-only/);pass('answer revisions are append-only');
    await assert.rejects(pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations/20261114_learning_events_rollback.sql'),'utf8')),/Refusing rollback/);
    // A failed explicit transaction must be rolled back on its own checked-out connection.
    pass('rollback refuses to discard populated evidence');
    const after=await dev.fingerprintSource();pass('configured source database remains byte-for-byte unchanged',JSON.stringify(before)===JSON.stringify(after));
    const report={status:'PASS',database:'toeic_learning_events_test',fixture_schema:schema,checks:results.length,results,
      synthetic_approvals:'isolated test fixtures only; no real mappings approved',source_database_unchanged:true,at:new Date().toISOString()};
    fs.writeFileSync(path.join(dev.reportRoot,'node_integration_results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({status:'PASS',checks:results.length,database:report.database,source_database_unchanged:true}));
  }finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await pool.end();if(originalPool)await originalPool.end();
    assert.match(schema,/^events_[a-f0-9]{32}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
