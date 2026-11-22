// Adversarial fixtures in memory only. No database connection or persistent learner data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { graphFor, matchTest, qualityFor } = require('./planToeicSync');

function fixture() {
  const t = { test_id: 1, test_name: 'TOEIC test', parts: [5], publication_status: 'published', is_active: true, deleted_at: null, total_questions: 1 };
  const q = { question_id: 10, test_id: 1, part_number: 5, order_in_test: 1, source_set: 'SOURCE', source_question_number: 101,
    question_text: 'RAM_ONLY', correct_answer: 'A', group_id: null, material_id: null, passage_id: null };
  return { tests: [t], questions: [q], answer_choices: [...'ABCD'].map((choice_label, i) => ({ choice_id: i + 1, question_id: 10,
    choice_label, choice_text: 'RAM_ONLY_' + choice_label, is_correct: choice_label === 'A' })),
  question_groups: [], listening_materials: [], reading_passages: [], question_group_passages: [], question_skills: [], skills: [] };
}

test('same numeric ID with another test identity is a collision, never an existing match', () => {
  const s = fixture(), d = fixture(); d.tests[0].test_name = 'Another test';
  const result = matchTest(s.tests[0], s, d);
  assert.equal(result.status, 'missing_test'); assert.equal(result.source_id_collision, true);
});

test('duplicate matching names/Parts do not trigger another test creation', () => {
  const s = fixture(), d = fixture(); d.tests.push({ ...d.tests[0], test_id: 2 });
  assert.equal(matchTest(s.tests[0], s, d).status, 'ambiguous_existing_tests');
});

test('provenance-only differences are reported while content/order remain identical', () => {
  const s = fixture(), d = fixture(); d.questions[0].source_set = 'DEV_OLD'; d.questions[0].source_question_number = null;
  const result = matchTest(s.tests[0], s, d);
  assert.equal(result.status, 'present_content_equal_keep_dev_metadata');
  assert.equal(result.content_choices_media_and_order_equal, true);
  assert.deepEqual(Object.keys(result.provenance_differences_to_preserve[0].changes), ['source_set', 'source_question_number']);
  assert.equal(d.questions[0].source_set, 'DEV_OLD');
});

test('answer-key, sequence and publication changes cannot be dismissed as provenance', () => {
  for (const change of [d => { d.questions[0].correct_answer = 'B'; }, d => { d.questions[0].order_in_test = 2; }, d => { d.tests[0].publication_status = 'draft'; }]) {
    const s = fixture(), d = fixture(); change(d);
    assert.equal(matchTest(s.tests[0], s, d).status, 'present_requires_review');
  }
});

test('multi-passage graph includes indirect passages and preserves relation positions', () => {
  const d = fixture(); d.questions[0].part_number = 7; d.questions[0].group_id = 20; d.questions[0].passage_id = 30;
  d.question_groups.push({ group_id: 20, part_number: 7 });
  d.reading_passages.push({ passage_id: 30, image_url: '/uploads/RAM_A.png' }, { passage_id: 31, image_url: '/uploads/RAM_B.png' });
  d.question_group_passages.push({ group_id: 20, passage_id: 30, position: 1 }, { group_id: 20, passage_id: 31, position: 2 });
  const graph = graphFor(d, d.questions);
  assert.deepEqual(graph.reading_passages.map(p => p.passage_id), [30, 31]);
  assert.deepEqual(graph.question_group_passages.map(p => p.position), [1, 2]);
});

test('structural checks reject Part 2 choice D, mismatched key and missing reading material', () => {
  const d = fixture(); d.tests[0].parts = [2]; d.questions[0].part_number = 2;
  assert.ok(qualityFor(d.tests[0], d).issues.some(i => i.code === 'invalid_choices_or_key'));
  d.tests[0].parts = [7]; d.questions[0].part_number = 7;
  assert.ok(qualityFor(d.tests[0], d).issues.some(i => i.code === 'missing_reading_content'));
  d.tests[0].parts = [5]; d.questions[0].part_number = 5; d.questions[0].correct_answer = 'B';
  assert.ok(qualityFor(d.tests[0], d).issues.some(i => i.code === 'invalid_choices_or_key'));
});

test('reading screenshots are valid content; blank text does not discard image passages', () => {
  const d = fixture(); d.tests[0].parts = [7]; d.questions[0].part_number = 7; d.questions[0].passage_id = 30;
  d.reading_passages.push({ passage_id: 30, content: '', image_url: '/uploads/RAM_A.png' });
  assert.deepEqual(qualityFor(d.tests[0], d).issues, []);
});
