// Pure descriptive assessment. No database, inference, training or side effects.
const {fingerprint}=require('../../src/modules/ai/appQuestionFeatures');
const {versionOf}=require('../../src/modules/learning/version');
const TYPES=['QUESTION_VIEWED','ANSWER_SUBMITTED','ANSWER_CHANGED','AUDIO_PLAYED','EXPLANATION_VIEWED','ATTEMPT_COMPLETED','LESSON_STARTED','LESSON_COMPLETED'];
const choice=x=>['A','B','C','D'].includes(x);
const rate=(a,b)=>b?a/b:null;
const blankStats=()=>({presented:0,answered:0,correct:0,incorrect:0,unanswered:0,invalid_answers:0,first_answers:0,repeat_answers:0,attempt_ids:new Set(),versions:new Set()});
const finish=s=>{const {attempt_ids,versions,...v}=s;return {...v,accuracy:rate(s.correct,s.answered),correct_of_presented:rate(s.correct,s.presented),completion_rate:rate(s.answered,s.presented),
  evidence_count:s.answered,attempt_count:attempt_ids.size,distinct_question_versions:versions.size,status:s.answered?'descriptive_evidence':'insufficient_data'};};
function confirmed(record,version,cutoff,kind='content') {
  return !!(record&&record.question_version===version&&record.status===(kind==='audio'?'verified':'confirmed_original_correct')&&
    (kind!=='audio'||record.comparison_result==='matches_script')&&typeof record.reviewed_by==='string'&&record.reviewed_by.trim()&&typeof record.source==='string'&&record.source.trim()&&
    Number.isFinite(Date.parse(record.reviewed_at))&&Date.parse(record.reviewed_at)<=cutoff);
}
function kcGate({row,attempt,observation,mapping,taxonomy,qualityIds}) {
  const q=row.question_snapshot,version=versionOf(q);
  if(!observation||!observation.bkt_eligible_at_capture)return observation?.exclusion_reason||'no_verified_capture';
  const observed=observation.observed_ms??Date.parse(observation.observed_at);
  if(!Number.isFinite(observed)||observed<attempt.start_ms||observed>attempt.end_ms+1)return 'invalid_observation_time';
  if(observation.user_id!==attempt.user_id||observation.answer!==row.user_answer||observation.correctness!==(row.user_answer===q.correct_answer))return 'observation_label_or_owner_mismatch';
  if(!mapping||mapping.review_status!=='approved'||mapping.mapping_version!==observation.mapping_version)return 'no_current_approved_mapping';
  if(mapping.question_id!==row.question_id||mapping.question_version!==version||observation.question_version!==version||mapping.taxonomy_version!==observation.taxonomy_version)return 'mapping_version_mismatch';
  if(!mapping.content_verified||typeof mapping.reviewed_by!=='string'||!mapping.reviewed_by.trim()||!Number.isFinite(Date.parse(mapping.reviewed_at))||Date.parse(mapping.reviewed_at)>attempt.end_ms)return 'mapping_review_not_valid_at_capture';
  const kc=taxonomy.find(k=>k.kc_code===mapping.primary_kc);
  if(!kc||kc.taxonomy_version!==mapping.taxonomy_version||!String(kc.applicable_parts).split(';').includes(String(q.part_number))||kc.section!==(Number(q.part_number)<=4?'listening':'reading'))return 'unknown_or_incompatible_kc';
  if(!Array.isArray(mapping.secondary_kcs)||new Set(mapping.secondary_kcs).size!==mapping.secondary_kcs.length||mapping.secondary_kcs.includes(mapping.primary_kc)||mapping.secondary_kcs.some(code=>!taxonomy.some(k=>k.kc_code===code&&k.taxonomy_version===mapping.taxonomy_version&&k.section===kc.section&&String(k.applicable_parts).split(';').includes(String(q.part_number)))))return 'invalid_secondary_kc_context';
  if(observation.primary_kc!==mapping.primary_kc||JSON.stringify(observation.secondary_kcs||[])!==JSON.stringify(mapping.secondary_kcs||[]))return 'capture_kc_mismatch';
  if(!q.learning_version?.media_verified)return 'unversioned_or_unavailable_media';
  if(!confirmed(mapping.provenance?.content_confirmation,version,attempt.end_ms))return 'content_confirmation_provenance_required';
  if(Number(q.part_number)<=4&&(!mapping.audio_verified||!confirmed(mapping.provenance?.audio_confirmation,version,attempt.end_ms,'audio')))return 'audio_confirmation_provenance_required';
  if(qualityIds.includes(row.question_id)&&!confirmed(mapping.provenance?.quality_resolution,version,attempt.end_ms))return 'unresolved_content_quality';
  return null;
}
function buildAssessment(snapshot,userId,{cutoffMs=snapshot.cutoff_ms}={}) {
  if(!Number.isSafeInteger(userId)||!snapshot.users.some(u=>u.user_id===userId))throw Object.assign(Error('Learner not found'),{status:404});
  if(!Number.isFinite(cutoffMs)||cutoffMs>snapshot.cutoff_ms)throw Object.assign(Error('Cutoff outside snapshot'),{status:400});
  const diagnostics={excluded_attempts:0,invalid_question_snapshots:0,duplicate_attempt_questions:0,stored_correctness_mismatches:0,kc_exclusion_reasons:{},event_exclusions:0};
  const attempts=snapshot.attempts.filter(a=>a.user_id===userId);
  const valid=attempts.filter(a=>a.is_completed&&Number.isFinite(a.end_ms)&&Number.isFinite(a.start_ms)&&a.start_ms<=a.end_ms&&a.end_ms<=cutoffMs);
  diagnostics.excluded_attempts=attempts.length-valid.length;
  const byAttempt=new Map(valid.map(a=>[a.attempt_id,a]));
  const parts=Array.from({length:7},(_,i)=>({part:i+1,...blankStats()}));
  const sections={listening:blankStats(),reading:blankStats()},total=blankStats();
  const seen=new Set(),uniqueRows=new Set(),kcResults=new Map();let kcEligible=0;
  const observationIndex=new Map(snapshot.observations.filter(o=>o.user_id===userId).map(o=>[`${o.attempt_id}:${o.question_id}`,o]));
  const registry=new Map(snapshot.mappings.map(m=>[m.mapping_version,m]));
  const ordered=snapshot.answers.filter(r=>byAttempt.has(r.attempt_id)).sort((a,b)=>byAttempt.get(a.attempt_id).end_ms-byAttempt.get(b.attempt_id).end_ms||a.attempt_id-b.attempt_id||a.position-b.position);
  for(const row of ordered) {
    const attempt=byAttempt.get(row.attempt_id),q=row.question_snapshot,part=Number(q?.part_number);
    const rowKey=`${row.attempt_id}:${row.question_id}`;
    if(uniqueRows.has(rowKey)){diagnostics.duplicate_attempt_questions++;continue;}uniqueRows.add(rowKey);
    if(!q||!Number.isInteger(part)||part<1||part>7||!choice(q.correct_answer)||!(q.choices||[]).some(c=>c.choice_label===q.correct_answer)){diagnostics.invalid_question_snapshots++;continue;}
    const answered=choice(row.user_answer)&&(q.choices||[]).some(c=>c.choice_label===row.user_answer);
    const correct=answered&&row.user_answer===q.correct_answer;
    const versionKey=`${row.question_id}:${versionOf(q)}:${fingerprint(q)}`;
    const repeat=answered&&seen.has(versionKey);if(answered)seen.add(versionKey);
    for(const stats of [total,parts[part-1],sections[part<=4?'listening':'reading']]) {
      stats.presented++;stats.attempt_ids.add(attempt.attempt_id);stats.versions.add(versionKey);
      if(answered){stats.answered++;if(correct)stats.correct++;else stats.incorrect++;if(repeat)stats.repeat_answers++;else stats.first_answers++;}
      else {stats.unanswered++;if(row.user_answer!=null&&String(row.user_answer).trim())stats.invalid_answers++;}
    }
    if(answered&&row.is_correct!==correct)diagnostics.stored_correctness_mismatches++;
    if(!answered)continue;
    const observation=observationIndex.get(rowKey),mapping=registry.get(observation?.mapping_version);
    const blocked=kcGate({row,attempt,observation,mapping,taxonomy:snapshot.taxonomy,qualityIds:snapshot.quality_question_ids});
    if(blocked){diagnostics.kc_exclusion_reasons[blocked]=(diagnostics.kc_exclusion_reasons[blocked]||0)+1;continue;}
    kcEligible++;
    if(!kcResults.has(mapping.primary_kc))kcResults.set(mapping.primary_kc,{kc_code:mapping.primary_kc,name:snapshot.taxonomy.find(k=>k.kc_code===mapping.primary_kc).name,...blankStats()});
    const k=kcResults.get(mapping.primary_kc);k.presented++;k.answered++;k.correct+=Number(correct);k.incorrect+=Number(!correct);k.attempt_ids.add(attempt.attempt_id);k.versions.add(versionKey);if(repeat)k.repeat_answers++;else k.first_answers++;
  }
  const eventCounts=Object.fromEntries(TYPES.map(t=>[t,0]));const eventIds=new Set();let late=0;
  for(const event of snapshot.events.filter(e=>e.user_id===userId)) {
    if(!Number.isFinite(event.received_ms)||event.received_ms>cutoffMs||eventIds.has(event.event_id)||!TYPES.includes(event.event_type)){diagnostics.event_exclusions++;continue;}
    if(event.attempt_id!=null&&!byAttempt.has(event.attempt_id)){diagnostics.event_exclusions++;continue;}
    if(event.question_id!=null&&!uniqueRows.has(`${event.attempt_id}:${event.question_id}`)){diagnostics.event_exclusions++;continue;}
    eventIds.add(event.event_id);eventCounts[event.event_type]++;if(event.event_payload?.server_context?.received_after_completion)late++;
  }
  const finalParts=parts.map(p=>({...finish(p),part:p.part,practice_available:snapshot.available_parts.includes(p.part)}));
  const nextSteps=[];
  for(const p of finalParts)if(p.unanswered)nextSteps.push({kind:'completion_review',part:p.part,reason:`Part ${p.part} có ${p.unanswered} câu bỏ trống trong ${p.presented} câu đã phát. Xem lại việc hoàn thành bài; đây không phải kết luận yếu kiến thức.`});
  const unmeasured=finalParts.filter(p=>!p.answered).map(p=>p.part);
  if(unmeasured.length)nextSteps.push({kind:'coverage_gap',parts:unmeasured,reason:`Chưa có câu trả lời hợp lệ ở Part ${unmeasured.join(', ')}; không gắn nhãn yếu.`,available_parts:unmeasured.filter(p=>snapshot.available_parts.includes(p))});
  return {assessment_version:'descriptive_assessment_mvp_v1',learner:snapshot.users.find(u=>u.user_id===userId),
    source:{snapshot_id:snapshot.snapshot_id,cutoff:new Date(cutoffMs).toISOString(),database:snapshot.database,mode:'isolated_readonly_snapshot'},
    status:total.answered?'descriptive_only':'insufficient_data',method:{type:'descriptive_statistics',model_inference_used:false,bkt_used:false,correctness_source:'actual_final_answer_vs_attempt_snapshot',observation_unit:'one_final_response_per_attempt_question',accuracy_denominator:'valid_answered_questions',mastery_estimated:false},
    total:finish(total),sections:Object.entries(sections).map(([section,s])=>({section,...finish(s)})),parts:finalParts,
    learning_events:{total:eventIds.size,by_type:eventCounts,received_after_completion:late,role:'engagement_context_not_correctness_labels'},
    knowledge_components:{status:kcEligible?'verified_descriptive_only':'insufficient_data',eligible_observations:kcEligible,excluded_answered_observations:total.answered-kcEligible,
      results:[...kcResults.values()].map(k=>({...finish(k),kc_code:k.kc_code,name:k.name,mastery:null})),reason:kcEligible?null:'Chưa có bằng chứng KC được duyệt và xác minh đầy đủ tại thời điểm ghi nhận. Không suy đoán điểm mạnh/yếu.'},
    next_steps:nextSteps,extension_points:{mastery_estimator:{status:'not_enabled',contract:'versioned_primary_KC_evidence_with_group_repeat_and_cutoff'},recommendation_policy:{status:'not_enabled',contract:'verified_KC_state_plus_published_content_and_exposure_outcomes'}},diagnostics,
    limitations:['Thống kê mô tả bài đã làm, không phải điểm TOEIC chuẩn hoặc năng lực đã hiệu chuẩn.','Không so trực tiếp độ mạnh/yếu giữa các Part có bộ câu khác nhau.','Lượt lặp và câu cùng audio/passage có tương quan; không xem là mẫu độc lập.','Learning Events không chứng minh đã đọc hiểu/nghe hiểu; outbox chưa đồng bộ không xuất hiện trong snapshot.']};
}
module.exports={buildAssessment,kcGate,TYPES};
