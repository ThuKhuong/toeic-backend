const test = require('node:test'), assert = require('node:assert/strict');
const { createQuestionCapture, questionPredictionSummary } = require('../src/modules/ai/questionPrediction');
const { metrics } = require('./reportQuestionPredictions');
const manifest = { artifact_sha256: 'a'.repeat(64) };
const attempt = { attempt_id: 10, user_id: 1, start_time: '2026-11-05T01:00:00Z', question_predictions: null };
const questions = [1, 2].map(question_id => ({ question_id, part_number: 5,
  question_text: `Q${question_id}`, correct_answer: 'A', choices: [] }));
function clientFixture() {
  const statements = []; let saved;
  return { statements, get saved() { return saved; }, async query(sql, params) {
    statements.push(sql);
    if (sql.startsWith('SELECT a.user_id')) return { rows: [] };
    if (sql.startsWith('UPDATE user_test_attempts')) saved = JSON.parse(params[1]);
    return { rows: [] };
  } };
}
function response(body) {
  return { ok: true, json: async () => ({ model: 'lightgbm_question_catalog_v3',
    mode: 'app_observation_only', feature_version: 'app_question_catalog_v1',
    artifact_sha256: manifest.artifact_sha256,
    questions: body.questions.map(q => ({ question_id: q.question_id, probability: .7 })) }) };
}

test('request has only app features; frozen baseline and model response are persisted', async () => {
  const client = clientFixture();
  await createQuestionCapture({ manifestLoader: () => manifest, fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/predict/questions'));
    const body = JSON.parse(options.body);
    assert.equal('user_id' in body, false);
    assert.deepEqual(Object.keys(body.questions[0].features), ['part', 'user_acc', 'attempt_count',
      'user_part_acc', 'user_part_count', 'question_acc', 'question_count', 'question_unseen']);
    assert.equal(body.questions[0].features.question_count, 0);
    return response(body);
  } })(client, attempt, questions);
  assert.equal(client.saved.status, 'ready');
  assert.equal(client.saved.as_of, attempt.start_time);
  assert.equal(client.saved.questions[0].baseline_probability, .5);
  assert.match(client.saved.questions[0].question_fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(client.statements.at(-2).includes('clock_timestamp()'));
});

test('offline, wrong hash, duplicate and foreign question results fail without aborting exam transaction', async () => {
  for (const type of ['offline', 'hash', 'duplicate', 'foreign', 'nan']) {
    const client = clientFixture();
    await createQuestionCapture({ manifestLoader: () => manifest, fetchImpl: async (_, options) => {
      if (type === 'offline') throw Error('offline');
      const result = response(JSON.parse(options.body)), body = await result.json();
      if (type === 'hash') body.artifact_sha256 = 'b'.repeat(64);
      if (type === 'duplicate') body.questions[1].question_id = body.questions[0].question_id;
      if (type === 'foreign') body.questions[1].question_id = 987;
      if (type === 'nan') body.questions[0].probability = NaN;
      return { ok: true, json: async () => body };
    } })(client, attempt, questions);
    assert.equal(client.saved.status, 'failed', type);
    assert.ok(client.statements.includes('ROLLBACK TO SAVEPOINT question_observation'));
    assert.equal(client.statements.at(-1), 'RELEASE SAVEPOINT question_observation');
  }
});

test('older databases and disabled capture do not call Python', async () => {
  const client = clientFixture(), noCall = () => { throw Error('must not be called'); };
  const { question_predictions, ...legacy } = attempt;
  await createQuestionCapture({ fetchImpl: noCall })(client, legacy, questions);
  assert.equal(client.statements.length, 0);
  await createQuestionCapture({ enabled: () => false, fetchImpl: noCall })(client, attempt, questions);
  assert.equal(client.saved.status, 'disabled');
});

test('outcome comparison excludes blanks and never invents a prediction after submission', () => {
  const saved = { status: 'ready', mode: 'app_observation_only', version: 'app_question_catalog_v1',
    recorded_at: '2026-11-05T01:00:01Z', questions: questions.map(q => ({ question_id: q.question_id,
      part: 5, probability: .7, baseline_probability: .5, evidence: {} })) };
  const answers = questions.map(q => ({ question_id: q.question_id, question_snapshot: q,
    user_answer: q.question_id === 1 ? 'A' : null }));
  const summary = questionPredictionSummary(saved, answers, '2026-11-05T01:01:00Z');
  assert.equal(summary.answered, 1); assert.equal(summary.unanswered, 1);
  assert.equal(summary.correct_rate, 1);
  assert.ok(Math.abs(summary.metrics.model.log_loss + Math.log(.7)) < 1e-12);
  assert.equal(summary.questions[1].actual, null);
  assert.equal('features' in summary.questions[0], false);
  assert.equal(questionPredictionSummary(null, answers).status, 'not_recorded');
  assert.equal(questionPredictionSummary(saved, answers, '2026-11-05T01:00:00Z').status, 'invalid_timing');
});

test('aggregate metrics handle ranking ties, one class and empty evidence', () => {
  const rows = [{ probability: .5, actual: 0 }, { probability: .5, actual: 1 }];
  assert.equal(metrics(rows, 'probability').roc_auc, .5);
  assert.equal(metrics([{ probability: .2, actual: 0 }, { probability: .8, actual: 1 }], 'probability').roc_auc, 1);
  assert.equal(metrics(rows.slice(0, 1), 'probability').roc_auc, null);
  assert.equal(metrics([], 'probability').log_loss, null);
});

test('identical unseen question inputs are explicitly assessed as history/Part only without changing saved predictions', () => {
  const features = { part: 5, user_acc: 27/46, attempt_count: 44, user_part_acc: 20/33,
    user_part_count: 31, question_acc: .5, question_count: 0, question_unseen: 1 };
  const saved = { status: 'ready', recorded_at: '2026-11-05T01:00:01Z',
    questions: questions.map(q => ({ question_id: q.question_id, part: 5, features: { ...features },
      probability: .3713481846553884, baseline_probability: 20/33 })) };
  const original = JSON.stringify(saved);
  const answers = questions.map(q => ({ question_id: q.question_id, question_snapshot: q, user_answer: 'A' }));
  const summary = questionPredictionSummary(saved, answers, '2026-11-05T01:01:00Z');
  assert.equal(summary.input_assessment.scope, 'history_and_part_only');
  assert.equal(summary.input_assessment.identical_inputs, true);
  assert.equal(summary.input_assessment.distinct_input_vectors, 1);
  assert.equal(summary.input_assessment.questions_without_catalog_evidence, 2);
  assert.equal(summary.questions[0].probability, saved.questions[0].probability);
  assert.equal(summary.questions[0].has_question_evidence, false);
  assert.equal(JSON.stringify(saved), original);
  const known = structuredClone(saved); known.questions[0].features.question_count = 1;
  known.questions[0].features.question_unseen = 0;
  const knownSummary = questionPredictionSummary(known, answers, '2026-11-05T01:01:00Z');
  assert.equal(knownSummary.input_assessment.scope, 'question_catalog');
  assert.equal(knownSummary.input_assessment.identical_inputs, false);
  const evidenced = structuredClone(known);
  evidenced.questions[0].evidence = { question_answers_from_other_learners: 1 };
  assert.equal(questionPredictionSummary(evidenced, answers, '2026-11-05T01:01:00Z').questions[0].has_question_evidence, true);
  delete known.questions[0].features;
  assert.equal(questionPredictionSummary(known, answers, '2026-11-05T01:01:00Z').input_assessment.status, 'unknown');
});
