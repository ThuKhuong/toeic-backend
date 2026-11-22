const fs=require('node:fs');
const path=require('node:path');
const pool=require('../db');
(async()=>{
  try {await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations/20261105_passage_review.sql'),'utf8'));console.log('Passage review migration applied.');}
  finally {await pool.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
