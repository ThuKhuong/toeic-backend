const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations/20261025_test_soft_delete.sql'), 'utf8'));
    console.log('Test soft-delete migration applied. Existing tests and attempts retained.');
  } finally { await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
