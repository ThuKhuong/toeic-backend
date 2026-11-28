// One Part profile policy for learner/admin. Reads saved V2 forecasts and derives relative Part competency & priority.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const time = value => value == null ? NaN : new Date(value).getTime();
function v2Hash() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,
    '../../../../toeic-ai/models/v2/lightgbm_v2.joblib'))).digest('hex'); } catch { return null; }
}

function evaluationBest(compare, highestParts) {
  return compare.length >= 2 && highestParts.length === 1 ? highestParts[0] : null;
}

function evaluateAiCompetency(overview, parts) {
  const minDistinct = overview.evidence_policy?.ranking_minimum_distinct_answers ?? 10;
  const eligible = parts.filter(p => typeof p.ai?.probability === 'number' && Number.isFinite(p.ai.probability) &&
    (p.content_distinct_answered ?? p.first_answers?.answered ?? 0) >= minDistinct);
  const sorted = [...eligible].sort((a, b) => a.ai.probability - b.ai.probability || a.part - b.part);
  const compare = sorted.length >= 2 ? sorted.map((p, idx) => ({
    part: p.part,
    probability: p.ai.probability,
    baseline_probability: p.ai.baseline_probability ?? (p.answered ? (p.correct + 1) / (p.answered + 2) : null),
    rank: idx + 1,
  })) : [];
  const lowestProb = compare.length ? compare[0].probability : null;
  const highestProb = compare.length ? compare[compare.length - 1].probability : null;
  const lowestParts = compare.filter(x => x.probability === lowestProb);
  const highestParts = compare.filter(x => x.probability === highestProb);
  const hasRelativeSpread = compare.length >= 2 && lowestProb < highestProb;

  for (const p of parts) {
    const isEligible = eligible.some(e => e.part === p.part);
    if (!isEligible) {
      p.ai.rank_eligible = false;
      p.ai.ability_label_enabled = false;
      p.ai.ability_level = null;
      p.ai.ability_label = null;
      p.ai.relative_rank = null;
      continue;
    }
    p.ai.rank_eligible = true;
    const rankEntry = compare.find(c => c.part === p.part);
    p.ai.relative_rank = rankEntry ? rankEntry.rank : null;
    const prob = p.ai.probability;
    if (hasRelativeSpread) {
      p.ai.ability_label_enabled = true;
      if (prob === lowestProb && lowestParts.length === 1) {
        p.ai.ability_level = 'needs_improvement';
        p.ai.ability_label = 'Cần cải thiện';
        p.ai.relative_role = 'weakness';
      } else if (prob === highestProb && highestParts.length === 1 && prob >= 0.65) {
        p.ai.ability_level = 'good';
        p.ai.ability_label = 'Điểm mạnh';
        p.ai.relative_role = 'strength';
      } else if (prob >= 0.72) {
        p.ai.ability_level = 'good';
        p.ai.ability_label = 'Năng lực tốt';
        p.ai.relative_role = 'middle';
      } else if (prob >= 0.60) {
        p.ai.ability_level = 'developing';
        p.ai.ability_label = 'Đang hoàn thiện';
        p.ai.relative_role = 'middle';
      } else {
        p.ai.ability_level = 'needs_improvement';
        p.ai.ability_label = 'Cần cải thiện';
        p.ai.relative_role = 'middle';
      }
      p.ai.message = `Mức độ thành thạo dự kiến: ${(prob * 100).toFixed(1)}% (${p.ai.ability_label}).`;
    } else if (sorted.length === 1) {
      p.ai.ability_label_enabled = false;
      p.ai.relative_role = null;
      p.ai.ability_level = prob >= 0.72 ? 'good' : prob >= 0.60 ? 'developing' : 'needs_improvement';
      p.ai.ability_label = prob >= 0.72 ? 'Năng lực tốt' : prob >= 0.60 ? 'Đang hoàn thiện' : 'Cần cải thiện';
      p.ai.message = `Mức độ thành thạo dự kiến: ${(prob * 100).toFixed(1)}%.`;
    } else {
      p.ai.ability_label_enabled = false;
      p.ai.relative_role = 'tied';
      p.ai.ability_level = 'developing';
      p.ai.ability_label = 'Đang hoàn thiện';
    }
  }

  let recommendations = overview.recommendations || [];
  let summary = overview.summary;
  let aiDrivenRecommendations = false;
  if (hasRelativeSpread || (eligible.length === 1 && eligible[0].practice_available && eligible[0].review_basis?.incorrect > 0)) {
    const aiCandidates = parts.filter(p => p.practice_available && p.evidence_status === 'reviewable_sample' &&
      (p.review_basis?.incorrect > 0 || p.ai?.relative_role === 'weakness'))
      .sort((a, b) => {
        const aHasAi = typeof a.ai?.probability === 'number' && Number.isFinite(a.ai.probability);
        const bHasAi = typeof b.ai?.probability === 'number' && Number.isFinite(b.ai.probability);
        if (aHasAi && bHasAi) {
          return a.ai.probability - b.ai.probability ||
            (a.review_basis?.correct_rate ?? 1) - (b.review_basis?.correct_rate ?? 1) ||
            a.part - b.part;
        }
        if (aHasAi !== bHasAi) return aHasAi ? -1 : 1;
        return (a.review_basis?.correct_rate ?? 1) - (b.review_basis?.correct_rate ?? 1) ||
          (b.review_basis?.incorrect ?? 0) - (a.review_basis?.incorrect ?? 0) ||
          a.part - b.part;
      });
    const reviewRecs = aiCandidates.slice(0, 2).map(p => {
      const hasAi = typeof p.ai?.probability === 'number' && Number.isFinite(p.ai.probability);
      if (hasAi) {
        aiDrivenRecommendations = true;
        return {
          part: p.part,
          action: 'review_part',
          method: 'lightgbm_v2_priority',
          ai_probability: p.ai.probability,
          ability_label: p.ai.ability_label,
          title: `Ôn lại Part ${p.part}`,
          reason: `AI đánh giá cần ưu tiên cải thiện · Đã làm đúng ${p.first_answers.correct}/${p.first_answers.answered} câu`,
        };
      }
      return {
        part: p.part,
        action: 'review_part',
        method: 'descriptive_rules',
        title: `Ôn lại Part ${p.part}`,
        reason: `Đã làm đúng ${p.first_answers.correct}/${p.first_answers.answered} câu (${p.first_answers.incorrect} câu cần ôn lại)`,
      };
    });
    const unexplored = parts.filter(p => p.practice_available && p.first_answers.answered < minDistinct)
      .sort((a, b) => a.first_answers.answered - b.first_answers.answered || a.part - b.part);
    for (const p of unexplored.slice(0, 3 - reviewRecs.length)) {
      reviewRecs.push({
        part: p.part,
        action: 'collect_evidence',
        method: 'evidence_gate',
        title: `Làm thêm câu mới ở Part ${p.part}`,
        reason: `Mới làm ${p.first_answers.answered}/${minDistinct} câu · Luyện thêm để AI đánh giá chính xác`,
      });
    }
    recommendations = reviewRecs;
    const topAi = reviewRecs.find(r => r.method === 'lightgbm_v2_priority');
    const bestPart = evaluationBest(compare, highestParts);
    if (topAi) {
      summary = bestPart && bestPart.part !== topAi.part
        ? `Theo AI, điểm mạnh nhất của bạn là Part ${bestPart.part} và phần cần tập trung cải thiện là Part ${topAi.part}.`
        : `Theo AI, bạn nên ưu tiên luyện thêm Part ${topAi.part} để cải thiện kết quả.`;
    }
  }

  return {
    compare,
    lowestParts,
    highestParts,
    hasRelativeSpread,
    aiDrivenRecommendations,
    recommendations,
    summary,
  };
}

function attachPartAssessment(overview, attempts, {userId, asOf, artifactHash = v2Hash()} = {}) {
  const cutoff = time(asOf);
  if (!Number.isFinite(cutoff) || !Number.isSafeInteger(userId)) throw Error('Part profile requires owner and cutoff');
  const parts = overview.parts.map(part => {
    const ai = { model: 'lightgbm_v2', status: 'not_recorded', probability: null,
      validation_status: 'validated_on_riiid_and_app_pilot', ability_label_enabled: false,
      ability_level: null, ability_label: null, relative_rank: null,
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
    candidates.sort((a,b) => b.asof-a.asof || b.attempt.attempt_id-a.attempt.attempt_id || b.recorded-a.recorded);
    const latest = candidates[0];
    if (latest && part.first_answers.answered >= overview.evidence_policy.ranking_minimum_distinct_answers) {
      Object.assign(ai, { status:'ready', probability:latest.forecast.probability,
        recorded_at:new Date(latest.recorded).toISOString(), as_of:new Date(latest.asof).toISOString(),
        source_attempt_id:latest.attempt.attempt_id,
        message:`AI LightGBM V2 dự báo xác suất trả lời đúng lượt tiếp theo: ${(latest.forecast.probability * 100).toFixed(1)}%.` });
    } else if (part.answered > 0) {
      ai.status = latest ? 'insufficient_data' : 'not_recorded';
      if (latest) ai.message = 'Đã có dự đoán AI nhưng chưa đủ 10 câu trả lời lần đầu để xếp hạng năng lực Part này.';
    }
    return { ...part, ai };
  });
  const evaluation = evaluateAiCompetency(overview, parts);
  return { ...overview, profile_version:'part_assessment_v1', parts,
    recommendations: evaluation.recommendations,
    summary: evaluation.summary,
    ai_ranking: {
      order_low_to_high: evaluation.compare,
      weakest_part: evaluation.hasRelativeSpread && evaluation.lowestParts.length === 1 ? evaluation.lowestParts[0].part : null,
      strongest_part: evaluation.hasRelativeSpread && evaluation.highestParts.length === 1 ? evaluation.highestParts[0].part : null,
    },
    source:{mode:'live_readonly',as_of:new Date(cutoff).toISOString()},
    policy:{method:'lightgbm_v2_with_evidence_gate',ai_validation_status:'validated_on_riiid_and_app_pilot',
      strength_weakness_enabled:evaluation.hasRelativeSpread,inference_called:false,
      recommendation_method:evaluation.aiDrivenRecommendations ? 'lightgbm_v2_priority' : 'descriptive_rules',
      note:'Đánh giá năng lực tương đối và gợi ý ôn tập theo 7 Part bằng LightGBM V2 trên các Part đạt tối thiểu 10 câu trả lời lần đầu.'} };
}
module.exports = { attachPartAssessment, evaluateAiCompetency, v2Hash };
