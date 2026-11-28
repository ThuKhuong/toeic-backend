// Evidence-based learning guidance. Descriptive rules, not a trained ability score.
const { fingerprint } = require('./appQuestionFeatures');
const MIN_DISTINCT_FOR_COMPARISON = 10; // Product display policy, not statistical validation.
const REVIEW_WINDOW = 20;
const validChoice = value => ['A', 'B', 'C', 'D'].includes(value);
const rate = (correct, answered) => answered ? correct / answered : null;
function normalizedAnswer(row) {
  const snapshot = row.question_snapshot, part = Number(snapshot?.part_number);
  const labels = part === 2 ? ['A','B','C'] : ['A','B','C','D'];
  if (!Number.isInteger(part) || part < 1 || part > 7 || !labels.includes(snapshot?.correct_answer) ||
      !Array.isArray(snapshot.choices) || !snapshot.choices.some(c => c.choice_label === snapshot.correct_answer)) return null;
  const answer = labels.includes(row.user_answer) && snapshot.choices.some(c => c.choice_label === row.user_answer)
    ? row.user_answer : null;
  return { ...row, user_answer: answer };
}

function buildLearningOverview(rows, availableParts = [1, 2, 3, 4, 5, 6, 7]) {
  const parts = Array.from({ length: 7 }, (_, i) => ({ part: i + 1, total: 0, answered: 0,
    correct: 0, unanswered: 0, firstAnswers: [], attempts: new Set(), versions: new Set(), contentAnswered: new Set(), history: new Map() }));
  const ordered = [...rows].sort((a, b) => new Date(a.end_time) - new Date(b.end_time) ||
    Number(a.attempt_id) - Number(b.attempt_id) || Number(a.position) - Number(b.position));
  const seenAnswered = new Set(), allAttempts = new Set();
  for (const original of ordered) {
    const row = normalizedAnswer(original);
    if (!row) continue;
    const snapshot = row.question_snapshot;
    const part = Number(snapshot?.part_number);
    if (!Number.isInteger(part) || part < 1 || part > 7 || !validChoice(snapshot.correct_answer)) continue;
    const current = parts[part - 1];
    const version = `${row.question_id}:${fingerprint(snapshot)}`;
    current.total++; current.attempts.add(row.attempt_id); current.versions.add(version);
    allAttempts.add(row.attempt_id);
    if (!current.history.has(row.attempt_id)) current.history.set(row.attempt_id, {
      attempt_id: row.attempt_id, end_time: row.end_time, answered: 0, correct: 0,
      incorrect: 0, unanswered: 0, first_answered: 0, first_correct: 0, repeat_answers: 0,
    });
    const point = current.history.get(row.attempt_id);
    if (!validChoice(row.user_answer)) { current.unanswered++; point.unanswered++; continue; }
    const correct = Number(row.user_answer === snapshot.correct_answer);
    current.answered++; current.correct += correct;
    current.contentAnswered.add(fingerprint(snapshot));
    point.answered++; point.correct += correct; point.incorrect += 1 - correct;
    // Repeated memorized answers must not become fresh ability evidence.
    if (seenAnswered.has(version)) { point.repeat_answers++; continue; }
    seenAnswered.add(version); current.firstAnswers.push({ correct, end_time: row.end_time });
    point.first_answered++; point.first_correct += correct;
  }
  const resultParts = parts.map(p => {
    const firstCorrect = p.firstAnswers.reduce((sum, row) => sum + row.correct, 0);
    const enough = p.firstAnswers.length >= MIN_DISTINCT_FOR_COMPARISON;
    const review = p.firstAnswers.slice(-REVIEW_WINDOW);
    const reviewCorrect = review.reduce((sum, r) => sum + r.correct, 0);
    const historyPoints = [...p.history.values()].map(point => ({ ...point,
      correct_rate: rate(point.correct, point.answered), first_correct_rate: rate(point.first_correct, point.first_answered) }));
    const fresh = historyPoints.filter(point => point.first_answered > 0);
    let trend = { status: 'insufficient_data', required_completed_attempts: 2,
      method: 'between_completed_attempts_first_answers',
      limitation: 'Cần câu mới ở ít nhất hai lượt hoàn tất khác thời điểm; làm lại không chứng minh tiến bộ.' };
    if (fresh.length >= 2) {
      const previous = fresh.at(-2), recent = fresh.at(-1);
      if (Number.isFinite(Date.parse(previous.end_time)) && Date.parse(recent.end_time) > Date.parse(previous.end_time)) {
        trend = { ...trend, status: 'descriptive_comparison',
          previous_attempt_id: previous.attempt_id, recent_attempt_id: recent.attempt_id,
          previous_at: previous.end_time, recent_at: recent.end_time,
          previous_correct: previous.first_correct, recent_correct: recent.first_correct,
          previous_answered: previous.first_answered, recent_answered: recent.first_answered,
          recent_rate: recent.first_correct_rate, previous_rate: previous.first_correct_rate,
          delta_percentage_points: 100 * (recent.first_correct_rate - previous.first_correct_rate),
          small_sample: Math.min(previous.first_answered, recent.first_answered) < MIN_DISTINCT_FOR_COMPARISON,
          limitation: 'So sánh kết quả câu mới giữa hai lượt, chưa chuẩn hóa độ khó; không chứng minh thay đổi năng lực.' };
      }
    }
    return { part: p.part, total: p.total, answered: p.answered, correct: p.correct,
      incorrect: p.answered - p.correct, unanswered: p.unanswered, attempts: p.attempts.size,
      distinct_question_versions: p.versions.size, content_distinct_answered: p.contentAnswered.size, repeat_answers: p.answered - p.firstAnswers.length,
      correct_rate: rate(p.correct, p.answered),
      first_answers: { answered: p.firstAnswers.length, correct: firstCorrect,
        incorrect: p.firstAnswers.length - firstCorrect, correct_rate: rate(firstCorrect, p.firstAnswers.length) },
      review_basis: { answered: review.length, correct: reviewCorrect, incorrect: review.length - reviewCorrect,
        correct_rate: rate(reviewCorrect, review.length), maximum_window: REVIEW_WINDOW },
      evidence_status: !p.answered ? 'no_answers' : enough ? 'reviewable_sample' : 'small_sample',
      practice_available: availableParts.includes(p.part), history_points: historyPoints, trend };
  });
  const candidates = resultParts.filter(p => p.practice_available && p.evidence_status === 'reviewable_sample' && p.review_basis.incorrect > 0)
    .sort((a, b) => a.review_basis.correct_rate - b.review_basis.correct_rate ||
      b.review_basis.incorrect - a.review_basis.incorrect || a.part - b.part);
  const recommendations = candidates.slice(0, 2).map(p => ({ part: p.part, action: 'review_part',
    title: `Ôn lại Part ${p.part}`, reason: `Đúng ${p.review_basis.correct}/${p.review_basis.answered} câu mới gần nhất ở lần trả lời đầu; ${p.review_basis.incorrect} câu sai. Ưu tiên xem lời giải rồi luyện câu mới.` }));
  const unexplored = resultParts.filter(p => p.practice_available && p.first_answers.answered < MIN_DISTINCT_FOR_COMPARISON)
    .sort((a, b) => a.first_answers.answered - b.first_answers.answered || a.part - b.part);
  for (const p of unexplored.slice(0, 3 - recommendations.length)) recommendations.push({ part: p.part,
    action: 'collect_evidence', title: `Làm thêm câu mới ở Part ${p.part}`,
    reason: `Mới có ${p.first_answers.answered} câu được trả lời lần đầu. Cần thêm bài làm để có căn cứ nhận xét Part này.` });
  const totals = resultParts.reduce((sum, p) => ({ total: sum.total + p.total, answered: sum.answered + p.answered,
    correct: sum.correct + p.correct, unanswered: sum.unanswered + p.unanswered,
    repeat_answers: sum.repeat_answers + p.repeat_answers, first_answered: sum.first_answered + p.first_answers.answered,
    first_correct: sum.first_correct + p.first_answers.correct }),
  { total: 0, answered: 0, correct: 0, unanswered: 0, repeat_answers: 0, first_answered: 0, first_correct: 0 });
  return { version: 'learning_overview_v1', method: 'descriptive_rules', source: 'completed_attempt_snapshots',
    status: totals.answered ? 'ready' : 'insufficient_data',
    evidence_policy: { ranking_minimum_distinct_answers: MIN_DISTINCT_FOR_COMPARISON,
      first_answer_per_question_version: true, threshold_is_product_policy: true,
      blanks_excluded_from_accuracy: true, trend_method: 'between_completed_attempts_first_answers', maximum_review_window: REVIEW_WINDOW },
    totals: { ...totals, attempts: allAttempts.size, correct_rate: rate(totals.correct, totals.answered),
      first_correct_rate: rate(totals.first_correct, totals.first_answered) },
    summary: !totals.answered ? 'Hãy hoàn tất một bài luyện để bắt đầu theo dõi kết quả.'
      : candidates.length ? `Bạn có thể ưu tiên ôn Part ${candidates[0].part} dựa trên các câu trả lời lần đầu trong lịch sử. Đây là gợi ý ôn tập, chưa phải kết luận năng lực.`
        : 'Xem kết quả từng Part và luyện thêm câu mới. Dữ liệu hiện có chưa chỉ ra Part cần ưu tiên ôn theo quy tắc này.',
    parts: resultParts, recommendations,
    limitation: 'Kết quả mô tả lịch sử làm bài, không phải điểm TOEIC hoặc xác suất AI. Độ khó giữa các bài có thể khác nhau; so sánh các lượt chưa chứng minh tiến bộ năng lực.' };
}

function createLearningOverview({ pool }) {
  return async function overview(userId) {
    const client = await pool.connect();
    try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='8s'");
    const context = (await client.query('SELECT now() AS as_of')).rows[0];
    const rows = (await client.query(`SELECT a.attempt_id,a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,aq.position,aq.question_id,
      aq.question_snapshot,ua.user_answer FROM user_test_attempts a
      JOIN attempt_questions aq USING(attempt_id) LEFT JOIN user_answers ua USING(attempt_id,question_id)
      WHERE a.user_id=$1 AND a.is_completed=true AND a.end_time IS NOT NULL AND a.end_time>=a.start_time
      AND a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh'<=$2
      ORDER BY a.end_time,a.attempt_id,aq.position`, [userId,context.as_of])).rows;
    const available = (await client.query(`SELECT DISTINCT q.part_number AS part FROM questions q
      JOIN tests t ON t.test_id=q.test_id WHERE t.is_active=true AND t.deleted_at IS NULL
      AND t.publication_status='published'
      AND q.part_number BETWEEN 1 AND 7`)).rows.map(r => Number(r.part));
    const attempts = (await client.query(`SELECT attempt_id,user_id,ai_prediction,
      start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_time,end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time
      FROM user_test_attempts WHERE user_id=$1 AND is_completed AND end_time>=start_time
      AND end_time AT TIME ZONE 'Asia/Ho_Chi_Minh'<=$2 ORDER BY end_time,attempt_id`, [userId,context.as_of])).rows;
    return require('./partAssessment').attachPartAssessment(buildLearningOverview(rows, available), attempts,
      { userId, asOf: context.as_of });
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  };
}
module.exports = { buildLearningOverview, createLearningOverview, normalizedAnswer };
