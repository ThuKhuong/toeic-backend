// Real Python/HTTP + PostgreSQL; fixture writes confined to a fresh schema.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Pool } = require('pg'), { randomUUID } = require('node:crypto');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const testDatabase='toeic_learning_events_test';
if(testDatabase===process.env.DB_NAME)throw Error('Refusing application database');
process.env.LEARNING_EVENTS_ENABLED='0';
const admin=new Pool({host:process.env.DB_HOST||'localhost',port:process.env.DB_PORT||5432,
  user:process.env.DB_USER||'postgres',password:process.env.DB_PASS||'',database:testDatabase});
const schema = 'question_ai_' + randomUUID().replaceAll('-', '');
const pool = new Pool({ ...admin.options, options: `-c search_path=${schema}` });
const baseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

async function main() {
  let created=false;
  try {
    const marker=(await admin.query("SELECT shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker")).rows[0].marker;
    assert.equal(marker,'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT');
    const health = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(health.question_model?.status, 'ready', 'Start the updated Python service first');
    const invalid = await fetch(`${baseUrl}/predict/questions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature_version: 'wrong', questions: [] }) });
    assert.equal(invalid.status, 422);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created=true;
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/toeic_learning_system.sql'), 'utf8'));
    for (const file of ['20261026_question_source.sql', '20261027_source_question_number.sql',
      '20261027_attempt_grading.sql', '20261105_question_predictions.sql']) {
      await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations', file), 'utf8'));
    }
    const dbPath=require.resolve('../db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:pool};
    let offline = false, breakEvidence = false, calls = 0;
    const module = require('../src/modules/ai/questionPrediction');
    // Researchers read the preserved document directly; student results no
    // longer publish individual probabilities or an AI comparison card payload.
    async function researchSummary(attemptId) {
      const saved = (await pool.query('SELECT question_predictions,end_time FROM user_test_attempts WHERE attempt_id=$1', [attemptId])).rows[0];
      const answers = (await pool.query(`SELECT aq.question_id,aq.question_snapshot,ua.user_answer
        FROM attempt_questions aq LEFT JOIN user_answers ua USING(attempt_id,question_id)
        WHERE aq.attempt_id=$1 ORDER BY aq.position`, [attemptId])).rows;
      return module.questionPredictionSummary(saved.question_predictions, answers, saved.end_time);
    }
    const capture = module.createQuestionCapture({ baseUrl, fetchImpl: async (...args) => {
      calls++; if (offline) throw Error('fixture offline'); return fetch(...args);
    } });
    module.captureQuestionPredictions = async (client, attempt, questions) => {
      // No other connection can read an attempt until its prediction is saved.
      assert.equal((await pool.query('SELECT 1 FROM user_test_attempts WHERE attempt_id=$1', [attempt.attempt_id])).rowCount, 0);
      return capture({ query: (sql, params) => breakEvidence && sql.startsWith('SELECT a.user_id')
        ? client.query('SELECT fixture_nonexistent_column') : client.query(sql, params) }, attempt, questions);
    };
    const attempts = require('../src/modules/tests/attemptService');
    const users = (await pool.query(`INSERT INTO "User"(email,password_hash) VALUES
      ('q1@example.invalid','fixture'),('q2@example.invalid','fixture') RETURNING user_id`)).rows.map(r => r.user_id);
    const testId = (await pool.query("INSERT INTO tests(test_name,test_type,is_active) VALUES ('Question AI fixture','part_test',true) RETURNING test_id")).rows[0].test_id;
    const { validateItems, saveBatch } = require('../src/modules/imports/importService');
    const items = validateItems([1, 2].map(number => ({ part_number: 5, source_set: 'Question AI fixture',
      order_in_test: number, question_text: `Question ${number}`, correct_answer: 'A',
      choices: ['A', 'B', 'C', 'D'].map(label => ({ label, text: label })) })), 'reading');
    await saveBatch(items, 'reading'); await pool.query('UPDATE questions SET test_id=$1', [testId]);
    const first = await attempts.startAttempt(users[0], testId);
    assert.equal('question_predictions' in first, false);
    const stored = (await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1', [first.attempt_id])).rows[0].question_predictions;
    assert.equal(stored.status, 'ready'); assert.equal(stored.questions.length, 2);
    assert.equal(stored.questions[0].features.attempt_count, 0);
    assert.ok(stored.questions.every(q => q.evidence.question_answers_from_other_learners === 0));
    assert.equal(JSON.stringify(await attempts.resumeAttempt(first.attempt_id, users[0])).includes('probability'), false);
    await assert.rejects(() => attempts.getAttemptResults(first.attempt_id, users[0]), e => e.status === 409);
    await assert.rejects(() => attempts.getAttemptResults(first.attempt_id, users[1]), e => e.status === 404);
    await attempts.submitAnswer(first.attempt_id, first.questions[0].question_id, 'A', 2, users[0]);
    await attempts.finishAttempt(first.attempt_id, users[0]);
    const result = await attempts.getAttemptResults(first.attempt_id, users[0]);
    assert.equal('question_prediction' in result, false);
    assert.equal('question_predictions' in result.attempt, false);
    const summary = await researchSummary(first.attempt_id);
    assert.equal(summary.status, 'ready', JSON.stringify(summary));
    assert.equal(summary.answered, 1); assert.equal(summary.unanswered, 1);
    assert.equal(summary.questions[0].actual, 1);
    assert.deepEqual(await attempts.getAttemptResults(first.attempt_id, users[0]), result);
    assert.deepEqual(await researchSummary(first.attempt_id), summary);
    assert.equal(calls, 1, 'Reading results never creates new predictions');
    const report = await require('./reportQuestionPredictions').collectReport(pool);
    assert.equal(report.models.length, 1); assert.equal(report.models[0].overall.model.rows, 1);
    assert.equal(report.models[0].learners, 1); assert.equal(report.models[0].unanswered, 1);
    assert.equal(report.models[0].overall.model.roc_auc, null);
    assert.equal('user_id' in report.models[0], false);
    const repeated = await attempts.startAttempt(users[0], testId);
    const repeatSaved = (await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1', [repeated.attempt_id])).rows[0].question_predictions;
    assert.equal(repeatSaved.questions[0].features.attempt_count, 1);
    assert.equal(repeatSaved.questions[0].features.question_count, 0, 'Own repeated answers are not crowd evidence');
    const other = await attempts.startAttempt(users[1], testId);
    const otherSaved = (await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1', [other.attempt_id])).rows[0].question_predictions;
    assert.equal(otherSaved.questions[0].features.attempt_count, 0);
    assert.equal(otherSaved.questions[0].features.question_count, 1, 'Other completed learner supplies question evidence');
    await pool.query("UPDATE questions SET question_text='Edited fixture question' WHERE question_id=$1", [first.questions[0].question_id]);
    const edited = await attempts.startAttempt(users[1], testId);
    const editedDoc = (await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1', [edited.attempt_id])).rows[0].question_predictions;
    assert.equal(editedDoc.questions[0].features.question_count, 0, 'Edited item cannot reuse old version evidence');
    breakEvidence = true;
    const queryFailed = await attempts.startAttempt(users[0], testId);
    assert.equal((await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1', [queryFailed.attempt_id])).rows[0].question_predictions.status, 'failed');
    breakEvidence = false;
    await attempts.finishAttempt(queryFailed.attempt_id, users[0]);
    offline = true;
    const failed = await attempts.startAttempt(users[0], testId);
    const failedDoc = (await pool.query('SELECT question_predictions FROM user_test_attempts WHERE attempt_id=$1', [failed.attempt_id])).rows[0].question_predictions;
    assert.equal(failedDoc.status, 'failed');
    await attempts.submitAnswer(failed.attempt_id, failed.questions[0].question_id, 'B', 2, users[0]);
    await attempts.finishAttempt(failed.attempt_id, users[0]);
    assert.equal('question_prediction' in await attempts.getAttemptResults(failed.attempt_id, users[0]), false);
    assert.equal((await researchSummary(failed.attempt_id)).status, 'failed');
    // Explicit research capture replaces the historical GET-results side effect.
    await require('../src/modules/ai/attemptPrediction').predictAttempt(first.attempt_id, users[0]);
    const server = require('../server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/tests/attempts/${first.attempt_id}/results`;
      const token = require('jsonwebtoken').sign({ user_id: users[0], role: 'STUDENT' }, process.env.JWT_SECRET || 'secret123');
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json(); assert.equal(response.status, 200);
      assert.equal('question_prediction' in body, false);
      assert.equal('question_predictions' in body.attempt, false);
      assert.equal(body.ai_prediction.status, 'ready');
      const wrongToken = require('jsonwebtoken').sign({ user_id: users[1], role: 'STUDENT' }, process.env.JWT_SECRET || 'secret123');
      assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${wrongToken}` } })).status, 404);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    console.log('PASS: real tag-free v3 batch inference, hash/contract, pre-answer persistence, hidden start/resume, ownership, frozen features, blanks, other-user catalog, question edits, SQL savepoint recovery, offline exam completion, stable results and HTTP coexistence with v2.');
  } finally {
    await pool.end(); assert.match(schema, /^question_ai_[a-f0-9]{32}$/);
    if(created)await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
