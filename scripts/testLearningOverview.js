const test = require('node:test'), assert = require('node:assert/strict');
const { buildLearningOverview } = require('../src/modules/ai/learningOverview');
function row(question, part = 5, correct = true, attempt = 1, options = {}) {
  return { question_id: question, attempt_id: attempt, position: question,
    end_time: `2026-11-${String(attempt).padStart(2, '0')}T01:00:00Z`,
    user_answer: correct === null ? null : correct ? 'A' : 'B',
    question_snapshot: { part_number: part, question_text: `Question ${question}`, correct_answer: 'A',
      choices: ['A','B','C','D'].map(choice_label=>({choice_label,choice_text:choice_label})), ...options } };
}

test('empty and blank history have no fabricated rates or weak-Part claims', () => {
  const empty = buildLearningOverview([]);
  assert.equal(empty.status, 'insufficient_data'); assert.equal(empty.totals.correct_rate, null);
  assert.equal(empty.parts.length, 7);
  const blanks = buildLearningOverview([row(1, 5, null)]);
  assert.equal(blanks.totals.unanswered, 1); assert.equal(blanks.totals.first_answered, 0);
  assert.ok(blanks.recommendations.every(r => r.action === 'collect_evidence'));
});

test('repeated correct answers do not erase mistakes at first encounter', () => {
  const rows = [row(1, 5, false), row(1, 5, true, 2), row(1, 5, true, 3)];
  const result = buildLearningOverview(rows);
  assert.equal(result.totals.answered, 3); assert.equal(result.totals.correct, 2);
  assert.equal(result.totals.first_answered, 1); assert.equal(result.totals.first_correct, 0);
  assert.equal(result.totals.repeat_answers, 2); assert.equal(result.parts[4].evidence_status, 'small_sample');
  assert.equal(result.method, 'descriptive_rules');
});

test('review guidance uses observed first encounters and only available practice', () => {
  const rows = [...Array.from({ length: 10 }, (_, i) => row(i + 1, 5, i < 6)),
    ...Array.from({ length: 10 }, (_, i) => row(i + 11, 7, i < 2))];
  const result = buildLearningOverview(rows);
  assert.equal(result.recommendations[0].part, 7); assert.equal(result.recommendations[0].action, 'review_part');
  assert.equal(result.recommendations[1].part, 5);
  assert.equal(result.recommendations[2].action, 'collect_evidence');
  const restricted = buildLearningOverview(rows, [5]);
  assert.deepEqual(restricted.recommendations.map(r => r.part), [5]);
  const perfect = buildLearningOverview(Array.from({ length: 10 }, (_, i) => row(i + 1)), [5]);
  assert.equal(perfect.recommendations.length, 0);
});

test('one attempt never creates a time trend and repeated items do not become new evidence', () => {
  const first = Array.from({ length: 20 }, (_, i) => row(i + 1, 5, i >= 10));
  const repeats = first.map(r => ({ ...r, attempt_id: 2, end_time: '2026-11-02T01:00:00Z', user_answer: 'B' }));
  const part = buildLearningOverview([...repeats, ...first].reverse()).parts[4];
  assert.equal(part.repeat_answers, 20); assert.equal(part.first_answers.answered, 20);
  assert.equal(part.trend.status, 'insufficient_data');
  assert.equal(part.history_points.length, 2);
  assert.equal(part.history_points[1].first_answered, 0);
});

test('blank then answered is a first answer, edited content is separate and skill analysis is retired', () => {
  const label = { code: 'reading_detail', name: 'Đọc chi tiết' };
  const rows = [row(1, 7, null), row(1, 7, false, 2, { skills: [label, label] }),
    row(1, 7, true, 3, { question_text: 'Edited question', skills: [label] })];
  const result = buildLearningOverview(rows);
  assert.equal(result.totals.first_answered, 2); assert.equal(result.totals.unanswered, 1);
  assert.equal(result.skills, undefined);
  assert.equal(result.parts[6].distinct_question_versions, 2);
  assert.equal(buildLearningOverview([row(2)]).skills, undefined);
});

test('trend compares different completed attempts using first answers and exposes sample limitations', () => {
  const rows = [...Array.from({length:10},(_,i)=>row(i+1,5,false,1)),
    ...Array.from({length:10},(_,i)=>row(i+11,5,true,2))];
  const p = buildLearningOverview(rows).parts[4];
  assert.equal(p.trend.status,'descriptive_comparison');
  assert.equal(p.trend.previous_attempt_id,1); assert.equal(p.trend.recent_attempt_id,2);
  assert.equal(p.trend.delta_percentage_points,100); assert.equal(p.trend.small_sample,false);
  assert.equal(p.history_points[0].answered,10); assert.equal(p.history_points[1].correct,10);
  const sameTime=rows.map(r=>({...r,end_time:rows[0].end_time}));
  assert.equal(buildLearningOverview(sameTime).parts[4].trend.status,'insufficient_data');
});

test('old mistakes do not keep a Part prioritized after successful fresh-question practice', () => {
  const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, 5, i >= 20));
  const result = buildLearningOverview(rows, [5]);
  assert.equal(result.parts[4].first_answers.correct_rate, .5);
  assert.equal(result.parts[4].review_basis.correct_rate, 1);
  assert.equal(result.recommendations.length, 0);
});
