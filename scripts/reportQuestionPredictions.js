// Read-only app evaluation. Each run writes a fresh aggregate report without user IDs.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { questionPredictionSummary } = require('../src/modules/ai/questionPrediction');

function metrics(rows, key) {
  if (!rows.length) return { rows: 0, log_loss: null, brier_score: null, roc_auc: null };
  let loss = 0, brier = 0, correct = 0;
  for (const row of rows) {
    const p = Math.max(1e-15, Math.min(1 - 1e-15, row[key]));
    loss -= row.actual * Math.log(p) + (1 - row.actual) * Math.log(1 - p);
    brier += (row[key] - row.actual) ** 2;
    correct += Number((row[key] >= .5) === Boolean(row.actual));
  }
  const sorted = [...rows].sort((a, b) => a[key] - b[key]);
  let positives = 0, rankSum = 0;
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end][key] === sorted[start][key]) end++;
    const rank = (start + 1 + end) / 2;
    for (let i = start; i < end; i++) if (sorted[i].actual) { positives++; rankSum += rank; }
    start = end;
  }
  const negatives = rows.length - positives;
  return { rows: rows.length, log_loss: loss / rows.length, brier_score: brier / rows.length,
    accuracy: correct / rows.length, roc_auc: positives && negatives ?
      (rankSum - positives * (positives + 1) / 2) / (positives * negatives) : null };
}

async function collectReport(pool) {
    const available = (await pool.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='user_test_attempts' AND column_name='question_predictions'`)).rowCount;
    if (!available) throw Error('Run npm run migrate:question-ai first.');
    const attempts = (await pool.query(`SELECT a.attempt_id,a.user_id,a.end_time,a.question_predictions,
      COALESCE(jsonb_agg(jsonb_build_object('question_id',aq.question_id,'question_snapshot',aq.question_snapshot,
      'user_answer',ua.user_answer)) FILTER (WHERE aq.question_id IS NOT NULL),'[]') AS answers
      FROM user_test_attempts a LEFT JOIN attempt_questions aq USING(attempt_id)
      LEFT JOIN user_answers ua USING(attempt_id,question_id)
      WHERE a.is_completed=true AND a.question_predictions IS NOT NULL
      GROUP BY a.attempt_id ORDER BY a.attempt_id`)).rows;
    const groups = new Map(), statuses = {};
    for (const attempt of attempts) {
      const summary = questionPredictionSummary(attempt.question_predictions, attempt.answers, attempt.end_time);
      statuses[summary.status] = (statuses[summary.status] || 0) + 1;
      if (summary.status !== 'ready') continue;
      const key = `${summary.artifact_sha256}:${summary.feature_version}`;
      if (!groups.has(key)) groups.set(key, { model: summary.model, artifact_sha256: summary.artifact_sha256,
        feature_version: summary.feature_version, attempts: 0, learners: new Set(), rows: [], unanswered: 0 });
      const group = groups.get(key); group.attempts++; group.learners.add(attempt.user_id);
      group.rows.push(...summary.questions.filter(row => row.actual !== null)); group.unanswered += summary.unanswered;
    }
    const compare = rows => ({ model: metrics(rows, 'probability'), baseline: metrics(rows, 'baseline_probability') });
    const report = { created_at: new Date().toISOString(), mode: 'app_observation_only', attempt_statuses: statuses,
      protocol: 'Predictions saved before attempt commit; labels from completed attempt snapshots. Unanswered questions excluded. Baseline is smoothed personal Part history at the same cutoff. Group by artifact and feature version.',
      limitation: 'Observational app evidence; no causal learning-improvement claim. Small or single-learner samples cannot establish generalization.',
      models: [...groups.values()].map(group => ({ model: group.model, artifact_sha256: group.artifact_sha256,
        feature_version: group.feature_version, attempts: group.attempts, learners: group.learners.size,
        unanswered: group.unanswered, overall: compare(group.rows),
        by_part: [1, 2, 3, 4, 5, 6, 7].map(part => ({ part, ...compare(group.rows.filter(row => row.part === part)) })),
        by_question_evidence: [false, true].map(seen => ({ seen_by_other_learners: seen,
          ...compare(group.rows.filter(row => (row.evidence.question_answers_from_other_learners > 0) === seen)) })),
      })) };
    return report;
}

async function main() {
  const pool = require('../db');
  try {
    const report = await collectReport(pool);
    const output = path.resolve(__dirname, '../../toeic-ai/reports', `app_observations_${Date.now()}_${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2)); console.log(`Saved: ${output}`);
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { metrics, collectReport };
