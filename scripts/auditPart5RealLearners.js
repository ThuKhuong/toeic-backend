// Offline audit only: PostgreSQL enforces READ ONLY for the entire connection.
// Does not call application routes, inference, migrations, or training.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {Client} = require('pg');
const {base} = require('./learningDevEnvironment');
const {buildReport} = require('./auditLightgbmApp');
const {fingerprint} = require('../src/modules/ai/appQuestionFeatures');
const {versionOf} = require('../src/modules/learning/version');
const {gradeAttempt} = require('../src/modules/tests/grading');
const ROOT = path.resolve(__dirname,'../..');
const IDS = [2,5,6]; // User confirmed Vy, Trang and Ngoc; do not replace missing people with legacy users.
const PROTOCOL = path.join(ROOT,'toeic-ai/reports/unified_lightgbm_validation/2026-11-19T15-01-40-378Z/protocol.json');
const sha = x => crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const time = x => x==null?NaN:new Date(x).getTime();
const iso = x => Number.isFinite(time(x))?new Date(x).toISOString():null;
const answered = r => ['A','B','C','D'].includes(r.user_answer);
const tally = (rows,key) => rows.reduce((out,r)=>{out[r[key]]=(out[r[key]]||0)+1;return out;},{});
const duplicates = (rows,key) => rows.length-new Set(rows.map(key)).size;
const write = (file,data) => fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
async function tableHashes(c){
  const names=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const out={};
  for(const {tablename:t} of names){
    const q='"'+t.replaceAll('"','""')+'"';
    out[t]=(await c.query(`SELECT count(*)::int AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${q} t`)).rows[0];
  }
  return out;
}
async function capture(){
  const c=new Client({...base,database:'toeic_learning_system',options:'-c default_transaction_read_only=on',application_name:'part5_readonly_audit'});
  await c.connect();
  try{
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout='20s'");
    const context=(await c.query(`SELECT current_database() AS database,now() AS captured_at,current_setting('transaction_read_only') AS read_only,
      current_setting('TimeZone') AS server_timezone,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker,
      (SELECT min(migrated_at) FROM database_consolidations) AS migration_time`)).rows[0];
    if(context.database!=='toeic_learning_system'||context.read_only!=='on'||context.marker!=='TOEIC_UNIFIED_DEVELOPMENT')throw Error('Verified canonical READ ONLY database required');
    const before=await tableHashes(c);
    const users=(await c.query(`SELECT user_id,full_name,role,is_active,created_at::text FROM "User" WHERE role='STUDENT' ORDER BY user_id`)).rows;
    const accountProof=(await c.query(`SELECT count(*)::int AS accounts,count(DISTINCT user_id)::int AS distinct_ids,
      count(DISTINCT lower(trim(email)))::int AS distinct_emails FROM "User" WHERE user_id=ANY($1::int[])`,[IDS])).rows[0];
    const attempts=(await c.query(`SELECT a.attempt_id,a.user_id,a.test_id,a.total_questions,a.total_correct,a.grading_result,a.is_completed,
      a.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_time,a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,
      a.start_time::text AS start_local,a.end_time::text AS end_local,a.ai_prediction,a.question_predictions
      FROM user_test_attempts a ORDER BY a.attempt_id`)).rows;
    const rows=(await c.query(`SELECT aq.attempt_id,aq.question_id,aq.position,aq.question_snapshot,
      ua.answer_id,ua.user_answer,ua.is_correct,ua.time_spent,
      ua.answered_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS answered_at
      FROM attempt_questions aq LEFT JOIN user_answers ua USING(attempt_id,question_id) ORDER BY aq.attempt_id,aq.position`)).rows;
    const events=(await c.query('SELECT * FROM learning_events ORDER BY received_at,event_id')).rows;
    const revisions=(await c.query('SELECT * FROM learning_answer_revisions ORDER BY revision_id')).rows;
    const observations=(await c.query('SELECT * FROM learning_answer_observations ORDER BY observed_at,attempt_id,question_id')).rows;
    const origins=(await c.query(`SELECT (target_key->>'attempt_id')::int AS attempt_id,origin_database
      FROM database_consolidation_rows WHERE table_name='user_test_attempts'`)).rows;
    const inventory=(await c.query(`SELECT q.part_number AS part,count(*)::int AS questions,
      count(*) FILTER(WHERE t.is_active AND t.deleted_at IS NULL)::int AS active_questions FROM questions q LEFT JOIN tests t USING(test_id)
      GROUP BY q.part_number ORDER BY q.part_number`)).rows;
    const fks=(await c.query(`SELECT count(*) FILTER(WHERE NOT convalidated)::int AS unvalidated FROM pg_constraint
      WHERE connamespace='public'::regnamespace AND contype='f'`)).rows[0];
    const orphanCounts=(await c.query(`SELECT
      (SELECT count(*) FROM user_answers u LEFT JOIN attempt_questions q USING(attempt_id,question_id) WHERE q.attempt_id IS NULL) AS orphan_answers,
      (SELECT count(*) FROM learning_events e LEFT JOIN user_test_attempts a USING(attempt_id) WHERE e.attempt_id IS NOT NULL AND a.attempt_id IS NULL) AS orphan_events,
      (SELECT count(*) FROM learning_events e JOIN user_test_attempts a USING(attempt_id) WHERE e.user_id<>a.user_id) AS wrong_event_owners,
      (SELECT count(*) FROM learning_answer_revisions r JOIN user_test_attempts a USING(attempt_id) WHERE r.user_id<>a.user_id) AS wrong_revision_owners,
      (SELECT count(*) FROM learning_answer_observations o JOIN user_test_attempts a USING(attempt_id) WHERE o.user_id<>a.user_id) AS wrong_observation_owners`)).rows[0];
    const after=await tableHashes(c);
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Snapshot changed inside repeatable read');
    return {context,users,accountProof,attempts,rows,events,revisions,observations,origins,inventory,fks,orphanCounts,
      snapshot_hashes:before,snapshot_hashes_unchanged_within_transaction:true};
  }finally{await c.query('ROLLBACK');await c.end();}
}
function analyze(data,hashes,protocol){
  const {attempts,rows,events,revisions,observations,context}=data;
  for(const a of attempts){
    a.answers=rows.filter(r=>r.attempt_id===a.attempt_id).map(r=>{
      const first=revisions.find(v=>v.attempt_id===a.attempt_id&&v.question_id===r.question_id&&v.user_id===a.user_id&&v.new_answer!=null);
      return {...r,first_answer_at:first?.baseline_known&&first.previous_answer==null?first.changed_at:null};
    });
    const origin=data.origins.filter(o=>o.attempt_id===a.attempt_id);
    if(origin.length>1)throw Error('Ambiguous historical capture origin');
    if(origin.length)a.capture_origin=origin[0].origin_database;
  }
  const part5=a=>a.answers.some(r=>Number(r.question_snapshot?.part_number)===5);
  const completed=a=>a.is_completed&&time(a.end_time)<=time(context.captured_at);
  const post=a=>time(a.start_time)>=time(context.migration_time)&&!a.capture_origin;
  const auditIds=new Set(IDS);
  const chosen=attempts.filter(a=>auditIds.has(a.user_id)&&part5(a));
  // Keep EVERY learner's answers as historical context. Mask forecasts only, not history.
  // Filtering histories to one learner would destroy the other-learner question baseline.
  function evaluate(userIds,scope='post',targetAttempt=null){
    const target=new Set(chosen.filter(a=>userIds.includes(a.user_id)&&(scope==='all'||post(a))&&
      (targetAttempt==null||a.attempt_id===targetAttempt)).map(a=>a.attempt_id));
    const masked=attempts.map(a=>({...a,
      question_predictions:target.has(a.attempt_id)?a.question_predictions:null,
      ai_prediction:userIds.includes(a.user_id)&&a.ai_prediction?{...a.ai_prediction,
        parts:Array.isArray(a.ai_prediction.parts)?a.ai_prediction.parts.filter(p=>p.part===5):a.ai_prediction.parts}:null}));
    const r=buildReport(masked,data.inventory,hashes,time(context.captured_at),{
      respectCaptureOrigin:true,...(scope==='post'?{targetAfter:protocol.target_start_at_or_after,prospective:true}:{})});
    return {v3:r.v3_pre_attempt.by_part.find(p=>p.part===5),v2:r.v2_next_attempt.by_part.find(p=>p.part===5),exclusions:r.exclusions};
  }
  const attemptReports=chosen.map(a=>{
    const qs=a.answers.filter(r=>Number(r.question_snapshot?.part_number)===5);
    const es=events.filter(e=>e.attempt_id===a.attempt_id),rs=revisions.filter(r=>r.attempt_id===a.attempt_id),os=observations.filter(o=>o.attempt_id===a.attempt_id);
    const issues=[],missing={answer_rows:0,initial_server_evidence:0,observations:0,revision_final:0,initial_client_answer_events:0,client_view_events:0};
    const snapshots=new Map(qs.map(q=>[q.question_id,q]));
    const issue=(type,question_id=null)=>issues.push({type,...(question_id==null?{}:{question_id})});
    for(const t of [es,rs,os])if(t.some(r=>r.user_id!==a.user_id))issue('wrong_owner');
    const firstTimes=[],clientTimes=[],margins=[];
    for(const q of qs){
      const snap=q.question_snapshot,key=snap.correct_answer,valid=['A','B','C','D'].includes(key)&&
        Array.isArray(snap.choices)&&snap.choices.length===4&&new Set(snap.choices.map(c=>c.choice_label)).size===4;
      if(!valid||Number(snap.question_id)!==q.question_id)issue('invalid_snapshot',q.question_id);
      const keys=(snap.choices||[]).filter(c=>c.is_correct===true);
      if(keys.length!==1||keys[0].choice_label!==key)issue('snapshot_key_choice_mismatch',q.question_id);
      if(q.answer_id==null)missing.answer_rows++;
      if(answered(q)&&q.is_correct!==(q.user_answer===key))issue('stored_correctness_mismatch',q.question_id);
      const qr=rs.filter(r=>r.question_id===q.question_id),qo=os.filter(o=>o.question_id===q.question_id),qe=es.filter(e=>e.question_id===q.question_id);
      if(answered(q)){
        if(!q.first_answer_at)missing.initial_server_evidence++;
        else {firstTimes.push(time(q.first_answer_at));if(a.question_predictions?.recorded_at)margins.push(time(q.first_answer_at)-time(a.question_predictions.recorded_at));}
        if(completed(a)&&!qo.length)missing.observations++;
        if(!qr.length||qr.at(-1).new_answer!==q.user_answer)missing.revision_final++;
        if(!qe.some(e=>e.event_type==='ANSWER_SUBMITTED'))missing.initial_client_answer_events++;
      }else if(q.user_answer!=null)issue('invalid_answer_label',q.question_id);
      if(!qe.some(e=>e.event_type==='QUESTION_VIEWED'))missing.client_view_events++;
      for(const o of qo){
        if(o.answer!==q.user_answer||o.correctness!==(q.user_answer===key)||!answered(q)||o.part_number!==5||
          o.question_version!==versionOf(snap)||o.question_fingerprint!==fingerprint(snap))issue('observation_mismatch',q.question_id);
        const prior=attempts.filter(h=>completed(h)&&h.user_id===a.user_id&&
          (time(h.end_time)<time(a.end_time)||time(h.end_time)===time(a.end_time)&&h.attempt_id<a.attempt_id))
          .flatMap(h=>h.answers).filter(r=>r.question_id===q.question_id&&answered(r)&&fingerprint(r.question_snapshot)===fingerprint(snap)).length;
        if(o.prior_response_count!==prior||o.is_first_response!==(prior===0))issue('first_repeat_mismatch',q.question_id);
      }
      for(let i=0;i<qr.length;i++){
        const r=qr[i];
        if(r.correctness!==(r.new_answer==null?null:r.new_answer===key))issue('revision_correctness_mismatch',q.question_id);
        if(r.question_version&&r.question_version!==versionOf(snap))issue('revision_version_mismatch',q.question_id);
        if(i&&r.previous_answer!==qr[i-1].new_answer)issue('revision_chain_discontinuity',q.question_id);
      }
      const qa=qe.filter(e=>['ANSWER_SUBMITTED','ANSWER_CHANGED'].includes(e.event_type));
      for(const session of new Set(qa.map(e=>e.client_session_id))){
        const chain=qa.filter(e=>e.client_session_id===session).sort((a,b)=>Number(a.client_sequence)-Number(b.client_sequence));
        for(let i=1;i<chain.length;i++)if(chain[i].event_payload.previous_answer!==chain[i-1].event_payload.new_answer)issue('client_answer_chain_discontinuity',q.question_id);
      }
      if(new Set(qa.map(e=>e.client_session_id)).size===1&&qa.length){
        const last=[...qa].sort((x,y)=>Number(x.client_sequence)-Number(y.client_sequence)).at(-1);
        if(last.event_payload.new_answer!==q.user_answer)issue('client_final_differs_from_persisted',q.question_id);
      }
      for(const e of qa)clientTimes.push(time(e.event_timestamp));
    }
    for(const e of es)if(e.question_id!=null){
      const q=snapshots.get(e.question_id);
      if(!q)issue('event_question_not_in_part5_attempt',e.question_id);
      else if(e.question_version!==versionOf(q.question_snapshot))issue('event_version_mismatch',e.question_id);
    }
    for(const r of [...rs,...os])if(!snapshots.has(r.question_id))issue('evidence_question_not_presented',r.question_id);
    const grades=gradeAttempt(qs),fullGrade=gradeAttempt(a.answers);
    if(completed(a)&&(a.total_questions!==fullGrade.total||a.total_correct!==fullGrade.correct))issue('attempt_summary_mismatch');
    const saved=a.grading_result;
    if(saved&&['total','answered','correct','incorrect','unanswered'].some(k=>saved[k]!==fullGrade[k]))issue('saved_grading_mismatch');
    const completionEvents=es.filter(e=>e.event_type==='ATTEMPT_COMPLETED').length;
    const localDup={answer_question:duplicates(qs,r=>r.question_id),event_id:duplicates(es,r=>r.event_id),
      client_sequence:duplicates(es.filter(e=>e.source==='client'),e=>`${e.user_id}:${e.client_session_id}:${e.client_sequence}`),
      observation_question:duplicates(os,r=>r.question_id),revision_id:duplicates(rs,r=>r.revision_id)};
    if(Object.values(localDup).some(Boolean)||completionEvents>1)issue('duplicate_evidence');
    const ai=evaluate([a.user_id],'all',a.attempt_id);
    const start=time(a.start_time),end=time(a.end_time),pred=time(a.question_predictions?.recorded_at);
    return {attempt_id:a.attempt_id,user_id:a.user_id,test_id:a.test_id,post_migration:post(a),capture_origin:a.capture_origin||'canonical_new',
      start_local:a.start_local,end_local:a.end_local,is_completed:a.is_completed,
      stats:{presented:grades.total,answered:grades.answered,correct:grades.correct,incorrect:grades.incorrect,blank:grades.unanswered},
      learning_events:{total:es.length,by_type:tally(es,'event_type'),completion_events:completionEvents,
        after_completion:es.filter(e=>e.source==='client'&&time(e.received_at)>end).length},
      observations:{total:os.length,first:os.filter(o=>o.is_first_response).length,repeat:os.filter(o=>!o.is_first_response).length},
      revisions:{total:rs.length,initial_known:qs.filter(q=>q.first_answer_at).length,
        baseline_unknown:rs.filter(r=>!r.baseline_known).length},
      missing,duplicates:localDup,issues,
      timing:{v3_status:a.question_predictions?.status||'not_recorded',v3_recorded_at:iso(a.question_predictions?.recorded_at),
        earliest_server_initial_answer_at:firstTimes.length?new Date(Math.min(...firstTimes)).toISOString():null,
        minimum_margin_ms:margins.length?Math.min(...margins):null,not_strictly_before_first_server_answer:margins.filter(x=>x<=0).length,
        earliest_client_answer_at:clientTimes.length?new Date(Math.min(...clientTimes)).toISOString():null,
        client_answers_not_after_prediction:Number.isFinite(pred)?clientTimes.filter(t=>t<=pred).length:null,
        valid_recording_window:Number.isFinite(pred)&&start<=pred&&pred<=end,
        v2_status:a.ai_prediction?.status||'not_recorded',v2_recorded_at:iso(a.ai_prediction?.completed_at),
        v2_at_or_after_submission:Number.isFinite(time(a.ai_prediction?.completed_at))?time(a.ai_prediction.completed_at)>=end:null},
      evaluation:ai};
  });
  const totals=rs=>rs.reduce((s,r)=>Object.fromEntries(Object.keys(s).map(k=>[k,s[k]+r.stats[k]])),{presented:0,answered:0,correct:0,incorrect:0,blank:0});
  const learners=IDS.map(id=>{
    const u=data.users.find(u=>u.user_id===id);if(!u)throw Error('Requested learner account missing: '+id);
    const as=attemptReports.filter(a=>a.user_id===id),ps=as.filter(a=>a.post_migration);
    return {user_id:id,full_name:u.full_name,role:u.role,is_active:u.is_active,
      all_part5_attempts:as.length,completed_part5_attempts:as.filter(a=>a.is_completed).length,
      post_migration_part5_attempts:ps.length,all_stats:totals(as.filter(a=>a.is_completed)),post_stats:totals(ps.filter(a=>a.is_completed)),
      all_evidence:{events:as.reduce((n,a)=>n+a.learning_events.total,0),observations:as.reduce((n,a)=>n+a.observations.total,0),revisions:as.reduce((n,a)=>n+a.revisions.total,0)},
      historical_evaluation:evaluate([id],'all'),post_evaluation:evaluate([id],'post')};
  });
  const postAttempts=attemptReports.filter(a=>a.post_migration&&a.is_completed);
  return {context,requested_user_ids:IDS,account_proof:data.accountProof,learners,attempts:attemptReports,
    after_migration:{learners:new Set(postAttempts.map(a=>a.user_id)).size,attempts:postAttempts.length,stats:totals(postAttempts),evaluation:evaluate(IDS,'post')},
    all_selected_history:{stats:totals(attemptReports.filter(a=>a.is_completed)),evaluation:evaluate(IDS,'all')},
    excluded_context_users:data.users.filter(u=>!IDS.includes(u.user_id)).map(u=>({user_id:u.user_id,full_name:u.full_name,role:'historical_context_only'})),
    global_integrity:{...data.orphanCounts,...data.fks,duplicate_event_ids:duplicates(events,e=>e.event_id),
      duplicate_client_sequence:duplicates(events.filter(e=>e.source==='client'),e=>`${e.user_id}:${e.client_session_id}:${e.client_sequence}`),
      duplicate_observation:duplicates(observations,o=>`${o.attempt_id}:${o.question_id}`)},
    protocol_path:path.relative(ROOT,PROTOCOL).replaceAll('\\','/'),model_sha256:hashes,
    no_inference:true,no_training:true,read_only:context.read_only,snapshot_hashes_unchanged_within_transaction:data.snapshot_hashes_unchanged_within_transaction};
}
async function main(){
  const protocol=JSON.parse(fs.readFileSync(PROTOCOL,'utf8'));
  const files={v2:path.join(ROOT,'toeic-ai/models/v2/lightgbm_v2.joblib'),v3:path.join(ROOT,'toeic-ai/models/v3_app_shadow/model.joblib')};
  const hashes=Object.fromEntries(Object.entries(files).map(([k,f])=>[k,sha(fs.readFileSync(f))]));
  const code=Object.fromEntries(['auditUnifiedLightgbm.js','auditLightgbmApp.js','lightgbmValidationMetrics.js',
    '../src/modules/ai/appQuestionFeatures.js'].map(f=>[f,sha(fs.readFileSync(path.join(__dirname,f)))]));
  if(JSON.stringify(protocol.artifact_sha256)!==JSON.stringify(hashes)||JSON.stringify(protocol.code_sha256)!==JSON.stringify(code))throw Error('Frozen protocol/artifact/code mismatch');
  const data=await capture();
  const result=analyze(data,hashes,protocol);
  const stamp=new Date(result.context.captured_at).toISOString().replace(/[:.]/g,'-');
  const privateDir=path.join(__dirname,'../private/ai/part5-audit',stamp);
  const out=path.join(ROOT,'toeic-ai/reports/part5_real_learner_audit',stamp);
  fs.mkdirSync(privateDir,{recursive:true});fs.mkdirSync(out,{recursive:true});
  write(path.join(privateDir,'snapshot.json'),data);
  write(path.join(out,'audit.json'),result);
  for(const [k,f]of Object.entries(files))if(sha(fs.readFileSync(f))!==hashes[k])throw Error('Model artifact changed during audit');
  write(path.join(out,'manifest.json'),{captured_at:iso(data.context.captured_at),database:data.context.database,
    read_only:true,ended_with_rollback:true,inference_calls:0,training_calls:0,model_sha256:hashes,protocol_sha256:sha(fs.readFileSync(PROTOCOL)),
    evaluator_code_sha256:code,audit_script_sha256:sha(fs.readFileSync(__filename)),
    raw_snapshot_sha256:sha(fs.readFileSync(path.join(privateDir,'snapshot.json'))),aggregate_sha256:sha(fs.readFileSync(path.join(out,'audit.json')))});
  console.log(JSON.stringify({output:out,cutoff:iso(data.context.captured_at),learners:result.learners.map(l=>({user_id:l.user_id,name:l.full_name,
    all_attempts:l.all_part5_attempts,post_attempts:l.post_migration_part5_attempts,post_stats:l.post_stats,
    post_v3:l.post_evaluation.v3.model,legacy_v3:l.historical_evaluation.v3.model})),
    post_migration:result.after_migration,global_integrity:result.global_integrity,
    attempt_issues:result.attempts.map(a=>({attempt:a.attempt_id,missing:a.missing,issues:a.issues,timing:a.timing,
      events:a.learning_events,observations:a.observations,revisions:a.revisions}))}));
}
module.exports={capture,analyze};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
