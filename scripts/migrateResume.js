const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations/20260926_resume_attempts.sql'),'utf8'));
    console.log('Resume migration applied. Existing attempts retained.');
  } finally { await pool.end(); }
})().catch(e=>{ console.error(e.message); process.exitCode=1; });
