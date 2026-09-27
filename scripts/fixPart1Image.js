const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db');

(async () => {
  const client = await pool.connect();
  try {
    const q = await client.query(
      `SELECT q.question_id, q.image_url, lm.audio_url
       FROM questions q LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
       WHERE q.question_type='listening' AND q.part_number=1
         AND q.image_url IS NOT NULL AND q.image_url NOT LIKE '/uploads/%'
         AND lm.audio_url IS NOT NULL
       ORDER BY q.created_at DESC, q.question_id DESC LIMIT 1`
    );
    const row = q.rows[0];
    if (!row) { console.log('no part1 question'); process.exit(0); }
    const base = String(row.audio_url).split('/audio/')[0];
    const rel = String(row.image_url).replace(/^[\\/]+/, '');
    let newUrl = `${base}/${rel}`;
    const { importsDir } = require('../src/middlewares/upload');
    const fs = require('fs');
    const tryPath = (u) => {
      const abs = path.join(importsDir, u.replace(/^\/uploads\/imports\//,''));
      console.log('TRY', abs);
      return fs.existsSync(abs);
    };
    if (!tryPath(newUrl)) {
      const pngUrl = newUrl.replace(/\.jpg$/i, '.png');
      console.log('TRY PNG', pngUrl);
      if (tryPath(pngUrl)) newUrl = pngUrl;
    }
    await client.query(`UPDATE questions SET image_url=$1 WHERE question_id=$2`, [newUrl, row.question_id]);
    console.log(JSON.stringify({ question_id: row.question_id, image_url: newUrl }));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
  }
})();