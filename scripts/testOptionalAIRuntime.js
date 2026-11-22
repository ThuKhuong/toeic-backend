// Dependency-injected launch tests: no database, model inference or child process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startRuntime } = require('./startWithAI');

const response = (overrides = {}) => ({ ok: true, json: async () => ({
  model: 'lightgbm_v2', artifact_sha256: 'v2',
  question_model: { status: 'ready', artifact_sha256: 'v3' }, ...overrides,
}) });
const offline = async () => { throw Error('fixture unavailable'); };

function fixture(overrides = {}) {
  const server = new EventEmitter(), child = new EventEmitter(), signals = new EventEmitter();
  const state = { listens: 0, closes: 0, spawns: 0, kills: 0, exits: [], messages: [] };
  server.close = () => { state.closes++; };
  child.exitCode = null;
  child.kill = () => { state.kills++; child.exitCode = 0; child.emit('exit', 0); };
  const options = {
    env: { PORT: '3000', AI_QUESTION_SHADOW_ENABLED: '1' },
    createServer: () => ({ listen: port => { state.listens++; state.port = port; return server; } }),
    readModelMetadata: () => ({ v2: 'v2', v3: 'v3' }),
    fetchImpl: async () => response(),
    exists: () => true,
    spawnImpl: (...args) => { state.spawns++; state.spawnArgs = args; return child; },
    delay: async () => {},
    now: () => 0,
    signals,
    logger: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, message => state.messages.push(message)])),
    scheduleExit: callback => callback(),
    exit: code => state.exits.push(code),
    ...overrides,
  };
  const runtime = startRuntime(options);
  return { runtime, server, child, signals, state };
}

test('API listens before a pending AI health check; stopping never starts Python later', async () => {
  let resolveHealth;
  const f = fixture({ fetchImpl: () => new Promise(resolve => { resolveHealth = resolve; }) });
  assert.equal(f.state.listens, 1);
  assert.equal(f.state.closes, 0);
  f.signals.emit('SIGINT');
  resolveHealth(response());
  assert.deepEqual(await f.runtime.aiReady, { status: 'stopped' });
  assert.equal(f.state.spawns, 0);
});

test('missing primary artifact leaves tests/API running without unhandled rejection', async () => {
  const f = fixture({ readModelMetadata: () => { throw Error('fixture missing artifact'); } });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.spawns, 0);
  assert.deepEqual(f.state.exits, []);
  f.runtime.stop();
});

test('correct existing v2 is reused even when experimental v3 is unavailable', async () => {
  const f = fixture({ fetchImpl: async () => response({ question_model: { status: 'unavailable' } }) });
  assert.deepEqual(await f.runtime.aiReady, { status: 'ready', shadow: 'unavailable' });
  assert.equal(f.state.spawns, 0);
  f.signals.emit('SIGINT');
  assert.equal(f.state.kills, 0);
  assert.equal(f.state.closes, 1);
});

test('reachable incompatible AI is not replaced or killed', async () => {
  const f = fixture({ fetchImpl: async () => response({ artifact_sha256: 'unexpected' }) });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.spawns, 0);
  assert.equal(f.state.closes, 0);
  f.runtime.stop();
  assert.equal(f.state.kills, 0);
});

test('non-JSON service on AI port does not trigger a second Python process', async () => {
  const f = fixture({ fetchImpl: async () => ({ ok: false, json: async () => { throw Error('not JSON'); } }) });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.spawns, 0);
  f.runtime.stop();
});

test('missing Python environment never closes the backend', async () => {
  const f = fixture({ fetchImpl: offline, exists: () => false });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.spawns, 0);
  assert.equal(f.state.closes, 0);
  f.runtime.stop();
});

test('unreachable external AI is not launched locally', async () => {
  const f = fixture({ env: { AI_SERVICE_URL: 'http://ai.example.invalid:8000' }, fetchImpl: offline });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.spawns, 0);
  assert.equal(f.state.closes, 0);
  f.runtime.stop();
});

test('Python spawn error is handled and does not close or exit the backend', async () => {
  const f = fixture({ fetchImpl: offline, delay: async () => f.child.emit('error', Error('fixture spawn error')) });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.spawns, 1);
  assert.equal(f.state.closes, 0);
  assert.deepEqual(f.state.exits, []);
  assert.equal(f.state.spawnArgs[2].windowsHide, true);
  assert.equal(f.state.spawnArgs[2].env.AI_QUESTION_SHADOW_ENABLED, '1');
  f.runtime.stop();
});

test('Python exiting before readiness is handled without stopping the backend', async () => {
  const f = fixture({ fetchImpl: offline, delay: async () => f.child.emit('exit', 1) });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.kills, 0);
  f.runtime.stop();
});

test('a stalled child is killed after bounded startup, while API stays running', async () => {
  let clock = 0;
  const f = fixture({ fetchImpl: offline, now: () => clock, delay: async () => { clock += 10000; } });
  assert.equal((await f.runtime.aiReady).status, 'unavailable');
  assert.equal(f.state.spawns, 1);
  assert.equal(f.state.kills, 1);
  assert.equal(f.state.closes, 0);
  f.runtime.stop();
  assert.equal(f.state.kills, 1);
});

test('successful local startup owns one hidden child; SIGINT closes it only once', async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async () => { if (calls++ === 0) return offline(); return response(); } });
  assert.deepEqual(await f.runtime.aiReady, { status: 'ready', shadow: 'ready' });
  assert.equal(f.state.spawns, 1);
  f.signals.emit('SIGINT');
  f.runtime.stop();
  assert.equal(f.state.kills, 1);
  assert.equal(f.state.closes, 1);
  assert.deepEqual(f.state.exits, [0]);
});

test('shadow disabled explicitly does not require v3 readiness', async () => {
  const f = fixture({ env: { AI_QUESTION_SHADOW_ENABLED: '0' }, fetchImpl: async () => response({ question_model: { status: 'disabled' } }) });
  assert.deepEqual(await f.runtime.aiReady, { status: 'ready', shadow: 'disabled' });
  assert.equal(f.state.spawns, 0);
  f.runtime.stop();
});

test('backend port failure exits launcher but never kills reused AI', async () => {
  const f = fixture();
  await f.runtime.aiReady;
  f.server.emit('error', Error('listen EADDRINUSE'));
  assert.equal(f.state.kills, 0);
  assert.deepEqual(f.state.exits, [1]);
});

test('AI stopping after readiness only warns; no unhandled child error or API shutdown', async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async () => { if (calls++ === 0) return offline(); return response(); } });
  await f.runtime.aiReady;
  f.child.emit('error', Error('fixture later error'));
  f.child.emit('exit', 1);
  assert.equal(f.state.closes, 0);
  assert.deepEqual(f.state.exits, []);
  f.runtime.stop();
});
