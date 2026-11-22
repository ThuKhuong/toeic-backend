// Observe the tag-free Riiid ablation on app questions before any answer is accepted.
// This module never changes grading, recommends a test, or uses Riiid question IDs.
const fs = require('node:fs');
const path = require('node:path');
const { buildAppQuestionPreview } = require('./appQuestionFeatures');
const FEATURE_VERSION = 'app_question_catalog_v1';
const MODEL = 'lightgbm_question_catalog_v3';
const COLUMNS = ['part', 'user_acc', 'attempt_count', 'user_part_acc', 'user_part_count',
  'question_acc', 'question_count', 'question_unseen'];

function loadManifest() {
  const file = path.resolve(__dirname, '../../../../toeic-ai/models/v3_app_shadow/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.model !== MODEL || manifest.feature_version !== FEATURE_VERSION ||
      manifest.mode !== 'app_observation_only' || !/^[a-f0-9]{64}$/.test(manifest.artifact_sha256) ||
      JSON.stringify(manifest.feature_columns) !== JSON.stringify(COLUMNS)) throw Error('Invalid observation manifest');
  return manifest;
}

function createQuestionCapture({ fetchImpl = fetch, baseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
  timeoutMs = 3000, manifestLoader = loadManifest, enabled = () => process.env.AI_QUESTION_SHADOW_ENABLED !== '0' } = {}) {
  // Called inside startAttempt's transaction, before COMMIT exposes the attempt.
  // A SAVEPOINT isolates AI failure from the exam transaction.
  return async function capture(client, attempt, questions) {
    if (!Object.hasOwn(attempt, 'question_predictions')) return; // Older DB: migration pending.
    const initial = { version: FEATURE_VERSION, mode: 'app_observation_only', as_of: attempt.start_time };
    if (!enabled()) {
      await client.query('UPDATE user_test_attempts SET question_predictions=$2::jsonb WHERE attempt_id=$1',
        [attempt.attempt_id, JSON.stringify({ ...initial, status: 'disabled' })]);
      return;
    }
    await client.query('SAVEPOINT question_observation');
    try {
      const manifest = manifestLoader();
      if (!questions.length || questions.length > 200) throw Error('Unsupported batch size');
      const evidence = (await client.query(`SELECT a.user_id,a.is_completed,a.end_time,
        aq.question_id,aq.question_snapshot,ua.user_answer
        FROM user_test_attempts a JOIN attempt_questions aq USING(attempt_id)
        JOIN user_answers ua USING(attempt_id,question_id)
        WHERE a.is_completed=true AND a.end_time<$1 AND a.attempt_id<>$2
        AND ua.user_answer IN ('A','B','C','D')
        AND aq.question_snapshot->>'correct_answer' IN ('A','B','C','D')
        AND aq.question_snapshot->>'part_number' IN ('1','2','3','4','5','6','7')`,
      [attempt.start_time, attempt.attempt_id])).rows;
      const inputs = questions.map(question => {
        const preview = buildAppQuestionPreview({ question, userId: attempt.user_id, evidence, asOf: attempt.start_time });
        return { question_id: question.question_id, part: preview.part,
          question_fingerprint: preview.question_fingerprint,
          features: Object.fromEntries(COLUMNS.map(key => [key, preview.features[key]])),
          evidence: preview.evidence, baseline_probability: preview.features.user_part_acc };
      });
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/predict/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ feature_version: FEATURE_VERSION,
          questions: inputs.map(({ question_id, features }) => ({ question_id, features })) }),
      });
      if (!response.ok) throw Error('Question inference failed');
      const result = await response.json();
      if (result.model !== MODEL || result.feature_version !== FEATURE_VERSION || result.mode !== initial.mode ||
          result.artifact_sha256 !== manifest.artifact_sha256 || !Array.isArray(result.questions) ||
          result.questions.length !== inputs.length) throw Error('Question response contract mismatch');
      const probabilities = new Map();
      for (const row of result.questions) {
        if (!Number.isSafeInteger(row.question_id) || probabilities.has(row.question_id) ||
            typeof row.probability !== 'number' || !Number.isFinite(row.probability) ||
            row.probability < 0 || row.probability > 1) throw Error('Invalid question probability');
        probabilities.set(row.question_id, row.probability);
      }
      if (inputs.some(row => !probabilities.has(row.question_id))) throw Error('Question set mismatch');
      const saved = { ...initial, status: 'ready', model: MODEL, artifact_sha256: manifest.artifact_sha256,
        questions: inputs.map(row => ({ ...row, probability: probabilities.get(row.question_id) })) };
      await client.query(`UPDATE user_test_attempts SET question_predictions=
        jsonb_set($2::jsonb,'{recorded_at}',to_jsonb(clock_timestamp())) WHERE attempt_id=$1`,
      [attempt.attempt_id, JSON.stringify(saved)]);
      await client.query('RELEASE SAVEPOINT question_observation');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT question_observation');
      await client.query('UPDATE user_test_attempts SET question_predictions=$2::jsonb WHERE attempt_id=$1',
        [attempt.attempt_id, JSON.stringify({ ...initial, status: 'failed' })]);
      await client.query('RELEASE SAVEPOINT question_observation');
    }
  };
}

function assessQuestionInputs(questions) {
  // Older records without feature snapshots cannot establish input granularity.
  if (!questions.every(row => row.features && COLUMNS.every(key => Number.isFinite(row.features[key])))) {
    return { status: 'unknown' };
  }
  const withCatalog = questions.filter(row => row.features.question_count > 0).length;
  const vectors = new Set(questions.map(row => JSON.stringify(COLUMNS.map(key => row.features[key]))));
  return { status: 'known', scope: withCatalog ? 'question_catalog' : 'history_and_part_only',
    questions_with_catalog_evidence: withCatalog, questions_without_catalog_evidence: questions.length - withCatalog,
    distinct_input_vectors: vectors.size, identical_inputs: vectors.size === 1 };
}

function questionPredictionSummary(saved, answers, completedAt) {
  if (!saved) return { status: 'not_recorded', mode: 'app_observation_only' };
  const common = { status: saved.status, mode: saved.mode, as_of: saved.as_of, recorded_at: saved.recorded_at,
    model: saved.model, feature_version: saved.version };
  if (saved.status !== 'ready') return common;
  if (!Array.isArray(saved.questions) || !saved.questions.length ||
      saved.questions.some(row => !row || typeof row !== 'object') ||
      new Set(saved.questions.map(row => row.question_id)).size !== saved.questions.length ||
      saved.questions.some(row => !Number.isSafeInteger(row.question_id) ||
        ![row.probability, row.baseline_probability].every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1))) {
    return { ...common, status: 'invalid_data' };
  }
  // Legacy/corrupt records that were stored after completion are never evidence.
  if (!completedAt || !saved.recorded_at || !Number.isFinite(Date.parse(saved.recorded_at)) ||
      !Number.isFinite(new Date(completedAt).getTime()) ||
      Date.parse(saved.recorded_at) > new Date(completedAt).getTime()) {
    return { ...common, status: 'invalid_timing' };
  }
  const byId = new Map(answers.map(row => [Number(row.question_id), row]));
  const questions = saved.questions.map(prediction => {
    const answer = byId.get(Number(prediction.question_id));
    const selected = answer?.user_answer;
    const snapshot = answer?.question_snapshot;
    const actual = selected && snapshot ? Number(selected === snapshot.correct_answer) : null;
    return { question_id: prediction.question_id, part: prediction.part,
      has_question_evidence: prediction.features?.question_count > 0 &&
        prediction.evidence?.question_answers_from_other_learners > 0,
      has_part_history: prediction.features?.user_part_count > 0,
      probability: prediction.probability, baseline_probability: prediction.baseline_probability,
      evidence: prediction.evidence, actual,
      answer_status: actual === null ? 'unanswered' : actual ? 'correct' : 'incorrect' };
  });
  const measured = questions.filter(row => row.actual !== null);
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const loss = (p, y) => { const bounded = Math.max(1e-15, Math.min(1 - 1e-15, p));
    return -(y * Math.log(bounded) + (1 - y) * Math.log(1 - bounded)); };
  const metrics = key => ({
    log_loss: mean(measured.map(row => loss(row[key], row.actual))),
    brier_score: mean(measured.map(row => (row[key] - row.actual) ** 2)),
    mean_probability: mean(measured.map(row => row[key])),
  });
  return { ...common, artifact_sha256: saved.artifact_sha256, labels_known_at: completedAt,
    input_assessment: assessQuestionInputs(saved.questions),
    answered: measured.length, unanswered: questions.length - measured.length,
    correct_rate: mean(measured.map(row => row.actual)), metrics: { model: metrics('probability'), baseline: metrics('baseline_probability') },
    questions };
}

module.exports = { createQuestionCapture, captureQuestionPredictions: createQuestionCapture(), questionPredictionSummary };
