const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../db');
const { importsDir } = require('../src/middlewares/upload');

const toPublic = (abs) => {
  const rel = path.relative(importsDir.replace(/\\$/,''), abs).replace(/\\/g, '/');
  return `/uploads/imports/${rel}`;
};

const findPath = (relPath) => {
  const rootDirs = fs.existsSync(importsDir) ? fs.readdirSync(importsDir) : [];
  const target = String(relPath).replace(/\\/g, '/');
  for (const dirName of rootDirs) {
    const baseDir = path.join(importsDir, dirName);
    const stack = [baseDir];
    while (stack.length) {
      const d = stack.pop();
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else {
          const pn = p.replace(/\\/g, '/');
          if (pn.endsWith(target)) return toPublic(p);
        }
      }
    }
  }
  return null;
};

console.log('RUNNING FIX MEDIA SCRIPT');
(async () => {
  const client = await pool.connect();
  try {
    const qres = await client.query(
      `SELECT q.question_id, q.image_url, lm.audio_url
       FROM questions q
       LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
       WHERE q.question_type='listening' AND q.image_url IS NOT NULL AND q.image_url NOT LIKE '/uploads/%'`
    );
    const mres = await client.query(
      `SELECT material_id, audio_url FROM listening_materials WHERE audio_url IS NOT NULL AND audio_url NOT LIKE '/uploads/%'`
    );

    await client.query('BEGIN');
    let uq = 0, um = 0;
    for (const row of qres.rows) {
      let resolved = null;
      if (row.audio_url) {
        const audioUrlNorm = String(row.audio_url).replace(/\\/g, '/');
        const base = audioUrlNorm.split('/audio/')[0];
        const candidate = `${base}/${String(row.image_url).replace(/^[\\/]+/, '')}`;
        const absCandidate = path.join(importsDir, candidate.replace(/^\/uploads\/imports\//, ''));
        if (fs.existsSync(absCandidate)) resolved = candidate;
      }
      if (!resolved) {
        resolved = findPath(row.image_url);
      }
      if (resolved) {
        await client.query(`UPDATE questions SET image_url=$1 WHERE question_id=$2`, [resolved, row.question_id]);
        uq++;
      }
    }
    for (const row of mres.rows) {
      const resolved = findPath(row.audio_url);
      if (resolved) {
        await client.query(`UPDATE listening_materials SET audio_url=$1 WHERE material_id=$2`, [resolved, row.material_id]);
        um++;
      }
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ updated_questions: uq, updated_materials: um }));
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
  }
})();