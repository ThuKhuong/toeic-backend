// Live admin reports. SELECT only; never calls prediction/results or changes evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildLearningOverview } = require('./learningOverview');
const { TYPES } = require('../learning/eventTypes');
const { attachPartAssessment } = require('./partAssessment');
const DB = 'toeic_learning_system';
const MARKER = 'TOEIC_UNIFIED_DEVELOPMENT';
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const stamp = value => value == null ? NaN : new Date(value).getTime();
const validProbability = p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;

function modelHashes() {
  const root = path.resolve(__dirname, '../../../../toeic-ai/models');
  const digest = file => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
  return { v2: digest(path.join(root, 'v2/lightgbm_v2.joblib')),
    v3: digest(path.join(root, 'v3_app_shadow/model.joblib')) };
}

function buildAdminReport(learner, rows, attempts, eventRows, context, hashes, availableParts) {
  const cutoff = stamp(context.as_of);
  attempts = attempts.filter(a => a.user_id === learner.user_id && Number.isFinite(stamp(a.start_time)) &&
    Number.isFinite(stamp(a.end_time)) && stamp(a.start_time) <= stamp(a.end_time) && stamp(a.end_time) <= cutoff);
  const attemptIds = new Set(attempts.map(a => a.attempt_id));
  let invalidSnapshots = 0, invalidAnswers = 0;
  const evidence = [];
  for (const row of rows) {
    // Defense in depth if a caller supplies mixed records. SQL also scopes by owner.
    if (row.user_id !== learner.user_id || !attemptIds.has(row.attempt_id)) continue;
    const q = row.question_snapshot, part = Number(q?.part_number);
    const labels = part === 2 ? ['A','B','C'] : ['A','B','C','D'];
    if (!Number.isInteger(part) || part < 1 || part > 7 || !labels.includes(q?.correct_answer) || !Array.isArray(q.choices) ||
        !(q.choices || []).some(c => c.choice_label === q.correct_answer)) { invalidSnapshots++; continue; }
    let answer = row.user_answer;
    if (answer != null && (!labels.includes(answer) || !(q.choices || []).some(c => c.choice_label === answer))) {
      invalidAnswers++; answer = null;
    }
    evidence.push({ ...row, user_answer: answer });
  }
  const overview = attachPartAssessment(buildLearningOverview(evidence, availableParts), attempts,
    {userId:learner.user_id,asOf:context.as_of,artifactHash:hashes.v2});
  const predictions = Array.from({ length: 7 }, () => ({ v2_forecasts: 0, v3_question_predictions: 0, latest_recorded_at: null }));
  let rejectedPredictionRecords = 0;
  for (const a of attempts.filter(a => a.user_id === learner.user_id)) {
    const ownRows = evidence.filter(r => r.attempt_id === a.attempt_id);
    const add = (part, kind, at) => {
      const dest = predictions[part - 1]; dest[kind]++;
      if (!dest.latest_recorded_at || stamp(at) > stamp(dest.latest_recorded_at)) dest.latest_recorded_at = new Date(at).toISOString();
    };
    const v2 = a.ai_prediction;
    for (const p of Array.isArray(v2?.parts) ? v2.parts : []) {
      if (p?.status !== 'ready') continue;
      const recorded = stamp(v2.completed_at), part = Number(p.part);
      if (!hashes.v2 || p.artifact_sha256 !== hashes.v2 || p.model !== 'lightgbm_v2' ||
          !Number.isInteger(part) || part < 1 || part > 7 || !validProbability(p.probability) ||
          !ownRows.some(r => Number(r.question_snapshot.part_number) === part) ||
          !Number.isFinite(recorded) || recorded < stamp(a.end_time) || recorded > cutoff ||
          !Number.isFinite(stamp(v2.as_of)) || Math.abs(stamp(v2.as_of) - stamp(a.end_time)) > 1) { rejectedPredictionRecords++; continue; }
      add(part, 'v2_forecasts', recorded);
    }
    const v3 = a.question_predictions;
    if (v3?.status !== 'ready') continue;
    const recorded = stamp(v3.recorded_at);
    if (!hashes.v3 || v3.artifact_sha256 !== hashes.v3 || v3.model !== 'lightgbm_question_catalog_v3' ||
        v3.version !== 'app_question_catalog_v1' || v3.mode !== 'app_observation_only' ||
        !Number.isFinite(recorded) || recorded < stamp(a.start_time) || recorded > stamp(a.end_time) || recorded > cutoff ||
        !Number.isFinite(stamp(v3.as_of)) || Math.abs(stamp(v3.as_of) - stamp(a.start_time)) > 1 || !Array.isArray(v3.questions)) { rejectedPredictionRecords++; continue; }
    const seen = new Set();
    for (const p of v3.questions) {
      if (!p || typeof p !== 'object') { rejectedPredictionRecords++; continue; }
      const q = ownRows.find(r => r.question_id === p.question_id);
      if (!q || seen.has(p.question_id) || Number(p.part) !== Number(q.question_snapshot.part_number) || !validProbability(p.probability)) {
        rejectedPredictionRecords++; continue;
      }
      seen.add(p.question_id); add(Number(p.part), 'v3_question_predictions', recorded);
    }
  }
  const parts = overview.parts.map((p, index) => ({ part: p.part, presented: p.total, answered: p.answered,
    correct: p.correct, incorrect: p.incorrect, unanswered: p.unanswered, attempt_count: p.attempts,
    first_answers: p.first_answers.answered, repeat_answers: p.repeat_answers,
    distinct_question_versions: p.distinct_question_versions, accuracy: p.correct_rate,
    first_accuracy: p.first_answers.correct_rate, practice_available: p.practice_available,
    evidence_status: p.total === 0 ? 'no_data' : p.evidence_status === 'reviewable_sample' ? 'descriptive_history' : 'insufficient_data',
    trend:p.trend, history_points:p.history_points,
    ai: { ...predictions[index], status: predictions[index].v2_forecasts + predictions[index].v3_question_predictions > 0 ? 'experimental_unvalidated' : 'not_recorded',
      v2_estimate:p.ai.status==='experimental_unvalidated'?p.ai:null } }));
  const counts = Object.fromEntries(TYPES.map(t => [t, 0])); let late = 0, latestEvent = null;
  for (const e of eventRows) {
    if (!TYPES.includes(e.event_type)) continue;
    counts[e.event_type] += Number(e.count); late += Number(e.after_completion || 0);
    if (e.latest_received_at && (!latestEvent || stamp(e.latest_received_at) > stamp(latestEvent))) latestEvent = e.latest_received_at;
  }
  const t = overview.totals;
  return { version: 'admin_learning_report_v1', learner: { user_id: learner.user_id, full_name: learner.full_name },
    source: { database: context.database, mode: 'live_readonly', as_of: new Date(context.as_of).toISOString(),
      last_completed_at: attempts.length ? new Date(attempts.reduce((latest,a) => Math.max(latest,stamp(a.end_time)),0)).toISOString() : null,
      last_event_received_at: latestEvent ? new Date(latestEvent).toISOString() : null },
    total: { attempt_count: t.attempts, presented: t.total, answered: t.answered, correct: t.correct,
      incorrect: t.answered - t.correct, unanswered: t.unanswered, first_answers: t.first_answered, repeat_answers: t.repeat_answers },
    parts, recommendations:overview.recommendations,
    learning_events: { total: Object.values(counts).reduce((a,b) => a+b,0), by_type: counts, received_after_completion: late,
      scope: 'All persisted owned events up to as_of, including unfinished attempts and lessons; answer statistics use completed attempts only.' },
    policy: { method: 'descriptive_rules', display_minimum_first_answers: overview.evidence_policy.ranking_minimum_distinct_answers,
      threshold_is_product_policy: true, ai_validation_status: 'not_approved', inference_called: false, strength_weakness_enabled: false,
      prediction_counts_mean: 'Saved experimental predictions with basic artifact/timing checks; not a replay audit or ability estimate. V2 forecasts concern a subsequent attempt.' },
    diagnostics: { invalid_snapshots: invalidSnapshots, invalid_answers: invalidAnswers, rejected_prediction_records: rejectedPredictionRecords },
    limitations: [overview.limitation, 'Ngưỡng hiển thị chỉ là quy tắc sản phẩm, không chứng nhận đủ dữ liệu đánh giá năng lực.',
      'Chỉ đếm dự đoán đã lưu; chưa xác nhận hiệu quả AI. Không kết luận Part mạnh/yếu.',
      'Sự kiện chưa đồng bộ trên thiết bị chưa xuất hiện trong báo cáo.'] };
}

function createAdminLearningReport({ pool, hashes = modelHashes() }) {
  async function read(work) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await c.query("SET LOCAL statement_timeout='8s'");
      const context = (await c.query(`SELECT current_database() AS database,now() AS as_of,
        current_setting('transaction_read_only') AS read_only,
        shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
      if (context.database !== DB || context.marker !== MARKER || context.read_only !== 'on') fail(503, 'Báo cáo chỉ phục vụ database toeic_learning_system đã xác minh.');
      return await work(c, context);
    } finally { try { await c.query('ROLLBACK'); } finally { c.release(); } }
  }
  return {
    list: () => read(async (c, context) => ({ source: { database: context.database, as_of: context.as_of, mode: 'live_readonly' },
      learners: (await c.query(`SELECT user_id,full_name FROM "User" WHERE role='STUDENT' ORDER BY user_id`)).rows.map(u => ({ user_id:u.user_id,full_name:u.full_name })) })),
    detail: userId => read(async (c, context) => {
      if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) fail(400, 'Mã người học không hợp lệ.');
      const learner = (await c.query(`SELECT user_id,full_name FROM "User" WHERE user_id=$1 AND role='STUDENT'`, [userId])).rows[0];
      if (!learner) fail(404, 'Không tìm thấy người học.');
      const attempts = (await c.query(`SELECT attempt_id,user_id,
        start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_time,end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,
        ai_prediction,question_predictions FROM user_test_attempts
        WHERE user_id=$1 AND is_completed AND end_time IS NOT NULL AND end_time>=start_time
        AND end_time AT TIME ZONE 'Asia/Ho_Chi_Minh'<=$2 ORDER BY end_time,attempt_id`, [userId, context.as_of])).rows;
      const rows = (await c.query(`SELECT a.user_id,a.attempt_id,a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,
        aq.position,aq.question_id,aq.question_snapshot,ua.user_answer
        FROM user_test_attempts a JOIN attempt_questions aq USING(attempt_id)
        LEFT JOIN user_answers ua USING(attempt_id,question_id)
        WHERE a.user_id=$1 AND a.is_completed AND a.end_time IS NOT NULL AND a.end_time>=a.start_time
        AND a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh'<=$2 ORDER BY a.end_time,a.attempt_id,aq.position`, [userId, context.as_of])).rows;
      const events = (await c.query(`SELECT e.event_type,count(*)::int AS count,max(e.received_at) AS latest_received_at,
        count(*) FILTER(WHERE e.event_payload#>>'{server_context,received_after_completion}'='true')::int AS after_completion
        FROM learning_events e LEFT JOIN user_test_attempts a USING(attempt_id)
        WHERE e.user_id=$1 AND (e.attempt_id IS NULL OR a.user_id=$1) AND e.received_at<=$2 GROUP BY e.event_type`, [userId, context.as_of])).rows;
      const available = (await c.query(`SELECT DISTINCT q.part_number FROM questions q JOIN tests t USING(test_id)
        WHERE t.is_active AND t.deleted_at IS NULL AND t.publication_status='published' ORDER BY q.part_number`)).rows.map(r => Number(r.part_number));
      return buildAdminReport(learner, rows, attempts, events, context, hashes, available);
    })
  };
}
module.exports = { createAdminLearningReport, buildAdminReport };
