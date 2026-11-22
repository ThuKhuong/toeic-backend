const fs=require('node:fs'),path=require('node:path'),pool=require('../db');
(async()=>{try{await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations/20261105_attempt_prediction.sql'),'utf8'));console.log('Attempt AI prediction migration applied.');}finally{await pool.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
