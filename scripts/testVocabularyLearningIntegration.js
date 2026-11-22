// All test data lives in a unique schema, removed in finally. No app data is modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function main() {
  const config = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : {
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'toeic',
  };
  const schema = 'vocabulary_check_' + randomUUID().replaceAll('-', '');
  const admin = new Pool(config);
  const pool = new Pool({ ...config, options: `-c search_path=${schema}` });
  let server;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/toeic_learning_system.sql'), 'utf8'));
    const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/20261103_vocabulary_learning.sql'), 'utf8');
    await pool.query(migration);
    await pool.query(migration);
    const personalMigration = fs.readFileSync(path.join(__dirname, '../database/migrations/20261103_personal_vocabulary.sql'), 'utf8');
    await pool.query(personalMigration);
    await pool.query(personalMigration);
    const dbPath = require.resolve('../db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
    const app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/student/vocabulary`;
    const { rows: users } = await pool.query(`INSERT INTO "User" (email,password_hash)
      VALUES ('vocab1@example.invalid','test'),('vocab2@example.invalid','test') RETURNING user_id`);
    const tokens = users.map(user => jwt.sign({ user_id: user.user_id, role: 'STUDENT' }, process.env.JWT_SECRET || 'secret123'));
    async function request(url, { method = 'GET', body, token = tokens[0], status = 200 } = {}) {
      const target = url.startsWith('/api/') ? base.split('/api/')[0] + url : base + url;
      const response = await fetch(target, { method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
      assert.equal(response.status, status, `${method} ${url}: ${JSON.stringify(result)}`);
      return result;
    }
    await request('/learning', { token: null, status: 401 });
    await request('/', { token: null, status: 401 });
    assert.deepEqual((await request('/')).data, []);
    assert.deepEqual(await request('/categories/list'), []);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      await request('/api/admin/vocabulary' + (method === 'PUT' || method === 'DELETE' ? '/1' : ''), { method, status: 404 });
    }
    await request('/api/admin/vocabulary/import', { method: 'POST', body: { items: [{ word: 'disabled' }] }, status: 404 });
    const legacy = (await pool.query("INSERT INTO vocabulary(word,meaning_vi) VALUES ('legacy-admin-word','legacy-meaning') RETURNING vocab_id")).rows[0];
    assert.deepEqual((await request('/')).data, []);
    const topic = await request('/topics', { method: 'POST', body: { name: 'Integration topic', owner_user_id: users[1].user_id } });
    const topicId = topic.topic_id;
    await request('/topics', { method: 'POST', body: { name: 'integration TOPIC' }, status: 409 });
    const otherTopic = await request('/topics', { method: 'POST', token: tokens[1], body: { name: 'Integration topic' } });
    assert.notEqual(topicId, otherTopic.topic_id);
    await request(`/topics/${topicId}`, { method: 'PUT', token: tokens[1], body: { name: 'Cannot edit' }, status: 404 });
    await request(`/topics/${topicId}`, { method: 'DELETE', token: tokens[1], status: 404 });
    await request('/', { method: 'POST', body: { word: 'invalid', meaning_vi: 'test', topic_id: otherTopic.topic_id }, status: 404 });
    await request('/', { method: 'POST', body: { word: '  ', meaning_vi: 'test' }, status: 400 });
    const words = [];
    for (let i = 1; i <= 4; i++) {
      words.push(await request('/', { method: 'POST', body: { word: 'word-' + i, meaning_vi: 'meaning-' + i,
        topic_id: i <= 3 ? topicId : null, owner_user_id: users[1].user_id } }));
    }
    assert.equal(words[0].owner_user_id, users[0].user_id);
    assert.equal((await request('/')).data.length, 4);
    assert.equal((await request('/', { token: tokens[1] })).data.length, 0);
    for (const vocabId of [words[0].vocab_id, legacy.vocab_id]) {
      await request(`/${vocabId}`, { method: 'PUT', token: tokens[1], body: { word: 'blocked', meaning_vi: 'blocked' }, status: 404 });
      await request(`/${vocabId}`, { method: 'DELETE', token: tokens[1], status: 404 });
      await request(`/${vocabId}/saved`, { method: 'PUT', token: tokens[1], body: { saved: true }, status: 404 });
    }
    const otherWord = await request('/', { method: 'POST', token: tokens[1], body: { word: 'private-other', meaning_vi: 'private-other-meaning', topic_id: otherTopic.topic_id } });
    await request('/quiz/sessions', { method: 'POST', token: tokens[1], body: {}, status: 422 });
    const foreignStudy = await request('/study/sessions', { method: 'POST', body: { vocab_ids: [otherWord.vocab_id, legacy.vocab_id] } });
    assert.equal(foreignStudy.session_id, null);
    assert.equal((await request('/quiz/sessions', { method: 'POST', body: { vocab_ids: [otherWord.vocab_id] } })).session_id, null);
    const unassignedQuiz = await request('/quiz/sessions', { method: 'POST', body: { unassigned: true } });
    assert.deepEqual(unassignedQuiz.questions.map(q => q.vocab_id), [words[3].vocab_id]);
    assert.ok(unassignedQuiz.questions.every(q => q.choices.every(choice => !['private-other-meaning', 'legacy-meaning'].includes(choice.text))));
    const extraTopic = await request('/topics', { method: 'POST', body: { name: 'Temporary' } });
    const extraWord = await request('/', { method: 'POST', body: { word: 'scratch', meaning_vi: 'scratch meaning', topic_id: extraTopic.topic_id } });
    await request(`/topics/${extraTopic.topic_id}`, { method: 'PUT', body: { name: 'Renamed' } });
    await request(`/topics/${extraTopic.topic_id}`, { method: 'DELETE' });
    assert.equal((await request('/')).data.find(w => w.vocab_id === extraWord.vocab_id).topic_id, null);
    await request(`/${extraWord.vocab_id}`, { method: 'PUT', body: { word: 'updated', meaning_vi: 'updated meaning' } });
    await request(`/${extraWord.vocab_id}`, { method: 'DELETE' });
    assert.equal((await request('/')).data.length, 4);

    await request(`/${words[0].vocab_id}/saved`, { method: 'PUT', body: { saved: 'yes' }, status: 400 });
    await request('/999999/saved', { method: 'PUT', body: { saved: true }, status: 404 });
    for (const word of words) await request(`/${word.vocab_id}/saved`, { method: 'PUT', body: { saved: true, user_id: users[1].user_id } });
    assert.equal((await request('/learning', { token: tokens[1] })).length, 0);
    const starts = await Promise.all([1, 2].map(() => request('/study/sessions', {
      method: 'POST', body: { scope: 'saved', topic_id: topicId, count: 2 },
    })));
    let study = starts[0];
    assert.equal(study.session_id, starts[1].session_id);
    assert.equal(study.words.length, 2);
    const cardUrl = `/study/sessions/${study.session_id}/card`;
    const firstId = study.words[0].vocab_id, secondId = study.words[1].vocab_id;
    await request(cardUrl, { method: 'PUT', token: tokens[1], body: { vocab_id: firstId, known: true }, status: 404 });
    await request(cardUrl, { method: 'PUT', body: { vocab_id: secondId, known: true }, status: 409 });
    const ratings = await Promise.all([1, 2].map(() => request(cardUrl, { method: 'PUT', body: { vocab_id: firstId, known: true } })));
    assert.equal(ratings[0].current_index, 1);
    assert.equal(ratings[1].known_count, 1);
    study = await request('/study/sessions', { method: 'POST', body: { scope: 'saved', topic_id: topicId } });
    assert.equal(study.session_id, starts[0].session_id);
    assert.equal(study.current_index, 1);
    study = await request(cardUrl, { method: 'PUT', body: { vocab_id: secondId, known: false } });
    assert.equal(study.completed, true);
    const progress = await request('/learning');
    assert.equal(progress.find(row => row.vocab_id === firstId).status, 'known');
    assert.equal(progress.find(row => row.vocab_id === secondId).needs_review, true);
    assert.ok(progress.find(row => row.vocab_id === secondId).learned_at);
    await request(`/${secondId}/saved`, { method: 'PUT', body: { saved: false } });
    assert.equal((await request('/learning')).find(row => row.vocab_id === secondId).needs_review, true);
    const savedQuiz = await request('/quiz/sessions', { method: 'POST', body: { scope: 'saved', topic_id: topicId } });
    assert.ok(savedQuiz.questions.every(question => question.vocab_id !== secondId && words.find(word => word.vocab_id === question.vocab_id).topic_id === topicId));
    const quiz = await request('/quiz/sessions', { method: 'POST', body: { vocab_ids: words.slice(0, 3).map(word => word.vocab_id) } });
    assert.equal(quiz.questions.length, 3);
    assert.equal('correct_label' in quiz.questions[0], false);
    const snapshot = (await pool.query('SELECT questions FROM vocabulary_quiz_sessions WHERE session_id=$1', [quiz.session_id])).rows[0].questions;
    // Editing source vocabulary must not change the answer to an existing quiz.
    await pool.query("UPDATE vocabulary SET meaning_vi='changed' WHERE vocab_id=$1", [snapshot[0].vocab_id]);
    const finishUrl = `/quiz/sessions/${quiz.session_id}/finish`;
    await request(finishUrl, { method: 'POST', token: tokens[1], body: { answers: [] }, status: 404 });
    await request(finishUrl, { method: 'POST', body: { answers: [{ vocab_id: words[3].vocab_id, selected_label: 'A' }] }, status: 400 });
    await request(finishUrl, { method: 'POST', body: { answers: [{ vocab_id: snapshot[0].vocab_id, selected_label: 'Z' }] }, status: 400 });
    const answers = [
      { vocab_id: snapshot[0].vocab_id, selected_label: snapshot[0].correct_label },
      { vocab_id: snapshot[1].vocab_id, selected_label: snapshot[1].choices.find(choice => choice.label !== snapshot[1].correct_label).label },
    ];
    const results = await Promise.all([1, 2].map(() => request(finishUrl, { method: 'POST', body: { answers } })));
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].correct, 1);
    assert.equal(results[0].details[2].selected_label, null);
    assert.equal((await request('/learning')).find(row => row.vocab_id === snapshot[1].vocab_id).wrong_count, 1);
    const review = await request('/study/sessions', { method: 'POST', body: { scope: 'review' } });
    assert.equal(review.words.length, 2);
    const retry = await request('/quiz/sessions', { method: 'POST', body: { vocab_ids: review.words.map(word => word.vocab_id) } });
    assert.equal(retry.questions.length, 2);
    // Admin deletions during study/quiz remain recoverable and preserve grading snapshots.
    await pool.query('DELETE FROM vocabulary WHERE vocab_id=ANY($1::integer[])', [review.words.map(word => word.vocab_id)]);
    const afterDelete = await request('/study/sessions', { method: 'POST', body: { scope: 'review' } });
    assert.equal(afterDelete.session_id, null);
    const deletedResult = await request(`/quiz/sessions/${retry.session_id}/finish`, { method: 'POST', body: { answers: [] } });
    assert.equal(deletedResult.total, 2);
    assert.equal((await request('/learning', { token: tokens[1] })).length, 0);
    console.log('PASS: personal word/topic CRUD, disabled admin routes, legacy/other-user isolation, personal quiz choices, scoped quizzes, concurrent resume/rating, server grading, blanks, idempotency, and deleted words.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    if (!/^vocabulary_check_[a-f0-9]+$/.test(schema)) throw new Error('Invalid test schema');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
