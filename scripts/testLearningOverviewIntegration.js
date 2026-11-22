// No Python required. All fixture writes are isolated from real learner data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto'), { Pool } = require('pg');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const testDatabase='toeic_learning_events_test';
if(testDatabase===process.env.DB_NAME) throw Error('Refusing configured application database');
process.env.LEARNING_EVENTS_ENABLED='0';
const admin = new Pool({host:process.env.DB_HOST||'localhost',port:process.env.DB_PORT||5432,
  user:process.env.DB_USER||'postgres',password:process.env.DB_PASS||'',database:testDatabase});
const schema = 'learning_overview_' + randomUUID().replaceAll('-', '');
const pool = new Pool({ ...admin.options, options: `-c search_path=${schema}` });

async function main() {
  let server;
  let created=false;
  try {
    const marker=(await admin.query("SELECT shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker")).rows[0].marker;
    assert.equal(marker,'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created=true;
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/toeic_learning_system.sql'), 'utf8'));
    const users = (await pool.query(`INSERT INTO "User"(email,password_hash) VALUES
      ('overview1@example.invalid','fixture'),('overview2@example.invalid','fixture'),('overview3@example.invalid','fixture') RETURNING user_id`)).rows.map(r => r.user_id);
    const testId = (await pool.query("INSERT INTO tests(test_name,is_active) VALUES ('Overview fixture',true) RETURNING test_id")).rows[0].test_id;
    const questions = (await pool.query(`INSERT INTO questions(test_id,question_type,part_number,question_text,correct_answer)
      VALUES ($1,'reading',5,'Q1','A'),($1,'reading',5,'Q2','A'),($1,'reading',7,'Q3','A') RETURNING question_id,part_number,question_text,correct_answer`, [testId])).rows;
    async function attempt(user, completed, when, entries) {
      const id = (await pool.query(`INSERT INTO user_test_attempts(user_id,test_id,is_completed,start_time,end_time)
        VALUES($1,$2,$3,CURRENT_TIMESTAMP-interval '10 days',CURRENT_TIMESTAMP+($4::integer * interval '1 day')) RETURNING attempt_id`, [user, testId, completed, when])).rows[0].attempt_id;
      for (const [index, [qIndex, answer]] of entries.entries()) {
        const snapshot = { ...questions[qIndex], choices: ['A','B','C','D'].map(choice_label=>({choice_label,choice_text:choice_label})), skills: qIndex === 0
          ? [{ code: 'reading_detail', name: 'Đọc chi tiết' }] : [] };
        await pool.query('INSERT INTO attempt_questions(attempt_id,question_id,position,question_snapshot) VALUES($1,$2,$3,$4)',
          [id, snapshot.question_id, index + 1, JSON.stringify(snapshot)]);
        if (answer !== null) await pool.query(`INSERT INTO user_answers(attempt_id,question_id,user_answer,is_correct)
          VALUES($1,$2,$3,true)`, [id, snapshot.question_id, answer]); // Deliberately wrong cached is_correct.
      }
    }
    await attempt(users[0], true, -3, [[0, 'B'], [1, null]]);
    await attempt(users[0], true, -2, [[0, 'A'], [1, 'A']]);
    await attempt(users[0], false, -1, [[2, 'A']]);
    await attempt(users[0], true, 1, [[2, 'A']]);
    await attempt(users[1], true, -1, [[2, 'A']]);
    const dbPath=require.resolve('../db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:pool};
    server = require('../server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/ai/me/overview`;
    const token = id => require('jsonwebtoken').sign({ user_id: id, role: 'STUDENT' }, process.env.JWT_SECRET || 'secret123');
    const request = (id, query = '') => fetch(url + query, { headers: { Authorization: `Bearer ${token(id)}` } });
    assert.equal((await fetch(url)).status, 401);
    const response = await request(users[0], `?user_id=${users[1]}`);
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.method, 'descriptive_rules'); assert.equal(body.totals.attempts, 2);
    assert.equal(body.totals.answered, 3); assert.equal(body.totals.correct, 2);
    assert.equal(body.totals.unanswered, 1); assert.equal(body.totals.repeat_answers, 1);
    assert.equal(body.totals.first_answered, 2); assert.equal(body.totals.first_correct, 1);
    assert.equal(body.parts[6].answered, 0); assert.equal(body.skills, undefined);
    assert.equal(body.policy.inference_called,false);assert.equal(body.parts[4].trend.status,'descriptive_comparison');
    assert.equal(JSON.stringify(body).includes('correct_answer'), false);
    assert.equal((await (await request(users[1])).json()).totals.answered, 1);
    assert.equal((await (await request(users[2])).json()).status, 'insufficient_data');
    console.log('PASS: isolated TEST HTTP/PostgreSQL Part profile, JWT isolation, completed/past snapshots, blanks, repetition, between-attempt trend and empty learner; no Python calls.');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end(); assert.match(schema, /^learning_overview_[a-f0-9]{32}$/);
    if(created) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
