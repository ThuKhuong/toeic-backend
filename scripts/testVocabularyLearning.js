const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
const { selection, buildQuestions, gradeQuiz } = require('../src/modules/vocabulary/vocabularyLearningService');
const { wordInput } = require('../src/modules/vocabulary/vocabularyPersonalService');

test('personal word validation requires word/meaning and never accepts an owner from the body', () => {
  const data = wordInput({ word: ' invoice ', meaning_vi: ' hóa đơn ', owner_user_id: 99, topic_id: '2' });
  assert.equal(data.word, 'invoice');
  assert.equal(data.meaning_vi, 'hóa đơn');
  assert.equal(data.topic_id, 2);
  assert.equal('owner_user_id' in data, false);
  for (const body of [{}, { word: ' ', meaning_vi: 'test' }, { word: 'word', meaning_vi: '' },
    { word: 123, meaning_vi: 'test' }, { word: 'word', meaning_vi: 'test', topic_id: [1] },
    { word: 'word', meaning_vi: 'test', pronunciation: 'x'.repeat(256) }]) {
    assert.throws(() => wordInput(body), error => error.status === 400);
  }
});

test('selection bounds IDs/count and normalizes an explicit-word resume scope', () => {
  assert.equal(selection({ scope: 'saved', topic_id: '2', vocab_ids: [3, 1, 3] }).key,
    selection({ scope: 'saved', topic_id: 2, vocab_ids: [1, 3] }).key);
  for (const body of [{ count: 21 }, { count: 0 }, { topic_id: -1 }, { scope: 'someone_else' },
    { vocab_ids: [] }, { vocab_ids: [1.5] }, { vocab_ids: [true] }, { vocab_ids: [[1]] },
    { vocab_ids: [2147483648] }, { unassigned: 'true' }, { unassigned: true, topic_id: 1 }]) {
    assert.throws(() => selection(body), error => error.status === 400);
  }
});

test('quiz choices stay unique with repeated meanings and a small library', () => {
  const words = [{ vocab_id: 1, word: 'office', meaning_vi: 'văn phòng' }];
  const dictionary = [...words, { meaning_vi: 'văn phòng' }, { meaning_vi: 'hợp đồng' }];
  for (let i = 0; i < 30; i++) {
    const [question] = buildQuestions(words, dictionary);
    assert.equal(question.choices.length, 2);
    assert.equal(new Set(question.choices.map(choice => choice.text)).size, 2);
    assert.equal(question.choices.find(choice => choice.label === question.correct_label).text, 'văn phòng');
  }
  assert.deepEqual(buildQuestions(words, words), []);
});

test('server grades from its snapshot, includes blanks and rejects unknown/duplicate answers', () => {
  const questions = [1, 2, 3].map(vocab_id => ({ vocab_id, word: 'word', correct_label: 'B',
    choices: [{ label: 'A', text: 'first' }, { label: 'B', text: 'second' }] }));
  const result = gradeQuiz(questions, [{ vocab_id: 1, selected_label: 'B', is_correct: false },
    { vocab_id: 2, selected_label: 'A', correct_label: 'A', is_correct: true }]);
  assert.equal(result.correct, 1);
  assert.equal(result.total, 3);
  assert.equal(result.details[2].is_correct, false);
  assert.equal(result.details[2].selected_label, null);
  for (const answers of [null, [{ vocab_id: 4, selected_label: 'A' }],
    [{ vocab_id: 1, selected_label: 'Z' }], [{ vocab_id: 1 }, { vocab_id: 1 }]]) {
    assert.throws(() => gradeQuiz(questions, answers), error => error.status === 400);
  }
});
