// Explicit development/test databases only. Never migrate the configured source database.
const {Client,Pool}=require('pg');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const base={user:process.env.DB_USER||'postgres',host:process.env.DB_HOST||'localhost',password:process.env.DB_PASS||'',port:process.env.DB_PORT||5432};
if(!['localhost','127.0.0.1','::1'].includes(base.host))throw Error('Development tooling requires a local PostgreSQL host; refusing remote environment');
const sourceName=process.env.DB_NAME||'toeic';
const marker='TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT';
const allowed=new Set(['toeic_learning_events_dev','toeic_learning_events_test']);
const schema=path.join(__dirname,'../database/toeic_learning_system.sql');
const migration=path.join(__dirname,'../database/migrations/20261114_learning_events.sql');
const reportRoot=path.resolve(__dirname,'../../toeic-ai/reports/learning_events_v1');
function safe(name){if(!allowed.has(name)||name===sourceName)throw Error('Refusing non-isolated database');}
function pgTool(name){
  if(process.platform!=='win32')return name;
  for(const v of ['15','17']){const file=`C:/Program Files/PostgreSQL/${v}/bin/${name}.exe`;if(fs.existsSync(file))return file;}
  throw Error('PostgreSQL backup utility unavailable');
}
async function connect(database){const c=new Client({...base,database});await c.connect();return c;}
async function fingerprintSource(){
  const c=await connect(sourceName);try{await c.query('BEGIN READ ONLY');const out={};
    for(const table of ['User','user_stats','user_test_attempts','user_answers','attempt_questions','questions','answer_choices','skills','question_skills']){
      const rows=(await c.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map(r=>r.row).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      out[table]={rows:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
    }await c.query('ROLLBACK');return out;
  }finally{await c.end();}
}
async function prepare(name){
 safe(name);fs.mkdirSync(reportRoot,{recursive:true});
 const admin=await connect('postgres');let fresh=false;
 try{
   const exists=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount;
   if(!exists){await admin.query(`CREATE DATABASE "${name}"`);await admin.query(`COMMENT ON DATABASE "${name}" IS '${marker}'`);fresh=true;}
   const comment=(await admin.query("SELECT shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",[name])).rows[0].comment;
   if(comment!==marker)throw Error('Database has no development marker; refusing migration');
 }finally{await admin.end();}
 const c=await connect(name);
 try{
   if(fresh)await c.query(fs.readFileSync(schema,'utf8'));
   if(fresh&&name.endsWith('_dev')) {
     const source=await connect(sourceName);
     try{
       await source.query('BEGIN READ ONLY');
       if(Number((await source.query('SELECT COUNT(*) AS n FROM questions WHERE vocab_id IS NOT NULL')).rows[0].n))throw Error('Question vocabulary dependencies require explicit copy design');
       await c.query('BEGIN');
       for(const table of ['listening_materials','reading_passages','tests','question_groups','questions','answer_choices','question_group_passages']) {
         const rows=(await source.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map(r=>{const row=r.row;if(table==='tests')row.created_by=null;return row;});
         if(rows.length)await c.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}",$1::jsonb)`,[JSON.stringify(rows)]);
       }
       await c.query('COMMIT');await source.query('ROLLBACK');
       // Seed content only; no accounts, passwords, learner answers or historical attempts copied.
       for(const table of ['listening_materials','reading_passages','tests','question_groups','questions','answer_choices']){
         const serial=(await c.query('SELECT pg_get_serial_sequence($1,$2) AS seq',[table,{tests:'test_id',questions:'question_id',answer_choices:'choice_id',question_groups:'group_id',listening_materials:'material_id',reading_passages:'passage_id'}[table]])).rows[0].seq;
         const id={tests:'test_id',questions:'question_id',answer_choices:'choice_id',question_groups:'group_id',listening_materials:'material_id',reading_passages:'passage_id'}[table];
         if(serial)await c.query(`SELECT setval($1,GREATEST(COALESCE(MAX(${id}),0),1),COUNT(*)>0) FROM ${table}`,[serial]);
       }
     }finally{await source.end();}
   }
   // Backup before the migration, independently restorable with pg_restore.
   const backup=path.join(reportRoot,`${name}_${Date.now()}_before.dump`);
   const preMigrationEvents=(await c.query("SELECT to_regclass('public.learning_events') AS t")).rows[0].t!==null;
   const backupCounts=(await c.query(`SELECT (SELECT COUNT(*)::integer FROM questions) AS questions,
     (SELECT COUNT(*)::integer FROM "User") AS users,(SELECT COUNT(*)::integer FROM user_test_attempts) AS attempts`)).rows[0];
   execFileSync(pgTool('pg_dump'),['-h',base.host,'-p',String(base.port),'-U',base.user,'-d',name,'-Fc','-f',backup],
     {env:{...process.env,PGPASSWORD:base.password},windowsHide:true,stdio:'pipe'});
   const sha256=crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
   await c.query(fs.readFileSync(migration,'utf8'));
   const result={database:name,fresh,backup_counts:backupCounts,pre_migration_learning_events_present:preMigrationEvents,backup_tool:pgTool('pg_dump'),backup_path:path.relative(path.resolve(__dirname,'../..'),backup).replaceAll('\\','/'),backup_sha256:sha256,
     migration_sha256:crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex'),
     migrated_at:(await c.query('SELECT current_timestamp::text AS t')).rows[0].t};
   fs.writeFileSync(path.join(reportRoot,`${name}_migration.json`),JSON.stringify(result,null,2)+'\n');return result;
 }finally{await c.end();}
}
module.exports={prepare,connect,fingerprintSource,reportRoot,safe,base,pgTool};
if(require.main===module)(async()=>{
 const out=await prepare(process.argv[2]);console.log(JSON.stringify(out));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
