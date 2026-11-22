const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPredictor } = require('./legacy/v2PredictionPreview');
const options = {
  baseUrl: 'http://127.0.0.1:8000',
  pool: { query: async (sql, params) => {
    assert.deepEqual(params, [2]);
    return { rows: [{ part: 1, answered_count: 4, correct_count: 3 }, { part: 5, answered_count: 1, correct_count: 1 }] };
  } },
};
test('sends total and Part history, not user identity, to Python', async () => {
  const predict = createPredictor({ ...options, fetchImpl: async (url, request) => {
    assert.equal(url, 'http://127.0.0.1:8000/predict');
    assert.deepEqual(JSON.parse(request.body), { part: 5, answered_count: 5, correct_count: 4, part_answered_count: 1, part_correct_count: 1 });
    return { ok: true, json: async () => ({ part: 5, model: 'lightgbm_v2', probability: 0.6 }) };
  } });
  assert.equal((await predict(2, 5)).probability, 0.6);
});
test('rejects invalid Part and does not predict without Part history', async () => {
  const predict = createPredictor({ ...options, fetchImpl: async () => { throw new Error('Must not call Python'); } });
  await assert.rejects(predict(2, '5'), { status: 400 });
  assert.equal((await predict(2, 7)).status, 'insufficient_data');
});
test('handles unavailable service and invalid model responses', async () => {
  await assert.rejects(createPredictor({ ...options, fetchImpl: async () => { throw new Error('offline'); } })(2, 5), { status: 503 });
  await assert.rejects(createPredictor({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ part: 5, model: 'lightgbm_v2', probability: 2 }) }) })(2, 5), { status: 502 });
});
