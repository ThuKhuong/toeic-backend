// One Part profile policy for learner/admin. Reads saved V2 forecasts only.
// No model inference, training, persistence or conversion to a mastery score.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const time = value => value == null ? NaN : new Date(value).getTime();
function v2Hash() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,
    '../../../../toeic-ai/models/v2/lightgbm_v2.joblib'))).digest('hex'); } catch { return null; }
}
function attachPartAssessment(overview, attempts, {userId, asOf, artifactHash = v2Hash()} = {}) {
  const cutoff = time(asOf);
  if (!Number.isFinite(cutoff) || !Number.isSafeInteger(userId)) throw Error('Part profile requires owner and cutoff');
  const parts = overview.parts.map(part => {
    const ai = { model: 'lightgbm_v2', status: 'not_recorded', probability: null,
      validation_status: 'not_approved', ability_label_enabled: false,
      message: 'Chưa có ước lượng V2 hợp lệ được lưu cho Part này.' };
    const candidates = [];
    for (const attempt of attempts) {
      if (attempt.user_id !== userId) continue;
      const saved = attempt.ai_prediction, start = time(attempt.start_time), end = time(attempt.end_time);
      const recorded = time(saved?.completed_at), asof = time(saved?.as_of);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > cutoff ||
          saved?.version !== 'attempt_lightgbm_v1' || !['ready','partial'].includes(saved.status) ||
          !Number.isFinite(recorded) || recorded < end || recorded > cutoff || Math.abs(asof - end) > 1 ||
          !Number.isFinite(asof) || !Array.isArray(saved.parts) || !Array.isArray(saved.inputs)) continue;
      const forecast = saved.parts.find(p => p.part === part.part && p.status === 'ready');
      const input = saved.inputs.find(p => p.part === part.part);
      if (!forecast || forecast.model !== 'lightgbm_v2' || !artifactHash || forecast.artifact_sha256 !== artifactHash ||
          forecast.feature_version !== 'group_history_v1' ||
          typeof forecast.probability !== 'number' || !Number.isFinite(forecast.probability) ||
          forecast.probability < 0 || forecast.probability > 1 ||
          !input || !['answered_count','correct_count','part_answered_count','part_correct_count'].every(k=>Number.isSafeInteger(input[k]) && input[k]>=0) ||
          input.part_answered_count < 1 || input.correct_count > input.answered_count ||
          input.part_correct_count > input.part_answered_count || input.part_answered_count > input.answered_count ||
          input.part_correct_count > input.correct_count ||
          input.correct_count-input.part_correct_count > input.answered_count-input.part_answered_count) continue;
      candidates.push({ forecast, attempt, recorded, asof });
    }
    candidates.sort((a,b) => b.recorded-a.recorded || b.attempt.attempt_id-a.attempt.attempt_id);
    const latest = candidates[0];
    if (latest && part.first_answers.answered >= overview.evidence_policy.ranking_minimum_distinct_answers) {
      Object.assign(ai, { status:'experimental_unvalidated', probability:latest.forecast.probability,
        recorded_at:new Date(latest.recorded).toISOString(), as_of:new Date(latest.asof).toISOString(),
        source_attempt_id:latest.attempt.attempt_id,
        message:'Ước lượng thử nghiệm từ lịch sử tại mốc đã lưu, dành cho lượt tiếp theo. Chưa dùng để kết luận năng lực.' });
    } else if (part.answered > 0) {
      ai.status = latest ? 'insufficient_data' : 'not_recorded';
      if (latest) ai.message = 'Có forecast cũ nhưng chưa đủ câu mới để hiển thị ước lượng theo chính sách hồ sơ.';
    }
    return { ...part, ai };
  });
  return { ...overview, profile_version:'part_assessment_v1', parts,
    source:{mode:'live_readonly',as_of:new Date(cutoff).toISOString()},
    policy:{method:'descriptive_rules_with_saved_v2',ai_validation_status:'not_approved',
      strength_weakness_enabled:false,inference_called:false,
      recommendation_method:'descriptive_rules',
      note:'Ngưỡng số câu chỉ là chính sách hiển thị. Không có điểm năng lực hoặc nhãn mạnh/yếu bằng AI.'} };
}
module.exports = { attachPartAssessment, v2Hash };
