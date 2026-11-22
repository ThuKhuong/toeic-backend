const VERSION = 'attempt_feedback_v1';

function buildFeedback(grading) {
  const parts = grading.parts.filter(p => p.total > 0).map(p => ({
    part: p.part_number, total: p.total, answered: p.answered,
    correct: p.correct, incorrect: p.incorrect, unanswered: p.unanswered,
    correct_rate: p.correct / p.total,
    message: `Part ${p.part_number}: đúng ${p.correct}/${p.total} câu, sai ${p.incorrect} câu, bỏ trống ${p.unanswered} câu.` +
      (p.answered === 0 ? ' Chưa có câu trả lời để nhận xét khả năng làm Part này.' :
        p.correct === p.total ? ' Bạn đã trả lời đúng toàn bộ câu trong Part này của bài.' :
          ' Hãy xem lời giải các câu sai' + (p.unanswered ? ' và làm lại các câu bỏ trống.' : '.')),
  }));
  const candidates = parts.filter(p => p.answered > 0 && p.correct < p.total)
    .sort((a,b) => a.correct_rate-b.correct_rate || b.incorrect-a.incorrect || a.part-b.part);
  const lowest = candidates[0];
  const tied = lowest ? parts.filter(p => p.answered > 0 && p.correct_rate === lowest.correct_rate) : [];
  const summary = grading.answered === 0
    ? 'Bạn chưa trả lời câu nào trong bài này. Hãy làm một bài luyện để có kết quả nhận xét.'
    : grading.correct === grading.total
      ? 'Bạn đã trả lời đúng toàn bộ câu trong bài này. Hãy luyện thêm các đề khác để kiểm tra kết quả trên nhiều câu hỏi.'
      : !lowest
        ? 'Bạn đã trả lời đúng các câu đã làm; bài vẫn còn câu bỏ trống. Hãy làm lại các câu này để có thêm kết quả nhận xét.'
      : lowest && parts.filter(p=>p.answered>0).length > 1 && tied.length === 1
        ? `Trong các Part bạn đã trả lời ở bài này, Part ${lowest.part} có tỷ lệ đúng thấp nhất (${lowest.correct}/${lowest.total} câu). Bạn có thể ưu tiên xem lại và luyện thêm Part này.`
        : 'Hãy xem lại các câu sai và bỏ trống trong bài này, sau đó luyện thêm các Part bên dưới.';
  return {
    version: VERSION, method: 'descriptive_rules', scope: 'current_attempt',
    status: grading.answered ? 'ready' : 'insufficient_data',
    created_at: new Date().toISOString(), summary, parts,
    evidence: {total:grading.total, answered:grading.answered, correct:grading.correct, incorrect:grading.incorrect, unanswered:grading.unanswered},
    recommendations: candidates.slice(0,3).map(p=>({part:p.part,label:`Luyện thêm Part ${p.part}`,reason:`Đúng ${p.correct}/${p.total} câu; sai ${p.incorrect}, bỏ trống ${p.unanswered}.`})),
    limitation: 'Nhận xét chỉ mô tả bài vừa nộp, dựa trên số câu hiển thị. Số câu và độ khó giữa các Part có thể khác nhau; đây không phải kết luận năng lực, dự đoán LightGBM hay điểm TOEIC chính thức.',
  };
}

function withFeedback(grading) {
  if (grading.feedback) return grading;
  try { return {...grading,feedback:buildFeedback(grading)}; }
  catch { return {...grading,feedback:{version:VERSION,status:'unavailable',method:'descriptive_rules',scope:'current_attempt',summary:'Kết quả bài làm đã được lưu. Chưa tạo được nhận xét.',parts:[],recommendations:[]}}; }
}
module.exports = {buildFeedback,withFeedback};
