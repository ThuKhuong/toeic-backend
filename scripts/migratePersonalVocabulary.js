const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
(async () => {
  try {
    for (const name of ['20261103_vocabulary_learning.sql', '20261103_personal_vocabulary.sql']) {
      await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations', name), 'utf8'));
    }
    console.log('Personal vocabulary migration applied. Legacy content retained.');
  } finally { await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
