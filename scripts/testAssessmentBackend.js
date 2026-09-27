// Run against an explicitly selected test server. Uses and removes its own schema.
// PowerShell: $env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/postgres'
// node scripts/testAssessmentBackend.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to an isolated test server');
  const schema = 'backend_check_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  let server;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/toeic_learning_system.sql'), 'utf8'));
    const dbPath = require.resolve('../db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
    process.env.JWT_SECRET = 'isolated-backend-test-secret';
    const app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, { method = 'GET', token, body, status = 200 } = {}) {
      const response = await fetch(base + url, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      assert.equal(response.status, status, `${method} ${url}: ${text}`);
      return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
    }
    const register = email => request('/api/auth/register', { method: 'POST', status: 201,
      body: { email, password: 'Test-password-123', full_name: 'Test learner' } });
    const learner = await register('learner@example.invalid');
    const other = await register('other@example.invalid');
    const login = await request('/api/auth/login', { method: 'POST',
      body: { email: 'learner@example.invalid', password: 'Test-password-123' } });
    const token = login.token;
    const profile = await request('/api/users/me', { token });
    assert.equal(profile.user_id, learner.user.user_id);
    for (const field of ['total_xp','current_level','current_streak','longest_streak','target_score']) {
      assert.equal(field in profile, false);
      assert.equal(field in login.user, false);
    }
    const model = require('../src/modules/users/usersModel');
    await model.update(profile.user_id, { full_name: 'Updated learner', target_score: 900 });
    await model.setActive(profile.user_id, true);
    assert.equal((await model.list({})).length, 2);
    const testId = (await pool.query("INSERT INTO tests(test_name) VALUES ('Snapshot test') RETURNING test_id")).rows[0].test_id;
    const questionIds = [];
    for (let position = 1; position <= 2; position++) {
      const q = (await pool.query(`INSERT INTO questions
        (test_id,question_text,question_type,part_number,correct_answer,explanation,order_in_test)
        VALUES ($1,$2,'reading',5,'A','Original explanation',$3) RETURNING question_id`,
        [testId,`Original question ${position}`,position])).rows[0].question_id;
      questionIds.push(q);
      await pool.query(`INSERT INTO answer_choices(question_id,choice_text,choice_label,is_correct)
        SELECT $1,label,label,label='A' FROM unnest(ARRAY['A','B','C','D']) AS label`,[q]);
    }
    const preview = await request(`/api/tests/${testId}?include_answers=true`);
    assert.equal('correct_answer' in preview.questions[0], false);
    const attempt = await request(`/api/tests/${testId}/attempt`, { method: 'POST', token,
      body: { user_id: other.user.user_id } });
    assert.equal(attempt.user_id, profile.user_id);
    assert.equal(attempt.questions.length, 2);
    assert.equal('correct_answer' in attempt.questions[0], false);
    assert.equal('is_correct' in attempt.questions[0].choices[0], false);
    const url = `/api/tests/attempts/${attempt.attempt_id}`;
    await request(`${url}/results`, { token, status: 409 });
    await request(`${url}/complete`, { method: 'PUT', token: other.token, status: 404 });
    await request(`/api/tests/attempts/user/${profile.user_id}`, { token: other.token, status: 403 });
    const pending = await request(`/api/tests/${testId}/attempt`, { method: 'POST', token: other.token });
    await request(`/api/tests/attempts/${pending.attempt_id}/answer`, { method: 'PUT', token: other.token,
      body: { question_id: questionIds[0], user_answer: 'A', time_spent: 5 } });
    await pool.query("UPDATE questions SET part_number=7,correct_answer='B',question_text='Edited bank question' WHERE question_id=$1",[questionIds[0]]);
    await request(`${url}/answer`, { method: 'PUT',token,status:400,
      body:{question_id:2147483647,user_answer:'A',time_spent:10} });
    await Promise.all([1,2].map(() => request(`${url}/answer`, { method:'PUT',token,
      body:{question_id:questionIds[0],user_answer:'A',time_spent:12} })));
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM user_answers WHERE attempt_id=$1', [attempt.attempt_id])).rows[0].n,1);
    const results = await Promise.all([1,2].map(() => request(`${url}/complete`,{method:'PUT',token})));
    for (const result of results) { assert.equal(result.score,50); assert.equal(result.total_correct,1); }
    const stats = (await pool.query('SELECT * FROM user_stats WHERE user_id=$1',[profile.user_id])).rows[0];
    assert.equal(stats.tests_completed,1);
    assert.equal(stats.correct_answers,1);
    await request(`${url}/answer`, { method:'PUT',token,status:409,
      body:{question_id:questionIds[0],user_answer:'B',time_spent:12} });
    const review = await request(`${url}/results`,{token});
    assert.equal(review.answers.length,2);
    assert.equal(review.answers[0].question_text,'Original question 1');
    assert.equal(review.answers[0].correct_answer,'A');
    assert.equal(review.answers[1].user_answer,null);
    const dashboard = require('../src/modules/admin/adminService');
    await dashboard.getDashboardStats();
    await dashboard.getUsers(1,10);
    assert.equal((await dashboard.getDashboardTrends('day',7)).length,7);
    assert.equal((await dashboard.getDashboardTrends('week',2)).length,2);
    const statistics = await require('../src/modules/tests/testsModel').getTestStatistics(testId);
    assert.equal(Number(statistics.stats.total_attempts), 2);
    assert.equal(Number(statistics.stats.completed_attempts), 1);
    assert.equal(statistics.partStats.length, 1);
    assert.equal(statistics.partStats[0].part_number, 5);
    assert.equal(Number(statistics.partStats[0].total_answers), 2);
    assert.equal(Number(statistics.partStats[0].correct_answers), 1);
    await pool.query('UPDATE "User" SET role=$1 WHERE user_id=$2', ['ADMIN', other.user.user_id]);
    const adminLogin = await request('/api/auth/login', { method: 'POST',
      body: { email: 'other@example.invalid', password: 'Test-password-123' } });
    const adminReview = await request(`/api/admin/tests/attempts/${attempt.attempt_id}/detail`, { token: adminLogin.token });
    const draft = await request('/api/admin/tests', { method: 'POST', token: adminLogin.token, status: 201,
      body: { test_name: 'Draft visibility', test_type: 'part_test', time_limit: 30, difficulty_level: 1, parts: [5], is_active: false } });
    assert.equal(draft.is_active, false);
    assert((await request('/api/admin/tests', { token: adminLogin.token })).some(t => t.test_id === draft.test_id));
    assert.equal((await request(`/api/admin/tests/${draft.test_id}`, { token: adminLogin.token })).is_active, false);
    assert(!(await request('/api/tests?includeDrafts=true')).some(t => t.test_id === draft.test_id));
    await request(`/api/tests/${draft.test_id}`, { status: 404 });
    await request(`/api/tests/${draft.test_id}/attempt`, { method: 'POST', token, body: {}, status: 404 });
    await request(`/api/admin/tests/${draft.test_id}`, { method: 'PUT', token: adminLogin.token, body: { is_active: true } });
    assert((await request('/api/tests')).some(t => t.test_id === draft.test_id));
    await request(`/api/admin/tests/${draft.test_id}`, { method: 'PUT', token: adminLogin.token, body: { is_active: false } });
    assert((await request('/api/admin/tests', { token: adminLogin.token })).some(t => t.test_id === draft.test_id));
    await request(`/api/tests/${draft.test_id}`, { status: 404 });
    const generatedDraft = await request('/api/admin/tests/create-with-questions', { method: 'POST', token: adminLogin.token, status: 201,
      body: { test_name: 'Generated draft', test_type: 'part_test', time_limit: 30, difficulty_level: 1, parts: [5], part_number: 5, total_questions: 0, is_active: false } });
    assert.equal((await pool.query("SELECT is_active FROM tests WHERE test_name='Generated draft'")).rows[0].is_active, false);
    assert.equal(adminReview.answers[0].question_text, 'Original question 1');
    await request(`/api/admin/tests/attempts/${attempt.attempt_id}/detail`, { token, status: 403 });
    await request(`/api/admin/tests/attempts/${pending.attempt_id}/detail`, { token: adminLogin.token, status: 409 });
    for (const endpoint of ['/api/admin/users', '/api/admin/tests', '/api/admin/vocabulary',
      '/api/admin/vocabulary/topics', '/api/admin/questions?part_number=5',
      '/api/admin/listening/materials', '/api/admin/listening/questions/part/1/grouped',
      '/api/admin/tests/attempts/all', '/api/student/vocabulary']) {
      await request(endpoint, { token: adminLogin.token });
    }
    await request('/api/admin/srs', { token: adminLogin.token, status: 404 });
    await request('/api/admin/gamification/stats/global', { token: adminLogin.token, status: 404 });
    await request('/api/srs',{token,status:404});
    await request('/api/gamification/leaderboard',{token,status:404});
    // Resume: exact attempt, immutable snapshot, private answers, atomic progress and clocks.
    const resumable = await request(`/api/tests/${testId}/attempt`,{method:'POST',token});
    const resumeUrl = `/api/tests/attempts/${resumable.attempt_id}`;
    const progress = {current_index:1,elapsed_seconds:123,answers:[
      {question_id:questionIds[0],user_answer:'B',time_spent:100},
      {question_id:questionIds[1],user_answer:null,time_spent:23}
    ]};
    await request(`${resumeUrl}/progress`,{method:'PUT',token,body:progress});
    await request(`${resumeUrl}/resume`,{token:other.token,status:404});
    await request(`${resumeUrl}/progress`,{method:'PUT',token:other.token,body:progress,status:404});
    await request(`${resumeUrl}/progress`,{method:'PUT',token,status:400,
      body:{...progress,answers:[{...progress.answers[0],user_answer:'C'},{...progress.answers[1],question_id:2147483647}]}});
    await pool.query("UPDATE questions SET question_text='Changed after starting' WHERE question_id=$1",[questionIds[0]]);
    await pool.query("UPDATE user_test_attempts SET start_time=start_time-interval '2 days' WHERE attempt_id=$1",[resumable.attempt_id]);
    const restored=await request(`${resumeUrl}/resume`,{token});
    assert.equal(restored.attempt_id,resumable.attempt_id);
    assert.equal(restored.current_index,1);
    assert.equal(restored.elapsed_seconds,123);
    assert.equal(restored.remaining_seconds,restored.duration_seconds-123);
    assert.equal(restored.questions[0].user_answer,'B');
    assert.equal(restored.questions[0].question_text,'Edited bank question');
    assert.equal(restored.questions[1].user_answer,null);
    for(const q of restored.questions) {
      for(const field of ['correct_answer','explanation','material_transcript']) assert.equal(field in q,false);
      assert(q.choices.every(c=>!('is_correct' in c)));
    }
    assert.equal('score' in restored,false);
    await request(`${resumeUrl}/results`,{token,status:409});
    const finished=await request(`${resumeUrl}/complete`,{method:'PUT',token});
    assert.equal(finished.time_spent,2);
    assert.equal((await request(`${resumeUrl}/resume`,{token})).completed,true);
    await request(`${resumeUrl}/progress`,{method:'PUT',token,body:progress,status:409});
    await pool.query("UPDATE tests SET test_type='full_test',time_limit=1 WHERE test_id=$1",[testId]);
    const timed=await request(`/api/tests/${testId}/attempt`,{method:'POST',token});
    const timedUrl=`/api/tests/attempts/${timed.attempt_id}`;
    const timedResume=await request(`${timedUrl}/resume`,{token});
    assert(timedResume.deadline_at);
    assert(timedResume.remaining_seconds<=60);
    await pool.query("UPDATE user_test_attempts SET deadline_at=CURRENT_TIMESTAMP-interval '1 second' WHERE attempt_id=$1",[timed.attempt_id]);
    await request(`${timedUrl}/progress`,{method:'PUT',token,body:progress,status:409});
    await request(`${timedUrl}/answer`,{method:'PUT',token,status:409,body:{question_id:questionIds[0],user_answer:'A',time_spent:1}});
    const timedResults=await Promise.all([1,2].map(()=>request(`${timedUrl}/resume`,{token})));
    assert(timedResults.every(r=>r.completed));
    assert.equal((await request(`${timedUrl}/results`,{token})).attempt.is_completed,true);
    await pool.query(`INSERT INTO questions(question_text,question_type,part_number,correct_answer,difficulty_level)
      VALUES ('Mixed level one','reading',5,'A',1),('Mixed level five','reading',5,'A',5)`);
    const testService = require('../src/modules/tests/testsService');
    assert.equal((await testService.adminGetAvailability({part_number:5,difficulty_level:3})).available,2);
    const unassigned = await testService.adminGetUnassignedQuestions({part_number:5,difficulty_level:3});
    assert.equal(Number(unassigned.total),2);
    const mixed = await testService.adminAutoGenerateQuestions({test_id:draft.test_id,part_number:5,total_questions:2,difficulty_level:3});
    assert.equal(mixed.assigned,2);
    const retired=await request(`/api/admin/tests/${testId}`,{method:'PUT',token:adminLogin.token,body:{publication_status:'unpublished'}});
    assert.equal(retired.publication_status,'unpublished');
    assert.equal(retired.is_active,false);
    assert(!(await request('/api/tests')).some(t=>t.test_id===testId));
    assert((await request('/api/admin/tests',{token:adminLogin.token})).some(t=>t.test_id===testId && t.publication_status==='unpublished'));
    await request(`/api/tests/${testId}/attempt`,{method:'POST',token,status:404});
    assert.equal((await request(`/api/tests/attempts/${pending.attempt_id}/resume`,{token:other.token})).attempt_id,pending.attempt_id);
    await request(`${url}/results`,{token});
    const countBefore=(await pool.query('SELECT COUNT(*) AS n FROM user_test_attempts WHERE test_id=$1',[testId])).rows[0].n;
    await request(`/api/admin/tests/${testId}`,{method:'DELETE',token:adminLogin.token,status:400});
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM user_test_attempts WHERE test_id=$1',[testId])).rows[0].n,countBefore);
    await request(`/api/admin/tests/${testId}`,{method:'PUT',token,status:403,body:{publication_status:'published'}});
    await request(`/api/admin/tests/${testId}`,{method:'PUT',token:adminLogin.token,status:400,body:{publication_status:'invalid'}});
    await request(`/api/admin/tests/${testId}`,{method:'PUT',token:adminLogin.token,body:{publication_status:'published'}});
    assert((await request('/api/tests')).some(t=>t.test_id===testId));
    console.log('PASS: assessment, resume, expiry, mixed-difficulty assignment, publication states, preserved history, delete protection');
  } finally {
    if (server) await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });

