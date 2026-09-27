const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname,'../database/migrations/20260924_import_batches.sql'),'utf8');
    await pool.query(sql);
    console.log('Import registry migration applied. Existing data unchanged.');
  } finally { await pool.end(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
