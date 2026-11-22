// Only data collection access: SELECT inside REPEATABLE READ READ ONLY, ROLLBACK.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const XLSX=require('xlsx');const {connect}=require('./learningDevEnvironment');
const {buildAssessment}=require('./legacy/assessment');
const root=path.resolve(__dirname,'../..');
function csv(name){const w=XLSX.readFile(path.join(root,'toeic-ai',name),{raw:true});return XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{defval:''});}
(async()=>{
 const c=await connect('toeic_learning_events_dev');let snap;
 try {
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='15s'");
  const context=(await c.query("SELECT current_database() AS database,extract(epoch FROM now())::float8*1000 AS cutoff_ms,current_setting('transaction_read_only') AS read_only,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker")).rows[0];
  if(context.marker!=='TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT'||context.read_only!=='on')throw Error('Not isolated readonly collection database');
  const users=(await c.query(`SELECT user_id,full_name FROM "User" WHERE role='STUDENT' ORDER BY user_id`)).rows;
  const attempts=(await c.query(`SELECT attempt_id,user_id,is_completed,
   extract(epoch FROM start_time AT TIME ZONE current_setting('TimeZone'))::float8*1000 AS start_ms,
   extract(epoch FROM end_time AT TIME ZONE current_setting('TimeZone'))::float8*1000 AS end_ms
   FROM user_test_attempts ORDER BY attempt_id`)).rows;
  const answers=(await c.query(`SELECT aq.attempt_id,aq.question_id,aq.position,aq.question_snapshot,ua.user_answer,ua.is_correct FROM attempt_questions aq LEFT JOIN user_answers ua USING(attempt_id,question_id) ORDER BY aq.attempt_id,aq.position`)).rows;
  const events=(await c.query(`SELECT event_id,user_id,attempt_id,question_id,event_type,event_payload,
   extract(epoch FROM received_at)::float8*1000 AS received_ms FROM learning_events ORDER BY received_at`)).rows;
  const observations=(await c.query('SELECT * FROM learning_answer_observations')).rows;
  const mappings=(await c.query('SELECT * FROM learning_kc_mapping_versions')).rows;
  const available_parts=(await c.query(`SELECT DISTINCT q.part_number FROM questions q JOIN tests t USING(test_id) WHERE t.is_active AND t.deleted_at IS NULL AND t.publication_status='published' ORDER BY q.part_number`)).rows.map(r=>r.part_number);
  snap={format_version:1,...context,users,attempts,answers,events,observations,mappings,available_parts,
    taxonomy:csv('knowledge_components.csv'),quality_question_ids:csv('CONTENT_QUALITY_REVIEW.csv').map(r=>Number(r.question_id))};
  await c.query('ROLLBACK');
 } finally {await c.end();}
 snap.snapshot_id=crypto.createHash('sha256').update(JSON.stringify(snap)).digest('hex');
 const privateDir=path.join(root,'toeic_be/private/assessment-mvp');fs.mkdirSync(privateDir,{recursive:true});
 const target=path.join(privateDir,'snapshot.json'),temporary=path.join(privateDir,`snapshot-${process.pid}.tmp`);
 fs.writeFileSync(temporary,JSON.stringify(snap),{mode:0o600});fs.renameSync(temporary,target);
 const reportDir=path.join(root,'toeic-ai/reports/assessment_mvp',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(reportDir,{recursive:true});
 const assessments=snap.users.map(u=>buildAssessment(snap,u.user_id));
 fs.writeFileSync(path.join(reportDir,'actual_assessments.json'),JSON.stringify(assessments,null,2));
 console.log(JSON.stringify({snapshot:'private/assessment-mvp/snapshot.json',report_directory:reportDir,read_only:snap.read_only,users:snap.users.length,
  results:assessments.map(a=>({user_id:a.learner.user_id,totals:a.total,events:a.learning_events.total,kc_status:a.knowledge_components.status}))},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
