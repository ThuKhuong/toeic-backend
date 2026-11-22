// Prospective evaluation only. Source databases are opened READ ONLY; no inference/backfill.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { compare } = require('./lightgbmValidationMetrics');
const { fingerprint, buildAppQuestionPreview } = require('../src/modules/ai/appQuestionFeatures');
const root = path.resolve(__dirname, '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const time = value => value == null ? NaN : new Date(value).getTime();
const probability = p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
const labels = q => Number(q.part_number) === 2 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
const validAnswer = r => r.question_snapshot && Number.isInteger(Number(r.question_snapshot.part_number)) &&
  Number(r.question_snapshot.part_number) >= 1 && Number(r.question_snapshot.part_number) <= 7 &&
  labels(r.question_snapshot).includes(r.user_answer) && labels(r.question_snapshot).includes(r.question_snapshot.correct_answer);
const columns = ['part', 'user_acc', 'attempt_count', 'user_part_acc', 'user_part_count', 'question_acc', 'question_count', 'question_unseen'];
const increment = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };
const safeFingerprint = q => { try { return fingerprint(q); } catch { return null; } };
const replay = input => { try { return buildAppQuestionPreview(input); } catch { return null; } };

const PROTOCOL_VERSION = 'lightgbm_app_prospective_audit_v2';
const DEV_DATABASE = 'toeic_learning_events_dev';
const DEV_MARKER = 'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT';

function buildReport(attempts, inventory, hashes, cutoff = Date.now(), options = {}) {
  const targetAfter = options.targetAfter == null ? -Infinity : time(options.targetAfter);
  if (!Number.isFinite(cutoff) || (options.targetAfter != null && (!Number.isFinite(targetAfter) || targetAfter > cutoff))) throw Error('Invalid evaluation window');
  const completed = attempts.filter(a => a.is_completed && Number.isFinite(time(a.start_time)) &&
    Number.isFinite(time(a.end_time)) && time(a.start_time) < time(a.end_time) && time(a.end_time) <= cutoff &&
    Array.isArray(a.answers) && a.answers.every(r => r && typeof r === 'object'));
  // Retain pre-window history for exact replay; restrict only scored target attempts.
  const inWindow = a => time(a.start_time) >= targetAfter;
  const evidence = completed.flatMap(a => a.answers.map(r => ({ ...r, user_id: a.user_id, is_completed: true, end_time: a.end_time })));
  // Historical frozen predictions saw only their original database. New canonical
  // predictions see all canonical history. Never rewrite saved vectors after a merge.
  const captureHistory = a => options.respectCaptureOrigin && a.capture_origin
    ? completed.filter(h => h.capture_origin === a.capture_origin) : completed;
  const captureEvidence = a => captureHistory(a).flatMap(h => h.answers.map(r => ({ ...r,user_id:h.user_id,is_completed:true,end_time:h.end_time })));
  const v3 = [], v2 = [], excluded = { v2: {}, v3: {} }, statuses = { v2: {}, v3: {} };
  const v2Anchors = [];
  for (const a of completed) {
    const saved = a.question_predictions;
    increment(statuses.v3, saved?.status || 'not_recorded');
    if (saved?.status === 'ready' && inWindow(a)) {
      const stamp = time(saved.recorded_at);
      if (saved.model !== 'lightgbm_question_catalog_v3' || saved.artifact_sha256 !== hashes.v3 || saved.version !== 'app_question_catalog_v1' || saved.mode !== 'app_observation_only') increment(excluded.v3, 'artifact_or_contract_mismatch');
      else if (!Number.isFinite(stamp) || !Number.isFinite(time(saved.as_of)) || stamp < time(a.start_time) || stamp > time(a.end_time) || Math.abs(time(saved.as_of) - time(a.start_time)) > 1) increment(excluded.v3, 'invalid_pre_answer_timing');
      else if (!Array.isArray(saved.questions) || !saved.questions.length || saved.questions.some(q => !q || !Number.isSafeInteger(q.question_id)) || new Set(saved.questions.map(q => q.question_id)).size !== saved.questions.length || saved.questions.length !== a.answers.length || new Set(a.answers.map(r => Number(r.question_id))).size !== a.answers.length) increment(excluded.v3, 'invalid_question_set');
      else for (const q of saved.questions) {
        const r = a.answers.find(r => Number(r.question_id) === q.question_id);
        if (!r?.question_snapshot || Number(r.question_snapshot.question_id) !== q.question_id || Number(r.question_snapshot.part_number) !== q.part || !safeFingerprint(r.question_snapshot) || safeFingerprint(r.question_snapshot) !== q.question_fingerprint) { increment(excluded.v3, 'question_version_or_part_mismatch'); continue; }
        if (!validAnswer(r)) { increment(excluded.v3, r.user_answer == null ? 'blank' : 'invalid_answer_or_key'); continue; }
        // answered_at is mutable on progress saves. Only a known initial server revision proves ordering.
        const first = time(r.first_answer_at);
        if (!Number.isFinite(first) || first < time(a.start_time) || first > time(a.end_time)) { increment(excluded.v3, 'missing_or_invalid_first_answer_evidence'); continue; }
        if (stamp >= first) { increment(excluded.v3, 'prediction_after_answer'); continue; }
        const preview = replay({ question: r.question_snapshot, userId: a.user_id, evidence: captureEvidence(a), asOf: a.start_time });
        if (!preview) { increment(excluded.v3, 'unreplayable_history_or_snapshot'); continue; }
        if (!probability(q.probability) || !probability(q.baseline_probability) || columns.some(k => typeof q.features?.[k] !== 'number' || !Number.isFinite(q.features[k]) || Math.abs(q.features[k] - preview.features[k]) > 1e-10) || Math.abs(q.baseline_probability - preview.features.user_part_acc) > 1e-10) { increment(excluded.v3, 'frozen_features_or_baseline_mismatch'); continue; }
        v3.push({ user: a.user_id, attempt: a.attempt_id, question: r.question_id, part: q.part, probability: q.probability, baseline_probability: q.baseline_probability,
          actual: Number(r.user_answer === r.question_snapshot.correct_answer), repeat: preview.features.user_question_count > 0, catalog: preview.features.question_count > 0,
          cold_user: preview.features.attempt_count === 0, cold_part: preview.features.user_part_count === 0 });
      }
    }
    const prediction = a.ai_prediction;
    increment(statuses.v2, prediction?.status || 'not_recorded');
    if (prediction?.parts != null && !Array.isArray(prediction.parts)) { increment(excluded.v2, 'invalid_prediction_parts'); continue; }
    for (const p of prediction?.parts || []) {
      if (p?.status !== 'ready') continue;
      const input = Array.isArray(prediction.inputs) ? prediction.inputs.find(i => i?.part === p.part) : null;
      const recorded = time(prediction.completed_at);
      if (prediction.version !== 'attempt_lightgbm_v1' || p.feature_version !== 'group_history_v1' || p.time_feature_missing !== true ||
          p.model !== 'lightgbm_v2' || p.artifact_sha256 !== hashes.v2 || !probability(p.probability) || !input) { increment(excluded.v2, 'artifact_or_input_mismatch'); continue; }
      if (!Number.isFinite(recorded) || recorded > cutoff || recorded < time(a.end_time) || !Number.isFinite(time(prediction.as_of)) || Math.abs(time(prediction.as_of) - time(a.end_time)) > 1) { increment(excluded.v2, 'invalid_anchor_timing'); continue; }
      const history = captureHistory(a).filter(h => h.user_id === a.user_id && (time(h.end_time) < time(a.end_time) || (time(h.end_time) === time(a.end_time) && h.attempt_id <= a.attempt_id))).flatMap(h => h.answers).filter(validAnswer);
      const partHistory = history.filter(r => Number(r.question_snapshot.part_number) === p.part);
      const correct = rows => rows.filter(r => r.user_answer === r.question_snapshot.correct_answer).length;
      if (input.answered_count !== history.length || input.correct_count !== correct(history) || input.part_answered_count !== partHistory.length || input.part_correct_count !== correct(partHistory) || !partHistory.length) { increment(excluded.v2, 'history_cutoff_mismatch'); continue; }
      // Never score the donor attempt: its answers were already included in model input.
      // Select the next Part presentation by metadata, never by whether its outcomes are usable/favourable.
      const target = completed.filter(t => t.user_id === a.user_id && t.attempt_id !== a.attempt_id && time(t.start_time) > time(a.end_time) && t.answers.some(r => Number(r.question_snapshot?.part_number) === p.part)).sort((x, y) => time(x.start_time) - time(y.start_time) || x.attempt_id - y.attempt_id)[0];
      if (!target) { increment(excluded.v2, 'no_next_completed_part_attempt'); continue; }
      if (!inWindow(target)) continue;
      if (recorded >= time(target.start_time)) { increment(excluded.v2, 'prediction_saved_after_next_attempt_started'); continue; }
      v2Anchors.push({ a, target, p, baseline: (input.part_correct_count + 1) / (input.part_answered_count + 2), recorded });
    }
  }
  // A target response is scored once even if older donors point to the same next Part attempt.
  const anchors = new Map();
  for (const x of v2Anchors) { const key = `${x.target.user_id}:${x.target.attempt_id}:${x.p.part}`; if (!anchors.has(key) || anchors.get(key).recorded < x.recorded) anchors.set(key, x); }
  for (const x of anchors.values()) for (const r of x.target.answers) {
    if (Number(r.question_snapshot?.part_number) !== x.p.part) continue;
    if (!validAnswer(r)) { increment(excluded.v2, r.user_answer == null ? 'blank' : 'invalid_answer_or_key'); continue; }
    const first = time(r.first_answer_at);
    if (!Number.isFinite(first) || first < time(x.target.start_time) || first > time(x.target.end_time)) { increment(excluded.v2, 'missing_or_invalid_first_answer_evidence'); continue; }
    const preview = replay({ question: r.question_snapshot, userId: x.target.user_id, evidence: captureEvidence(x.target), asOf: x.target.start_time });
    if (!preview) { increment(excluded.v2, 'unreplayable_history_or_snapshot'); continue; }
    v2.push({ user: x.target.user_id, attempt: x.target.attempt_id, question: r.question_id, part: x.p.part, probability: x.p.probability, baseline_probability: x.baseline,
      repeat: preview.features.user_question_count > 0, actual: Number(r.user_answer === r.question_snapshot.correct_answer) });
  }
  const summarize = rows => ({ overall: compare(rows), first_exposure: compare(rows.filter(r => !r.repeat)), repeat: compare(rows.filter(r => r.repeat)),
    by_part: Array.from({ length: 7 }, (_, i) => { const rs = rows.filter(r => r.part === i + 1); return { part: i + 1, ...compare(rs),
      first_exposure: compare(rs.filter(r => !r.repeat)), repeat: compare(rs.filter(r => r.repeat)),
      evidence_status: !rs.length ? 'no_data' : new Set(rs.map(r => r.user)).size < 2 ? 'insufficient_learners' : 'experimental_unvalidated' }; }) });
  const inventoryRows = Array.from({ length: 7 }, (_, i) => {
    const part = i + 1, rows = evidence.filter(r => validAnswer(r) && Number(r.question_snapshot.part_number) === part);
    return { part, bank_questions: inventory.find(p => p.part === part)?.questions || 0, active_questions: inventory.find(p => p.part === part)?.active_questions || 0,
      answered: rows.length, learners: new Set(rows.map(r => r.user_id)).size, distinct_questions: new Set(rows.map(r => r.question_id)).size };
  });
  return { cutoff: new Date(cutoff).toISOString(), target_start_at_or_after: options.targetAfter || null,
    evaluation_role: options.prospective ? 'prospective_observational' : 'exploratory_pilot_not_holdout',
    protocol_version: PROTOCOL_VERSION, artifact_sha256: hashes,
    collection: { completed_attempts: completed.length, target_attempts: completed.filter(inWindow).length,
      completed_attempts_rejected: attempts.filter(a => a.is_completed).length - completed.length,
      input_digest_sha256: sha(JSON.stringify(attempts)) },
    purpose: 'Prediction validation only. No ability score or recommendation model is fitted or activated.',
    protocols: { v2: 'After-submission forecast scored only on the next completed attempt of the same Part, started after prediction recording; no donor labels scored.', v3: 'Stored pre-attempt forecasts; verify hash, snapshot, timing and replay eight frozen app features. No retrospective predictions.' },
    inventory: inventoryRows, statuses, exclusions: excluded,
    v2_next_attempt: summarize(v2), v3_pre_attempt: { ...summarize(v3), with_catalog: compare(v3.filter(r => r.catalog)), without_catalog: compare(v3.filter(r => !r.catalog)), cold_user: compare(v3.filter(r => r.cold_user)), cold_part: compare(v3.filter(r => r.cold_part)) },
    release: { decision: 'not_approved_by_audit', v2_parts_with_evidence: [...new Set(v2.map(r => r.part))], v3_parts_with_evidence: [...new Set(v3.map(r => r.part))],
      reason: 'Technical fixture coverage is separate from real-learner evidence. Require a fixed local protocol, representative new learners/items, verified content, per-Part calibration and paired comparison before use for ability/practice priority.' },
    limitations: ['No ground-truth ability labels.', 'Question-ID/fingerprint repeats do not detect equivalent content under another ID.', 'Historical timestamps without timezone interpreted as Asia/Ho_Chi_Minh.', 'Snapshots/versions establish consistency, not correctness of the original answer key.', 'Server revisions prove persistence order, not when an offline learner first selected or saw an answer.', 'No device playback or causal learning-effect claim.', 'ECE depends on binning and sample size. Paired learner intervals do not remove shared-question or passage dependence.'] };
}

function assertDev(context) {
  if (context.database !== DEV_DATABASE || context.marker !== DEV_MARKER) throw Error('Validation CLI requires the marked toeic_learning_events_dev database');
}

async function collect(client, hashes, options = {}) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='15s'");
    const context = (await client.query(`SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only,now() AS captured_at,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
    if (context.read_only !== 'on') throw Error('Read-only transaction required');
    if (options.requireDev) assertDev(context);
    const cutoff = options.until ? time(options.until) : time(context.captured_at);
    if (!Number.isFinite(cutoff) || cutoff > time(context.captured_at)) throw Error('Evaluation cutoff must not be in the future');
    const revisions = (await client.query("SELECT to_regclass('learning_answer_revisions') IS NOT NULL AS available")).rows[0].available;
    // The earliest nonblank revision must establish a known initial state. Never fall back to mutable answered_at.
    const firstAnswer = revisions ? `LEFT JOIN LATERAL (SELECT CASE WHEN r.baseline_known AND r.previous_answer IS NULL THEN r.changed_at END AS first_answer_at
      FROM learning_answer_revisions r WHERE r.attempt_id=a.attempt_id AND r.question_id=aq.question_id
      AND r.user_id=a.user_id AND r.new_answer IS NOT NULL ORDER BY r.revision_id LIMIT 1) first_response ON true` : '';
    const attempts = (await client.query(`SELECT a.attempt_id,a.user_id,a.is_completed,
      a.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_time,a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,
      a.ai_prediction,a.question_predictions,COALESCE(jsonb_agg(jsonb_build_object('question_id',aq.question_id,
      'question_snapshot',aq.question_snapshot,'user_answer',ua.user_answer,'answered_at',ua.answered_at AT TIME ZONE 'Asia/Ho_Chi_Minh',
      'first_answer_at',${revisions ? 'first_response.first_answer_at' : 'NULL::timestamptz'}) ORDER BY aq.question_id)
      FILTER(WHERE aq.question_id IS NOT NULL),'[]') AS answers FROM user_test_attempts a
      LEFT JOIN attempt_questions aq USING(attempt_id) LEFT JOIN user_answers ua USING(attempt_id,question_id)
      ${firstAnswer}
      GROUP BY a.attempt_id ORDER BY a.attempt_id`)).rows;
    if (options.respectCaptureOrigin) {
      const origins = (await client.query(`SELECT (target_key->>'attempt_id')::int AS attempt_id,origin_database
        FROM database_consolidation_rows WHERE table_name='user_test_attempts'`)).rows;
      const seen = new Set();
      for (const o of origins) {
        if (seen.has(o.attempt_id) || !['toeic_learning_system','toeic_learning_events_dev'].includes(o.origin_database)) throw Error('Ambiguous migration provenance');
        seen.add(o.attempt_id);
        const a = attempts.find(a=>a.attempt_id===o.attempt_id);
        if (a) a.capture_origin=o.origin_database;
      }
    }
    const inventory = (await client.query(`SELECT q.part_number AS part,count(*)::int AS questions,
      count(*) FILTER(WHERE t.is_active AND t.deleted_at IS NULL)::int AS active_questions
      FROM questions q LEFT JOIN tests t USING(test_id) GROUP BY q.part_number ORDER BY q.part_number`)).rows;
    return { context: { ...context, first_answer_revision_table_available: revisions }, ...buildReport(attempts, inventory, hashes, cutoff, options) };
  } finally { await client.query('ROLLBACK'); }
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--freeze-protocol') { if (out.freeze) throw Error('Duplicate flag'); out.freeze = true; continue; }
    const key = { '--after': 'targetAfter', '--until': 'until', '--protocol': 'protocol' }[flag];
    if (!key || out[key] != null || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Invalid argument: ${flag}`);
    out[key] = args[++i];
  }
  if (out.freeze && (out.protocol || out.targetAfter || out.until) || out.protocol && out.targetAfter) throw Error('Protocol and manual window flags are incompatible');
  for (const key of ['targetAfter', 'until']) if (out[key] && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(out[key]) || !Number.isFinite(time(out[key])))) throw Error(`${key} must be an ISO timestamp with timezone`);
  return out;
}

function codeHashes() {
  return Object.fromEntries(['scripts/auditLightgbmApp.js', 'scripts/lightgbmValidationMetrics.js',
    'scripts/reportQuestionPredictions.js', 'src/modules/ai/appQuestionFeatures.js'].map(file =>
    [file, sha(fs.readFileSync(path.join(__dirname, '..', file)))]));
}

function verifyProtocol(protocol, hashes, code) {
  if (protocol.version !== PROTOCOL_VERSION || protocol.database !== DEV_DATABASE || !Number.isFinite(time(protocol.target_start_at_or_after)) ||
      JSON.stringify(protocol.artifact_sha256) !== JSON.stringify(hashes) || JSON.stringify(protocol.code_sha256) !== JSON.stringify(code)) {
    throw Error('Frozen protocol/model/code mismatch; preserve the original protocol and review changes explicitly');
  }
  return protocol.target_start_at_or_after;
}

function summaryMarkdown(report) {
  const section = (title, result) => [`\n## ${title}\n`,
    '| Part | Responses | Learners | First | Repeat | AI log loss | Baseline log loss | AI Brier | Baseline Brier | Status |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|', ...result.by_part.map(p =>
      `| ${p.part} | ${p.model.rows} | ${p.learners} | ${p.first_exposure.model.rows} | ${p.repeat.model.rows} | ${p.model.log_loss ?? 'N/A'} | ${p.baseline.log_loss ?? 'N/A'} | ${p.model.brier_score ?? 'N/A'} | ${p.baseline.brier_score ?? 'N/A'} | ${p.evidence_status} |`)].join('\n');
  return `# LightGBM app validation\n\nDatabase: ${report.context.database}. Role: ${report.evaluation_role}. Cutoff: ${report.cutoff}.\n\nDecision: ${report.release.decision}. Lower log loss/Brier is better. Blank answers are excluded, not labelled incorrect.\n` +
    section('v3 frozen pre-attempt predictions', report.v3_pre_attempt) + '\n' + section('v2 forecast of next Part attempt', report.v2_next_attempt) +
    '\n\nNo ability score or practice priority is activated. See report.json for exclusions, cold cohorts, calibration, macro-per-learner metrics and uncertainty.\n';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || 'localhost')) throw Error('Validation requires local PostgreSQL');
  const hashes = { v2: sha(fs.readFileSync(path.join(root, 'toeic-ai/models/v2/lightgbm_v2.joblib'))), v3: sha(fs.readFileSync(path.join(root, 'toeic-ai/models/v3_app_shadow/model.joblib'))) };
  const code = codeHashes();
  let protocol = null;
  if (options.protocol) {
    protocol = JSON.parse(fs.readFileSync(path.resolve(options.protocol), 'utf8'));
    options.targetAfter = verifyProtocol(protocol, hashes, code); options.prospective = true;
  }
  const client = new Client({ user: process.env.DB_USER || 'postgres', host: process.env.DB_HOST || 'localhost', password: process.env.DB_PASS || '',
    port: process.env.DB_PORT || 5432, database: DEV_DATABASE, connectionTimeoutMillis:5000, options:'-c default_transaction_read_only=on' });
  let report;
  try { await client.connect(); report = await collect(client, hashes, { ...options, requireDev: true }); } finally { await client.end(); }
  const out = path.join(root, 'toeic-ai/reports/lightgbm_app_validation', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  const write = (file, value) => fs.writeFileSync(path.join(out, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  if (options.freeze) {
    protocol = { version: PROTOCOL_VERSION, database: DEV_DATABASE, target_start_at_or_after: new Date(report.context.captured_at).toISOString(),
      artifact_sha256: hashes, code_sha256: code, policy: 'Prequential observational evaluation; history retained before target window; no tuning or retraining on evaluation labels; not a randomized or ability-validity study.' };
    write('protocol.json', protocol);
  }
  write('report.json', { reports: [report] });
  write('SUMMARY.md', summaryMarkdown(report));
  const header = 'model,part,responses,learners,first,repeat,model_log_loss,baseline_log_loss,model_brier,baseline_brier,status';
  write('metrics_by_part.csv', [header, ...[['v2', report.v2_next_attempt], ['v3', report.v3_pre_attempt]].flatMap(([model, result]) => result.by_part.map(p =>
    [model, p.part, p.model.rows, p.learners, p.first_exposure.model.rows, p.repeat.model.rows, p.model.log_loss, p.baseline.log_loss, p.model.brier_score, p.baseline.brier_score, p.evidence_status].join(',')))].join('\n') + '\n');
  write('manifest.json', { created_at: new Date().toISOString(), database: DEV_DATABASE, protocol_version: PROTOCOL_VERSION,
    artifact_sha256: hashes, code_sha256: code, input_digest_sha256: report.collection.input_digest_sha256,
    target_start_at_or_after: report.target_start_at_or_after, cutoff: report.cutoff, evaluation_role: report.evaluation_role,
    protocol_sha256: protocol ? sha(JSON.stringify(protocol)) : null,
    report_sha256: sha(fs.readFileSync(path.join(out, 'report.json'))), read_only: report.context.read_only,
    inference_calls: 0, training_calls: 0 });
  console.log(JSON.stringify({ output: out, database: DEV_DATABASE, v2_rows: report.v2_next_attempt.overall.model.rows,
    v3_rows: report.v3_pre_attempt.overall.model.rows, exclusions: report.exclusions, protocol: options.freeze ? path.join(out, 'protocol.json') : options.protocol || null }));
}
module.exports = { buildReport, collect, compare, parseArgs, verifyProtocol, assertDev, summaryMarkdown };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
