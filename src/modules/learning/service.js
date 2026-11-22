const {randomUUID}=require('node:crypto');
const {hash,versionOf}=require('./version');
const {fingerprint}=require('../ai/appQuestionFeatures');
const enabled=()=>process.env.LEARNING_EVENTS_ENABLED==='1';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const types=new Set(['QUESTION_VIEWED','ANSWER_SUBMITTED','ANSWER_CHANGED','AUDIO_PLAYED','EXPLANATION_VIEWED','LESSON_STARTED','LESSON_COMPLETED']);
async function approvedMapping(client,q) {
  return (await client.query(`SELECT * FROM learning_kc_mapping_versions
    WHERE question_id=$1 AND question_version=$2 AND review_status='approved'`,[q.question_id,versionOf(q)])).rows[0]||null;
}
async function acceptEvent(client,userId,input) {
  if(!input||!uuid(input.event_id)||!uuid(input.client_session_id)||!Number.isSafeInteger(input.client_sequence)||input.client_sequence<1||!types.has(input.event_type))fail(400,'Invalid event identity/type');
  if(input.user_id!=null&&input.user_id!==userId)fail(403,'Wrong event user');
  if(typeof input.event_timestamp!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(input.event_timestamp)||!Number.isFinite(Date.parse(input.event_timestamp)))fail(400,'Timestamp must include timezone');
  const payload=input.event_payload;
  if(!payload||Array.isArray(payload)||typeof payload!=='object'||Buffer.byteLength(JSON.stringify(payload))>16384)fail(400,'Invalid event payload');
  if(['correct_answer','is_correct','correctness','probability','mastery'].some(k=>Object.hasOwn(payload,k)))fail(400,'Client labels/predictions are not evidence');
  let q=null,attempt=null;
  if(input.event_type.startsWith('LESSON_')) {
    if(input.attempt_id!=null||input.question_id!=null||typeof input.lesson_id!=='string')fail(400,'Invalid lesson context');
    const match=/^vocabulary_study_session:([1-9]\d*)$/.exec(input.lesson_id);
    if(!match)fail(400,'Unknown lesson resource');
    const lesson=(await client.query('SELECT user_id,completed_at FROM vocabulary_study_sessions WHERE session_id=$1',[match[1]])).rows[0];
    if(!lesson||lesson.user_id!==userId)fail(404,'Lesson not found');
    if(input.event_type==='LESSON_COMPLETED'&&!lesson.completed_at)fail(409,'Lesson is not completed');
  } else {
    if(!positive(input.attempt_id)||!positive(input.question_id)||input.lesson_id!=null)fail(400,'Invalid attempt/question');
    attempt=(await client.query('SELECT * FROM user_test_attempts WHERE attempt_id=$1 AND user_id=$2 FOR SHARE',[input.attempt_id,userId])).rows[0];
    if(!attempt)fail(404,'Attempt not found');
    q=(await client.query('SELECT question_snapshot FROM attempt_questions WHERE attempt_id=$1 AND question_id=$2',[input.attempt_id,input.question_id])).rows[0]?.question_snapshot;
    if(!q)fail(400,'Question was not presented');
    if(input.question_version!=null&&input.question_version!==versionOf(q))fail(409,'Question version mismatch');
    if(input.event_type==='EXPLANATION_VIEWED'&&!attempt.is_completed)fail(409,'Explanation is unavailable before completion');
    if(input.event_type==='AUDIO_PLAYED') {
      if(![1,2,3,4].includes(Number(q.part_number))||payload.audio_url!==(q.material_audio||q.audio_url))fail(400,'Audio is not part of this question');
    }
    if(input.event_type.startsWith('ANSWER_')) {
      if(!(q.choices||[]).some(c=>c.choice_label===payload.new_answer))fail(400,'Invalid answer choice');
      if(input.event_type==='ANSWER_SUBMITTED'&&payload.previous_answer!=null)fail(400,'Initial answer must have no previous answer');
      if(input.event_type==='ANSWER_CHANGED'&&(!(q.choices||[]).some(c=>c.choice_label===payload.previous_answer)||payload.previous_answer===payload.new_answer))fail(400,'Invalid answer transition');
    }
  }
  // Identity is based on the received client envelope, never on mutable review state.
  const identity={event_id:input.event_id,user_id:userId,attempt_id:input.attempt_id??null,question_id:input.question_id??null,
    lesson_id:input.lesson_id??null,event_type:input.event_type,event_timestamp:input.event_timestamp,
    event_payload:payload,question_version:input.question_version??null,client_session_id:input.client_session_id,client_sequence:input.client_sequence};
  const digest=hash(identity);
  const existing=(await client.query('SELECT user_id,client_event_sha256 FROM learning_events WHERE event_id=$1',[input.event_id])).rows[0];
  if(existing){if(existing.user_id!==userId||existing.client_event_sha256!==digest)fail(409,'Event ID conflict');return 'duplicate';}
  const mapping=q?await approvedMapping(client,q):null;
  const enriched={...payload,server_context:{received_after_completion:!!attempt?.is_completed,
    client_clock_future:Date.parse(input.event_timestamp)>Date.now()+300000,
    correctness_source:'not_used_for_grading_or_BKT',lesson_resource:input.lesson_id?'vocabulary_study_session':null}};
  const inserted=await client.query(`INSERT INTO learning_events(event_id,user_id,attempt_id,question_id,lesson_id,event_type,
    event_timestamp,event_payload,question_version,taxonomy_version,mapping_version,mapping_provenance,
    client_session_id,client_sequence,client_event_sha256,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'client')
    ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,[input.event_id,userId,input.attempt_id??null,input.question_id??null,input.lesson_id??null,
    input.event_type,input.event_timestamp,JSON.stringify(enriched),q?versionOf(q):null,mapping?.taxonomy_version||null,mapping?.mapping_version||null,
    mapping?JSON.stringify(mapping.provenance):null,input.client_session_id,input.client_sequence,digest]);
  if(!inserted.rowCount) {
    const previous=(await client.query('SELECT user_id,client_event_sha256 FROM learning_events WHERE event_id=$1',[input.event_id])).rows[0];
    if(previous.user_id!==userId||previous.client_event_sha256!==digest)fail(409,'Event ID conflict');
    return 'duplicate';
  }
  return 'accepted';
}
async function ingest(pool,userId,events) {
  if(!enabled())fail(503,'Learning tracking is not enabled');
  if(!Array.isArray(events)||events.length<1||events.length>50)fail(400,'Expected 1-50 events');
  const client=await pool.connect();const results=[];
  try {
    await client.query('BEGIN');
    for(const event of events) {
      await client.query('SAVEPOINT ingest_event');
      try {const status=await acceptEvent(client,userId,event);results.push({event_id:event.event_id,status});await client.query('RELEASE SAVEPOINT ingest_event');}
      catch(error) {
        await client.query('ROLLBACK TO SAVEPOINT ingest_event');
        if(!error.status&&error.code!=='23505')throw error;
        results.push({event_id:event?.event_id??null,status:'rejected',code:error.status||409,message:error.status?error.message:'Client sequence conflict'});
        await client.query('RELEASE SAVEPOINT ingest_event');
      }
    }
    await client.query('COMMIT');return {results};
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function guardProgress(client,attemptId,data) {
  if(!enabled())return;
  const existing=(await client.query('SELECT * FROM learning_attempt_sync WHERE attempt_id=$1 FOR UPDATE',[attemptId])).rows[0];
  if(data.progress_revision==null){if(existing)fail(409,'Progress revision required');return;}
  if(!Number.isSafeInteger(data.progress_revision)||data.progress_revision<1)fail(400,'Invalid progress revision');
  const digest=hash(data);
  if(existing&&data.progress_revision<=Number(existing.revision)) {
    if(data.progress_revision===Number(existing.revision)&&digest===existing.payload_sha256)return 'duplicate';
    fail(409,'Stale progress; keep local draft and resume before editing');
  }
  await client.query(`INSERT INTO learning_attempt_sync(attempt_id,revision,payload_sha256) VALUES($1,$2,$3)
    ON CONFLICT(attempt_id) DO UPDATE SET revision=EXCLUDED.revision,payload_sha256=EXCLUDED.payload_sha256`,[attemptId,data.progress_revision,digest]);
}
async function recordCompletion(client,attempt,rows) {
  if(!enabled())return;
  const history=(await client.query(`SELECT aq.question_id,aq.question_snapshot,ua.user_answer FROM user_test_attempts a
    JOIN attempt_questions aq USING(attempt_id) JOIN user_answers ua USING(attempt_id,question_id)
    WHERE a.user_id=$1 AND a.is_completed AND (a.end_time,a.attempt_id)<($2,$3) AND ua.user_answer IN ('A','B','C','D')`,
    [attempt.user_id,attempt.end_time,attempt.attempt_id])).rows;
  for(const row of rows) {
    const q=row.question_snapshot;
    if(!['A','B','C','D'].includes(row.user_answer))continue;
    const fp=fingerprint(q),prior=history.filter(h=>h.question_id===row.question_id&&fingerprint(h.question_snapshot)===fp).length;
    const mapping=await approvedMapping(client,q);
    const eligible=!!(mapping?.content_verified&&(Number(q.part_number)>4||mapping.audio_verified)&&q.learning_version?.media_verified);
    await client.query(`INSERT INTO learning_answer_observations(observation_id,user_id,attempt_id,question_id,answer,correctness,observed_at,
      question_version,question_fingerprint,part_number,group_id,prior_response_count,is_first_response,mapping_version,taxonomy_version,
      primary_kc,secondary_kcs,mapping_provenance,bkt_eligible_at_capture,exclusion_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT(attempt_id,question_id) DO NOTHING`,
      [randomUUID(),attempt.user_id,attempt.attempt_id,row.question_id,row.user_answer,row.user_answer===q.correct_answer,attempt.end_time,
        versionOf(q),fp,Number(q.part_number),q.group_id||null,prior,prior===0,mapping?.mapping_version||null,mapping?.taxonomy_version||null,
        mapping?.primary_kc||null,JSON.stringify(mapping?.secondary_kcs||[]),mapping?JSON.stringify(mapping.provenance):null,eligible,
        eligible?null:!mapping?'no_approved_mapping':!q.learning_version?.media_verified?'unverified_content_version':'content_or_audio_not_confirmed']);
  }
  const id=randomUUID();
  await client.query(`INSERT INTO learning_events(event_id,user_id,attempt_id,event_type,event_timestamp,event_payload,client_event_sha256,source)
    VALUES($1,$2,$3,'ATTEMPT_COMPLETED',$4,$5,$6,'server')`,[id,attempt.user_id,attempt.attempt_id,attempt.end_time,
    JSON.stringify({total_questions:attempt.total_questions,total_correct:attempt.total_correct,observation_unit:'attempt_question_final_response'}),hash({attempt_id:attempt.attempt_id,type:'ATTEMPT_COMPLETED'})]);
}
async function answerHistory(pool,userId,attemptId,questionId) {
  const owner=(await pool.query('SELECT is_completed FROM user_test_attempts WHERE attempt_id=$1 AND user_id=$2',[attemptId,userId])).rows[0];
  if(!owner)fail(404,'Attempt not found');
  const state=(await pool.query('SELECT user_answer FROM user_answers WHERE attempt_id=$1 AND question_id=$2',[attemptId,questionId])).rows[0];
  const revisions=(await pool.query('SELECT * FROM learning_answer_revisions WHERE attempt_id=$1 AND question_id=$2 ORDER BY revision_id',[attemptId,questionId])).rows;
  const events=(await pool.query(`SELECT event_id,event_type,event_timestamp,received_at,event_payload,client_session_id,client_sequence
    FROM learning_events WHERE attempt_id=$1 AND question_id=$2 AND event_type IN ('ANSWER_SUBMITTED','ANSWER_CHANGED')
    ORDER BY MIN(received_at) OVER(PARTITION BY client_session_id),client_session_id,client_sequence`,[attemptId,questionId])).rows;
  return {final_answer:state?.user_answer??null,initial_answer:events.find(e=>e.event_type==='ANSWER_SUBMITTED')?.event_payload.new_answer??null,
    initial_answer_known:events.some(e=>e.event_type==='ANSWER_SUBMITTED'),
    initial_answer_source:'client_interaction_when_available',
    first_persisted_answer:revisions[0]?.baseline_known?revisions[0].new_answer:null,
    first_persisted_answer_known:!!revisions[0]?.baseline_known,
    recorded_change_count:events.filter(e=>e.event_type==='ANSWER_CHANGED').length,
    persisted_change_count:revisions.filter((r,i)=>i>0||!r.baseline_known).length,interactions:events,
    persisted_revisions:owner.is_completed?revisions:revisions.map(({correctness,...r})=>r),
    ordering_policy:'sessions grouped by first receipt; sequence within a session; no trusted total order across sessions'};
}
module.exports={enabled,ingest,guardProgress,recordCompletion,answerHistory,approvedMapping};
