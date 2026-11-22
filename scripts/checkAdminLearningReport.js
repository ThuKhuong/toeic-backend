// Authenticated HTTP probe against the real DEV database, opened READ ONLY.
// Uses existing users only; isolated loopback server + temporary test signing key.
// Never signs tokens for the running collection backend or saves any DB fixtures.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const express=require('express'),jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const dev=require('./learningDevEnvironment');
const {createAdminLearningReportRouter}=require('../src/modules/ai/adminLearningReportRoutes');
async function main(){
  const pool=new Pool({...dev.base,database:'toeic_learning_events_dev',options:'-c default_transaction_read_only=on'});
  let server;
  const previous=process.env.JWT_SECRET;
  process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
  try{
    const users=(await pool.query(`SELECT user_id,role FROM "User" WHERE role IN ('ADMIN','STUDENT') ORDER BY user_id`)).rows;
    const admin=users.find(u=>u.role==='ADMIN'),student=users.find(u=>u.role==='STUDENT');
    if(!admin||!student)throw Error('Cần ADMIN và STUDENT thật đã có trong DB dev; probe không tự tạo tài khoản.');
    const app=express();app.use('/api/admin/learning-reports',createAdminLearningReportRouter({pool}));
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}/api/admin/learning-reports`;
    const request=(p,actor)=>fetch(base+p,{headers:actor?{Authorization:'Bearer '+jwt.sign(actor,process.env.JWT_SECRET,{expiresIn:'2m'})}:{}});
    const unauthorized=await request('/learners');await unauthorized.arrayBuffer();
    const forbidden=await request('/learners',student);await forbidden.arrayBuffer();
    const listResponse=await request('/learners',admin),list=await listResponse.json();
    const response=await request('/learners/'+student.user_id,admin),report=await response.json();
    if(response.status!==200)throw Error('Report HTTP '+response.status);
    const truth=(await pool.query(`SELECT count(DISTINCT a.attempt_id)::int AS attempts,count(*)::int AS presented,
      count(ua.user_answer)::int AS answered,count(*) FILTER(WHERE ua.user_answer=aq.question_snapshot->>'correct_answer')::int AS correct
      FROM user_test_attempts a JOIN attempt_questions aq USING(attempt_id) LEFT JOIN user_answers ua USING(attempt_id,question_id)
      WHERE a.user_id=$1 AND a.is_completed AND a.end_time IS NOT NULL AND a.end_time>=a.start_time
      AND a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh'<=$2`,[student.user_id,report.source.as_of])).rows[0];
    const eventTruth=Number((await pool.query(`SELECT count(*) AS count FROM learning_events e LEFT JOIN user_test_attempts a USING(attempt_id)
      WHERE e.user_id=$1 AND (e.attempt_id IS NULL OR a.user_id=$1) AND e.received_at<=$2`,[student.user_id,report.source.as_of])).rows[0].count);
    const keys=[];function visit(x){if(x&&typeof x==='object')for(const[k,v]of Object.entries(x)){keys.push(k);visit(v);}}visit(report);
    const checks={no_token_401:unauthorized.status===401,student_403:forbidden.status===403,admin_200:listResponse.status===200&&response.status===200,
      no_store:response.headers.get('cache-control')==='no-store',actual_dev:report.source.database==='toeic_learning_events_dev',
      selected_learner_only:report.learner.user_id===student.user_id&&list.learners.some(u=>u.user_id===student.user_id),
      seven_parts:report.parts.length===7,sql_totals_match:report.total.attempt_count===truth.attempts&&report.total.presented===truth.presented&&report.total.answered===truth.answered&&report.total.correct===truth.correct,
      sql_event_count_matches:report.learning_events.total===eventTruth,
      no_sensitive_fields:!['email','password','correct_answer','question_snapshot','event_payload','choices','features','probability'].some(k=>keys.includes(k)),
      no_ability_claim:report.policy.strength_weakness_enabled===false&&report.policy.ai_validation_status==='not_approved'};
    const output={at:new Date().toISOString(),checks,all_passed:Object.values(checks).every(Boolean),total:report.total,events:report.learning_events.total,
      database:report.source.database,read_only_connection:true,temporary_http_server:true,uses_existing_users:true,db_writes:0};
    const dir=path.resolve(__dirname,'../../toeic-ai/reports/collection_phase2');fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'http_readonly_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,...output}));
    if(!output.all_passed)process.exitCode=1;
  }finally{
    if(server)await new Promise(r=>server.close(r));await pool.end();
    if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
