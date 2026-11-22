// Real Express -> PostgreSQL -> FastAPI smoke test on a restored COPY only.
// All simulated actions run inside one outer transaction and are rolled back.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {connect}=require('./learningDevEnvironment');
const {readSnapshot,compact,write}=require('./consolidateDatabases');
async function main(){
  const dir=path.resolve(process.argv[2]);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  const target=manifest.databases.toeic_learning_system.restored_database;
  if(!/^toeic_verify_main_\d+$/.test(target))throw Error('Restored verification database required');
  process.env.DB_NAME=target;process.env.LEARNING_EVENTS_ENABLED='1';
  process.env.LEARNING_VERSION_SECRET=fs.readFileSync(path.join(__dirname,'../private/learning-dev/version.key'),'utf8').trim();
  process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
  process.env.AI_SERVICE_URL='http://127.0.0.1:8000';
  const before=await readSnapshot(target),c=await connect(target);
  const pool=require('../db'),jwt=require('jsonwebtoken');
  await c.query('BEGIN');
  let depth=0;
  const query=async(sql,args)=>{
    if(/^BEGIN(?:\s|$)/i.test(sql)){await c.query('SAVEPOINT outer_smoke_'+(++depth));return {rows:[]};}
    if(/^COMMIT\s*$/i.test(sql)){await c.query('RELEASE SAVEPOINT outer_smoke_'+depth--);return {rows:[]};}
    if(/^ROLLBACK\s*$/i.test(sql)){await c.query('ROLLBACK TO SAVEPOINT outer_smoke_'+depth);await c.query('RELEASE SAVEPOINT outer_smoke_'+depth--);return {rows:[]};}
    return c.query(sql,args);
  };
  pool.query=query;pool.connect=async()=>({query,release(){}});
  const app=require('../server'),server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const token=(id,role)=>jwt.sign({user_id:id,role},process.env.JWT_SECRET,{expiresIn:'5m'});
  const admin=token(4,'ADMIN'),student=token(3,'STUDENT'),other=token(5,'STUDENT');
  const checks=[];
  async function call(route,{method='GET',body,auth=student,status=200}={}){
    const r=await fetch(origin+'/api'+route,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();
    assert.equal(r.status,status,route+' '+JSON.stringify(data).slice(0,300));return data;
  }
  try{
    const catalog=await call('/tests',{auth:null});assert.equal(catalog.length,7);
    const media=new Set(),audio=new Set();
    for(let part=1;part<=7;part++){
      const list=await call('/tests?part='+part,{auth:null});assert.ok(list.length);
      const t=list[0],started=await call('/tests/'+t.test_id+'/attempt',{method:'POST'});
      assert.ok(started.questions.length);assert.ok(started.questions.every(q=>q.part_number===part));
      for(const q of started.questions){assert.ok(!Object.hasOwn(q,'correct_answer'));assert.ok(!Object.hasOwn(q,'material_transcript'));
        assert.ok(q.choices.every(c=>!Object.hasOwn(c,'is_correct')));
        for(const url of [q.audio_url,q.material_audio])if(url){media.add(url);audio.add(url);}
        for(const url of [q.image_url,q.group_image_url,q.passage_image_url,...(q.passages||[]).map(p=>p.image_url)])if(url)media.add(url);
      }
      const id=started.attempt_id,q=started.questions[0];
      const saved=(await query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1',[id])).rows[0].question_predictions;
      assert.equal(saved.status,'ready');assert.equal(saved.questions.length,started.questions.length);
      const event={event_id:crypto.randomUUID(),user_id:3,attempt_id:id,question_id:q.question_id,event_type:'QUESTION_VIEWED',
        event_timestamp:new Date().toISOString(),event_payload:{position:1},question_version:q.question_version,
        client_session_id:crypto.randomUUID(),client_sequence:1};
      assert.equal((await call('/learning-events/batch',{method:'POST',body:{events:[event]}})).results[0].status,'accepted');
      assert.equal((await call('/learning-events/batch',{method:'POST',body:{events:[event]}})).results[0].status,'duplicate');
      await call('/tests/attempts/'+id+'/answer',{method:'PUT',body:{question_id:q.question_id,user_answer:q.choices[0].choice_label,time_spent:1}});
      await call('/tests/attempts/'+id+'/complete',{method:'PUT',auth:other,body:{},status:404});
      const finish=await call('/tests/attempts/'+id+'/complete',{method:'PUT',body:{}});
      assert.ok(finish.is_completed);assert.equal(finish.ai_prediction.status,'ready');
      assert.equal('question_prediction' in finish,false);assert.equal('question_predictions' in finish,false);
      const eventsBefore=Number((await query('SELECT count(*) n FROM learning_events WHERE attempt_id=$1',[id])).rows[0].n);
      await call('/tests/attempts/'+id+'/complete',{method:'PUT',body:{}});
      assert.equal(Number((await query('SELECT count(*) n FROM learning_events WHERE attempt_id=$1',[id])).rows[0].n),eventsBefore);
      const result=await call('/tests/attempts/'+id+'/results');assert.equal(result.answers.length,started.questions.length);
      assert.equal('question_prediction' in result,false);assert.equal('question_predictions' in result.attempt,false);
      // Preserved shadow evidence is inspected internally, outside product APIs.
      const researchRows=(await query(`SELECT aq.question_id,aq.question_snapshot,ua.user_answer
        FROM attempt_questions aq LEFT JOIN user_answers ua USING(attempt_id,question_id)
        WHERE aq.attempt_id=$1 ORDER BY aq.position`,[id])).rows;
      const shadowSummary=require('../src/modules/ai/questionPrediction').questionPredictionSummary(saved,researchRows,finish.end_time);
      assert.equal(shadowSummary.answered,1);assert.equal(shadowSummary.unanswered,started.questions.length-1);
      await call('/tests/attempts/'+id+'/results',{auth:other,status:404});
      const obs=(await query('SELECT count(*)::int n FROM learning_answer_observations WHERE attempt_id=$1 AND user_id=3',[id])).rows[0].n;
      assert.equal(obs,1);checks.push({check:'Part '+part+' start/answer/submit/results/events/v2/v3/ownership',status:'PASS',questions:started.questions.length});
    }
    const loose=(await query('SELECT question_id FROM questions WHERE part_number=2 AND test_id IS NULL ORDER BY question_id LIMIT 1')).rows[0];
    assert.ok(loose);
    const created=await call('/admin/tests/create-with-questions',{method:'POST',auth:admin,status:201,body:{
      test_name:catalog.find(t=>t.parts?.includes(2)).test_name,test_type:'part_test',time_limit:10,difficulty_level:1,parts:[2],
      part_number:2,total_questions:1,question_ids:[loose.question_id],publication_status:'draft',is_active:false}});
    const id=created.test.test_id;
    await call('/admin/tests/'+id,{method:'PUT',auth:admin,body:{description:'Verification on restored copy; rolled back'}});
    const published=await call('/admin/tests/'+id,{method:'PUT',auth:admin,body:{publication_status:'published',is_active:true}});
    assert.equal(published.publication_status,'published');assert.ok((await call('/tests',{auth:null})).some(t=>t.test_id===id));
    checks.push({check:'Authenticated admin create/edit/publish existing bank content',status:'PASS'});
    for(const url of media){const r=await fetch(new URL(url,origin),{method:'HEAD'});assert.equal(r.status,200,url);}
    for(const url of audio){const r=await fetch(new URL(url,origin),{headers:{Range:'bytes=0-1023'}});assert.equal(r.status,206,url);await r.arrayBuffer();}
    checks.push({check:'Shared media HEAD + audio byte ranges',status:'PASS',media:media.size,audio:audio.size});
  }finally{await new Promise(r=>server.close(r));await c.query('ROLLBACK');await c.end();await pool.end();}
  assert.deepEqual(compact(await readSnapshot(target)),compact(before));
  checks.push({check:'All simulated database actions rolled back; table hashes unchanged',status:'PASS'});
  write(path.join(dir,'staging_smoke.json'),{database:target,only_restored_copy:true,simulated_actions_not_research_data:true,checks});
  console.log(JSON.stringify({target,checks}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
