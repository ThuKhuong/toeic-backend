// Restore a pre-migration backup into a NEW guarded restore database, never over any existing database.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const dev=require('./learningDevEnvironment');
(async()=>{
 const metadata=JSON.parse(fs.readFileSync(path.join(dev.reportRoot,'toeic_learning_events_dev_migration.json'),'utf8'));
 const backup=path.resolve(__dirname,'../..',metadata.backup_path);
 const target='toeic_learning_events_restore_'+randomUUID().replaceAll('-','').slice(0,12);
 if(!/^toeic_learning_events_restore_[a-f0-9]{12}$/.test(target)||target===process.env.DB_NAME)throw Error('Invalid restore target');
 const admin=await dev.connect('postgres');
 try {
   if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[target])).rowCount)throw Error('Restore target already exists; refusing to overwrite');
   await admin.query(`CREATE DATABASE "${target}"`);
   await admin.query(`COMMENT ON DATABASE "${target}" IS 'TOEIC_LEARNING_EVENTS_BACKUP_RESTORE_TEST'`);
 }finally{await admin.end();}
 execFileSync(dev.pgTool('pg_restore'),['-h',dev.base.host,'-p',String(dev.base.port),'-U',dev.base.user,'-d',target,'--no-owner','--no-privileges','--exit-on-error',backup],
   {env:{...process.env,PGPASSWORD:dev.base.password},windowsHide:true,stdio:'pipe'});
 const c=await dev.connect(target);
 try{
   const result=(await c.query(`SELECT (SELECT COUNT(*)::integer FROM questions) AS questions,
     (SELECT COUNT(*)::integer FROM "User") AS users,(SELECT COUNT(*)::integer FROM user_test_attempts) AS attempts,
     to_regclass('public.learning_events') AS learning_events`)).rows[0];
   if(!metadata.backup_counts||['questions','users','attempts'].some(k=>result[k]!==metadata.backup_counts[k])||!!result.learning_events!==metadata.pre_migration_learning_events_present)throw Error('Restored baseline does not match the backed-up dev data');
   fs.writeFileSync(path.join(dev.reportRoot,'backup_restore_result.json'),JSON.stringify({status:'PASS',target,backup:metadata.backup_path,result,at:new Date().toISOString()},null,2)+'\n');
   console.log(JSON.stringify({status:'PASS',target,...result}));
 }finally{await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
