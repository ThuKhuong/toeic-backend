const {toeicEstimate} = require('./toeicEstimate');

function gradeAttempt(answers) {
  const parts = new Map();
  const total = { total: 0, answered: 0, correct: 0, incorrect: 0, unanswered: 0 };
  const percentage = (correct, count) => count ? Math.round(correct * 100 / count) : 0;
  for (const row of answers) {
    const question = row.question_snapshot || row;
    const part = Number(question.part_number);
    if (!parts.has(part)) parts.set(part, { part_number: part, total: 0, answered: 0, correct: 0, incorrect: 0, unanswered: 0 });
    const answered = row.user_answer != null && String(row.user_answer).trim() !== '';
    const correct = answered && row.user_answer === question.correct_answer;
    for (const stats of [total, parts.get(part)]) {
      stats.total++;
      if (!answered) stats.unanswered++;
      else { stats.answered++; if (correct) stats.correct++; else stats.incorrect++; }
    }
  }
  const sections = [['listening', [1,2,3,4]], ['reading', [5,6,7]]].map(([section, numbers]) => {
    const stats = { section, total: 0, answered: 0, correct: 0, incorrect: 0, unanswered: 0 };
    for (const number of numbers) {
      const part = parts.get(number);
      if (part) for (const key of ['total','answered','correct','incorrect','unanswered']) stats[key] += part[key];
    }
    return { ...stats, score: percentage(stats.correct, stats.total), max_score: 100 };
  }).filter(stats => stats.total > 0);
  return {
    ...total, score: percentage(total.correct, total.total), max_score: 100,
    scoring_method: 'percentage',
    parts: [...parts.values()].sort((a,b) => a.part_number - b.part_number).map(stats => ({ ...stats, score: percentage(stats.correct, stats.total), max_score: 100 })),
    sections,
    toeic: toeicEstimate([...parts.values()]),
  };
}

module.exports = { gradeAttempt };
