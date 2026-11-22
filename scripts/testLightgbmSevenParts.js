// Technical fixtures only: real HTTP + unchanged Python artifacts + isolated TEST schema.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { Pool, Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const root = path.resolve(__dirname, '../..');
const database = 'toeic_learning_events_test';
if (database === process.env.DB_NAME) throw Error('Refusing configured source database');
if (!['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST || 'localhost')) throw Error('Local test database required');
const base = { host:process.env.DB_HOST || 'localhost',port:process.env.DB_PORT || 5432,user:process.env.DB_USER || 'postgres',password:process.env.DB_PASS || '',database };
const schema = 'lgbm_validation_' + crypto.randomUUID().replaceAll('-', '');
const admin = new Client(base);
const pool = new Pool({ ...base, options: `-c search_path=${schema} -c timezone=Asia/Ho_Chi_Minh` });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const modelPaths = { v2:path.join(root,'toeic-ai/models/v2/lightgbm_v2.joblib'),v3:path.join(root,'toeic-ai/models/v3_app_shadow/model.joblib') };
const hashes = Object.fromEntries(Object.entries(modelPaths).map(([k,p])=>[k,hash(p)]));
let python, server, created = false, offline = false, captureCalls = 0;
const results = [];
async function freePort() { const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port; }
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function stopPython() {
  if (!python || python.exitCode !== null) return;
  if(process.platform==='win32') { try { execFileSync('taskkill',['/PID',String(python.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch { python.kill(); } }
  else python.kill();
}

async function main() {
  try {
    await admin.connect();
    const marker=(await admin.query("SELECT shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker")).rows[0].marker;
    assert.equal(marker,'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT');
    await admin.query(`CREATE SCHEMA "${schema}"`); created=true;
    const ddl=fs.readFileSync(path.join(__dirname,'../database/toeic_learning_system.sql'),'utf8');
    assert.equal(/SET\s+search_path|CREATE\s+DATABASE|public\./i.test(ddl),false,'Fixture DDL must remain inside its schema');
    await pool.query(ddl);
    for(const name of ['20261026_question_source.sql','20261027_source_question_number.sql','20261027_attempt_grading.sql','20261105_question_predictions.sql','20261114_learning_events.sql']) {
      const migration=fs.readFileSync(path.join(__dirname,'../database/migrations',name),'utf8');
      assert.equal(/SET\s+search_path|CREATE\s+DATABASE|public\./i.test(migration),false,'Test migration must remain inside its schema');
      await pool.query(migration);
    }
    const aiPort=await freePort(),aiUrl=`http://127.0.0.1:${aiPort}`;
    const realFetch=global.fetch;
    global.fetch=(url,options)=>{ if(offline && String(url).startsWith(aiUrl)) return Promise.reject(Error('fixture AI unavailable'));return realFetch(url,options); };
    process.env.AI_SERVICE_URL=aiUrl;process.env.LEARNING_EVENTS_ENABLED='1';process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
    process.env.LEARNING_VERSION_SECRET=crypto.randomBytes(32).toString('hex');
    // Cache the test pool BEFORE application imports; never construct a source DB pool.
    const dbPath=require.resolve('../db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:pool};
    python=spawn(path.join(root,'toeic-ai/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),
      ['-B','-m','uvicorn','api:app','--app-dir','src','--host','127.0.0.1','--port',String(aiPort)],
      {cwd:path.join(root,'toeic-ai'),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let pythonLog='',spawnError;python.on('error',e=>{spawnError=e;});
    python.stderr.on('data',d=>{pythonLog=(pythonLog+d.toString()).slice(-4000);});python.stdout.on('data',()=>{});
    const deadline=Date.now()+45000;
    for(;;) {
      try { const r=await realFetch(`${aiUrl}/health`,{signal:AbortSignal.timeout(1000)});const h=await r.json();assert.equal(h.artifact_sha256,hashes.v2);assert.equal(h.question_model.artifact_sha256,hashes.v3);break; }
      catch { if(spawnError || python.exitCode!==null || Date.now()>deadline) throw Error(`Isolated Python startup failed: ${spawnError?.message || pythonLog}`);await delay(200); }
    }
    const captureModule=require('../src/modules/ai/questionPrediction');
    const capture=captureModule.createQuestionCapture({baseUrl:aiUrl,fetchImpl:global.fetch});
    captureModule.captureQuestionPredictions=async(client,a,questions)=>{
      captureCalls++;
      assert.equal((await pool.query('SELECT 1 FROM user_test_attempts WHERE attempt_id=$1',[a.attempt_id])).rowCount,0,'Attempt exposed before prediction commit');
      return capture(client,a,questions);
    };
    const fixtureApp=require('../server');
    // Research-only adapter for old integration assertions; no public preview route remains.
    const preview=require('./legacy/v2PredictionPreview').createPredictor({pool,baseUrl:aiUrl});
    fixtureApp.post('/api/ai/me/predict',require('../src/middlewares/auth').authMiddleware,async(req,res)=>{
      try {res.json(await preview(req.user.user_id,req.body.part));}catch(e){res.status(e.status||503).json({error:e.message});}
    });
    server=fixtureApp.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const api=`http://127.0.0.1:${server.address().port}/api`;
    const userIds=(await pool.query(`INSERT INTO "User"(email,password_hash) VALUES ('validation-a@example.invalid','fixture'),('validation-b@example.invalid','fixture') RETURNING user_id`)).rows.map(r=>r.user_id);
    const jwt=require('jsonwebtoken');
    async function call(user,method,url,body,expected=200) {
      const response=await realFetch(api+url,{method,headers:{Authorization:`Bearer ${jwt.sign({user_id:user,role:'STUDENT'},process.env.JWT_SECRET)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
    }
    let lastTest;
    for(let part=1;part<=7;part++) {
      const testId=(await pool.query("INSERT INTO tests(test_name,test_type,is_active,parts) VALUES($1,'part_test',true,$2) RETURNING test_id",[`Validation fixture Part ${part}`,[part]])).rows[0].test_id;lastTest=testId;
      let group=null;
      if([3,4,6,7].includes(part)) group=(await pool.query('INSERT INTO question_groups(title,part_number) VALUES($1,$2) RETURNING group_id',['Fixture shared stimulus',part])).rows[0].group_id;
      for(let i=0;i<3;i++) {
        const qid=(await pool.query("INSERT INTO questions(test_id,part_number,question_type,question_text,correct_answer,order_in_test,group_id) VALUES($1,$2,$3,$4,'A',$5,$6) RETURNING question_id",[testId,part,part<=4?'listening':'reading',`Part ${part} fixture item ${i}`,i+1,group])).rows[0].question_id;
        for(const label of part===2?['A','B','C']:['A','B','C','D']) await pool.query('INSERT INTO answer_choices(question_id,choice_label,choice_text,is_correct) VALUES($1,$2,$3,$4)',[qid,label,label,label==='A']);
      }
      const before=await call(userIds[0],'POST','/ai/me/predict',{part});assert.equal(before.status,'insufficient_data');
      async function run(user,otherExpected) {
        const a=await call(user,'POST',`/tests/${testId}/attempt`);
        assert.equal(a.questions.length,3);assert.ok(a.questions.every(q=>q.part_number===part));
        assert.equal(JSON.stringify(a).includes('probability'),false);assert.ok(a.questions.every(q=>!Object.hasOwn(q,'correct_answer')));
        assert.ok(a.questions.every(q=>q.choices.length===(part===2?3:4)));
        const saved=(await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1',[a.attempt_id])).rows[0].question_predictions;
        assert.equal(saved.status,'ready');assert.equal(saved.artifact_sha256,hashes.v3);
        assert.ok(saved.questions.slice(0,2).every(q=>(q.features.question_count>0)===otherExpected));
        await call(user,'GET',`/tests/attempts/${a.attempt_id}/results`,undefined,409);
        await call(userIds.find(u=>u!==user),'GET',`/tests/attempts/${a.attempt_id}/resume`,undefined,404);
        const resumed=await call(user,'GET',`/tests/attempts/${a.attempt_id}/resume`);assert.equal(JSON.stringify(resumed).includes('probability'),false);
        for(let i=0;i<2;i++) await call(user,'PUT',`/tests/attempts/${a.attempt_id}/answer`,{question_id:a.questions[i].question_id,user_answer:i===0?'A':'B',time_spent:2});
        const done=await call(user,'PUT',`/tests/attempts/${a.attempt_id}/complete`);
        assert.equal(done.ai_prediction.status,'ready');assert.equal(done.ai_prediction.parts[0].artifact_sha256,hashes.v2);
        assert.equal('question_prediction' in done,false);
        assert.equal('question_predictions' in done,false);
        const researchAnswers=(await pool.query(`SELECT aq.question_id,aq.question_snapshot,ua.user_answer
          FROM attempt_questions aq LEFT JOIN user_answers ua USING(attempt_id,question_id)
          WHERE aq.attempt_id=$1 ORDER BY aq.position`,[a.attempt_id])).rows;
        const researchSummary=captureModule.questionPredictionSummary(saved,researchAnswers,done.end_time);
        assert.equal(researchSummary.answered,2);assert.equal(researchSummary.unanswered,1);
        const frozen=(await pool.query('SELECT ai_prediction,question_predictions FROM user_test_attempts WHERE attempt_id=$1',[a.attempt_id])).rows[0];
        const result=await call(user,'GET',`/tests/attempts/${a.attempt_id}/results`);
        assert.equal('question_prediction' in result,false);
        assert.equal('question_predictions' in result.attempt,false);
        const again=(await pool.query('SELECT ai_prediction,question_predictions FROM user_test_attempts WHERE attempt_id=$1',[a.attempt_id])).rows[0];assert.deepEqual(again,frozen);
        return a;
      }
      await run(userIds[0],false);await run(userIds[1],true);await run(userIds[0],true);
      const prediction=await call(userIds[0],'POST','/ai/me/predict',{part});assert.equal(prediction.status,'experimental');assert.ok(prediction.probability>=0&&prediction.probability<=1);
      results.push({part,passed:true,technical_fixture:true});
    }
    const client=await pool.connect();let report;
    try { report=await require('./auditLightgbmApp').collect(client,hashes); } finally {client.release();}
    assert.equal(report.v3_pre_attempt.overall.model.rows,42);
    assert.equal(report.v2_next_attempt.overall.model.rows,14);
    assert.ok(report.v3_pre_attempt.by_part.every(p=>p.model.rows===6));assert.ok(report.v2_next_attempt.by_part.every(p=>p.model.rows===2));
    offline=true;
    const failed=await call(userIds[0],'POST',`/tests/${lastTest}/attempt`);
    assert.equal((await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1',[failed.attempt_id])).rows[0].question_predictions.status,'failed');
    await call(userIds[0],'PUT',`/tests/attempts/${failed.attempt_id}/answer`,{question_id:failed.questions[0].question_id,user_answer:'B',time_spent:1});
    const finished=await call(userIds[0],'PUT',`/tests/attempts/${failed.attempt_id}/complete`);assert.equal(finished.is_completed,true);assert.equal(finished.ai_prediction.status,'failed');
    assert.deepEqual(Object.fromEntries(Object.entries(modelPaths).map(([k,p])=>[k,hash(p)])),hashes);
    const out=path.join(root,'toeic-ai/reports/lightgbm_app_validation',new Date().toISOString().replace(/[:.]/g,'-'));
    fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'technical_7_parts.json'),JSON.stringify({database,schema,parts:results,capture_calls:captureCalls,
      artifact_sha256:hashes,real_python:true,real_http:true,fixture_not_quality_evidence:true,prospective_audit_expected_rows:{v2:14,v3:42},offline_exam_completion:true,
      limitations:['Synthetic fixtures do not establish model accuracy or ability measurement.','Listening playback, real content quality and physical-device UI not covered.']},null,2)+'\n');
    console.log(JSON.stringify({passed_parts:results.length,fixture_not_quality_evidence:true,report:path.join(out,'technical_7_parts.json')}));
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    stopPython();await pool.end();
    if(created){assert.match(schema,/^lgbm_validation_[a-f0-9]{32}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}
    await admin.end();
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
