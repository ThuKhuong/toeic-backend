// The TOEIC API remains available when optional model services are unavailable.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function readModelMetadata(aiRoot, observeQuestions) {
  const v2 = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(aiRoot, 'models/v2/lightgbm_v2.joblib'))).digest('hex');
  let v3;
  if (observeQuestions) {
    try {
      v3 = JSON.parse(fs.readFileSync(path.join(aiRoot, 'models/v3_app_shadow/manifest.json'), 'utf8')).artifact_sha256;
    } catch { /* A missing research artifact must not prevent the primary API. */ }
  }
  return { v2, v3 };
}

function startRuntime(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const aiRoot = path.resolve(__dirname, '../../toeic-ai');
  const python = env.AI_PYTHON || path.join(aiRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const url = (env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const observeQuestions = env.AI_QUESTION_SHADOW_ENABLED !== '0';
  const fetchImpl = options.fetchImpl || fetch;
  const spawnImpl = options.spawnImpl || spawn;
  const exists = options.exists || fs.existsSync;
  const metadata = options.readModelMetadata || (() => readModelMetadata(aiRoot, observeQuestions));
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const signals = options.signals || process;
  const exit = options.exit || (code => process.exit(code));
  const scheduleExit = options.scheduleExit || ((callback, ms) => setTimeout(callback, ms).unref());
  let child, stopping = false, childExited = false, launchError;

  // Listen before checking Python, files, or health. Grading and event capture do
  // not depend on inference being available, including during Python startup.
  const server = (options.createServer || (() => require('../server')))().listen(env.PORT || 3000);
  server.once('listening', () => logger.log(`TOEIC backend ready: API port ${env.PORT || 3000}; AI is optional.`));

  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    signals.removeListener('SIGINT', onInterrupt);
    signals.removeListener('SIGTERM', onInterrupt);
    server.close();
    // Never terminate an AI service reused from another launcher/session.
    if (child && !childExited) child.kill();
    scheduleExit(() => exit(code), 500);
  }
  const onInterrupt = () => stop(0);
  signals.once('SIGINT', onInterrupt);
  signals.once('SIGTERM', onInterrupt);
  server.on('error', error => {
    logger.error(error.message);
    stop(1);
  });

  async function health(expected) {
    try {
      const response = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      let data;
      try { data = await response.json(); } catch { return { reachable: true, ready: false }; }
      return {
        reachable: true,
        ready: response.ok && data.model === 'lightgbm_v2' && data.artifact_sha256 === expected.v2,
        shadowReady: Boolean(expected.v3 && data.question_model?.status === 'ready'
          && data.question_model.artifact_sha256 === expected.v3),
      };
    } catch { return { reachable: false, ready: false }; }
  }

  function ready(status) {
    logger.log('LightGBM v2 available as an experimental Part-performance signal; educational validation is still required.');
    if (observeQuestions && !status.shadowReady) {
      logger.warn('V3 shadow is enabled but unavailable or has a different artifact. The TOEIC API remains available.');
    }
    return { status: 'ready', shadow: observeQuestions ? (status.shadowReady ? 'ready' : 'unavailable') : 'disabled' };
  }

  const aiReady = (async () => {
    try {
      const expected = metadata();
      let status = await health(expected);
      if (stopping) return { status: 'stopped' };
      if (status.ready) return ready(status);
      if (status.reachable) throw Error('Existing AI service is not the expected v2 artifact; no second Python process was started.');
      if (!['http://127.0.0.1:8000', 'http://localhost:8000'].includes(url)) {
        throw Error('Configured external AI service is unavailable; start that service separately.');
      }
      if (!exists(python)) throw Error('Python environment unavailable. Configure AI_PYTHON or toeic-ai/.venv.');
      child = spawnImpl(python, ['-m', 'uvicorn', 'api:app', '--app-dir', 'src', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: aiRoot, stdio: 'inherit', windowsHide: true,
        env: { ...env, AI_QUESTION_SHADOW_ENABLED: observeQuestions ? '1' : '0' },
      });
      child.on('error', error => { launchError = error; });
      child.on('exit', () => {
        childExited = true;
        if (!stopping) logger.warn('AI process stopped. TOEIC tests, grading and event collection remain available.');
      });
      const deadline = now() + 30000;
      while (!stopping) {
        if (launchError || childExited || child.exitCode != null || now() >= deadline) {
          throw Error('AI startup did not complete; check Python and port 8000. The backend continues without AI.');
        }
        status = await health(expected);
        if (status.ready) return ready(status);
        await delay(500);
      }
      return { status: 'stopped' };
    } catch (error) {
      logger.warn(`AI unavailable: ${error.message} Tests, answers and Learning Events are still served.`);
      // A child started by this launcher may have stalled during startup.
      if (child && !childExited) child.kill();
      return { status: 'unavailable' };
    }
  })();

  return { server, aiReady, stop };
}

function run() {
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  process.chdir(path.join(__dirname, '..'));
  return startRuntime();
}

module.exports = { startRuntime, run };
if (require.main === module) run();
