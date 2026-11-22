const fs = require('node:fs'), path = require('node:path'), pool = require('../db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations/20261105_question_predictions.sql'), 'utf8'));
    console.log('Question observation migration applied; existing attempts unchanged.');
  } finally { await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
