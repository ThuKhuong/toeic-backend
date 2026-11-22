// Legacy integration fixture adapter. Not mounted in the production API.
function createPredictor({ pool, fetchImpl = fetch, baseUrl, timeoutMs = 10000 }) {
  return async function predictForUser(userId, part) {
    if (!Number.isInteger(part) || part < 1 || part > 7) {
      throw Object.assign(new Error('Part phải là số nguyên từ 1 đến 7.'), { status: 400 });
    }
    // One query provides consistent total/Part counts. Never count unfinished
    // attempts, unanswered questions or labels not yet calculated.
    const { rows } = await pool.query(`
      SELECT (aq.question_snapshot->>'part_number')::integer AS part,
        COUNT(*)::integer AS answered_count,
        COUNT(*) FILTER (WHERE ua.is_correct=true)::integer AS correct_count
      FROM user_test_attempts a
      JOIN user_answers ua ON ua.attempt_id=a.attempt_id
      JOIN attempt_questions aq ON aq.attempt_id=ua.attempt_id AND aq.question_id=ua.question_id
      WHERE a.user_id=$1 AND a.is_completed=true AND a.end_time IS NOT NULL
        AND ua.user_answer IS NOT NULL AND ua.is_correct IS NOT NULL
        AND aq.question_snapshot->>'part_number' IN ('1','2','3','4','5','6','7')
      GROUP BY (aq.question_snapshot->>'part_number')::integer`, [userId]);
    const totals = rows.reduce((sum, r) => ({ answered: sum.answered + r.answered_count, correct: sum.correct + r.correct_count }), { answered: 0, correct: 0 });
    const selected = rows.find(r => r.part === part);
    if (!selected?.answered_count) {
      return { status: 'insufficient_data', part, probability: null, message: 'Chưa có câu trả lời trong bài đã nộp ở Part này.' };
    }
    const input = {
      part, answered_count: totals.answered, correct_count: totals.correct,
      part_answered_count: selected.answered_count, part_correct_count: selected.correct_count,
    };
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/predict`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw Object.assign(new Error('Không kết nối được dịch vụ AI Python. Kiểm tra dịch vụ ở cổng 8000.'), { status: 503 });
    }
    if (!response.ok) throw Object.assign(new Error('Dịch vụ AI không xử lý được yêu cầu dự đoán.'), { status: 502 });
    let result;
    try { result = await response.json(); } catch {
      throw Object.assign(new Error('Dịch vụ AI trả dữ liệu không hợp lệ.'), { status: 502 });
    }
    if (result.model !== 'lightgbm_v2' || result.part !== part ||
        typeof result.probability !== 'number' || !Number.isFinite(result.probability) ||
        result.probability < 0 || result.probability > 1) {
      throw Object.assign(new Error('Dịch vụ AI trả mô hình hoặc xác suất không hợp lệ.'), { status: 502 });
    }
    return {
      status: 'experimental', model: result.model, part, probability: result.probability,
      history: input, time_feature_missing: true,
      message: 'Dự đoán thử nghiệm từ lịch sử bài đã nộp; thời gian nhóm trước đang để thiếu. Không phải điểm TOEIC hoặc kết luận năng lực.',
    };
  };
}
module.exports = { createPredictor };
