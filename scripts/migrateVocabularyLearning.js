const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');

(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations/20261103_vocabulary_learning.sql'), 'utf8'));
    console.log('Vocabulary learning migration applied. Existing vocabulary retained.');
  } finally {
    await pool.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
