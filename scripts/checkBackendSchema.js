// Static checks only: this script never connects to a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : full.endsWith('.js') ? [full] : [];
  });
}
const runtimeFiles = [path.join(root, 'server.js'), path.join(root, 'db.js'), ...files(path.join(root, 'src'))];
const removed = /\b(?:srscard|srs_reviews|study_sessions|achievements|user_achievements|total_xp|xp_earned|current_level|current_streak|longest_streak|target_score|daily_goal|learning_goals)\b/i;
for (const file of runtimeFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(removed.test(source), false, `Legacy database reference in ${path.relative(root, file)}`);
  for (const [, dependency] of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
    assert.doesNotThrow(() => require.resolve(path.resolve(path.dirname(file), dependency)), `Missing import ${dependency} in ${file}`);
  }
}
for (const folder of ['srs', 'gamification']) {
  const dir = path.join(root, 'src/modules', folder);
  assert.ok(!fs.existsSync(dir) || files(dir).length === 0, `Removed module still contains code: ${folder}`);
}
const schema = fs.readFileSync(path.join(root, 'database/toeic_learning_system.sql'), 'utf8');
assert.equal([...schema.matchAll(/CREATE TABLE\s/gi)].length, 22);
console.log(`PASS: syntax and local imports for ${runtimeFiles.length} backend files; no retired database references; current schema has 22 tables.`);

