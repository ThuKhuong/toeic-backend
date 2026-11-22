// Isolated research policy: never mounted in product routes.
const {history,candidatePairs}=require('./partStudyPolicy');
const {fingerprint}=require('../src/modules/ai/appQuestionFeatures');
const crypto=require('node:crypto');
const time=v=>v==null?NaN:new Date(v).getTime();
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=v=>String(v??'').normalize('NFC').replace(/\s+/g,' ').trim();
const RESEARCH_MIN_DISTINCT=10; // Riiid study comparison floor, NOT a validated ability threshold.

function buildResearchProfile({attempts,userId,asOf,predictions,artifactHash,elapsedMedianSeconds}){
 if(!Number.isSafeInteger(userId)||userId<1||!Number.isFinite(time(asOf)))throw Error('Valid owner/cutoff required');
 if(!/^[a-f0-9]{64}$/.test(artifactHash||'')||!Number.isFinite(elapsedMedianSeconds)||elapsedMedianSeconds<0)throw Error('Valid artifact and feature config required');
 if(attempts.some(a=>a.user_id===userId&&a.is_completed&&(!Number.isFinite(time(a.start_time))||!Number.isFinite(time(a.end_time))||time(a.end_time)<time(a.start_time))))throw Error('Invalid completed-history timestamps');
 const h=history(attempts,userId,asOf);
 if(new Set(predictions.map(p=>p.part)).size!==predictions.length)throw Error('Duplicate model Part');
 const parts=h.parts.map(p=>{
  const r=predictions.find(r=>r.part===p.part),i=p.input;
  const own=attempts.filter(a=>a.user_id===userId&&a.is_completed&&Number.isFinite(time(a.start_time))&&
   Number.isFinite(time(a.end_time))&&time(a.end_time)>=time(a.start_time)&&time(a.end_time)<=time(asOf)&&
   a.answers.some(q=>Number(q.question_snapshot?.part_number)===p.part));
  const rows=own.flatMap(a=>a.answers.filter(q=>Number(q.question_snapshot?.part_number)===p.part).map(q=>({...q,end_time:a.end_time,start_time:a.start_time})));
  const revisionEvidence=rows.filter(q=>q.user_answer!=null&&Number.isFinite(time(q.first_answer_at))&&
   time(q.first_answer_at)>=time(q.start_time)&&time(q.first_answer_at)<=time(q.end_time)).length;
  const latest=own.reduce((latest,a)=>Math.max(latest,time(a.end_time)),0);
  const base={...p,completed_attempts:own.length,latest_completed_at:latest?new Date(latest).toISOString():null,
   age_days:latest?(time(asOf)-latest)/86400000:null,first_revision_answers:revisionEvidence,
   repeat_answers:i.part_answered_count-p.distinct,probability:null,ability_label:null,
   status:!i.part_answered_count?'no_data':'insufficient_distinct_history',rank_eligible:false};
  if(!i.part_answered_count){if(r)throw Error('No-history Part must not receive inferred weakness');return base;}
  if(!r)return {...base,status:'model_unavailable'};
  const expected={part:p.part,user_acc:(i.correct_count+1)/(i.answered_count+2),user_part_acc:(i.part_correct_count+1)/(i.part_answered_count+2),
   attempt_count:i.answered_count,user_part_count:i.part_answered_count,prior_elapsed_seconds:elapsedMedianSeconds,elapsed_time_missing:1};
  if(r.model!=='lightgbm_v2'||r.artifact_sha256!==artifactHash||typeof r.probability!=='number'||!Number.isFinite(r.probability)||r.probability<0||r.probability>1||
   Object.entries(expected).some(([k,v])=>typeof r.features?.[k]!=='number'||!Number.isFinite(r.features[k])||Math.abs(r.features[k]-v)>1e-10))throw Error('Model/hash/feature contract mismatch');
  return {...base,probability:r.probability,status:p.distinct>=RESEARCH_MIN_DISTINCT?'research_only_unvalidated':'insufficient_distinct_history',
   rank_eligible:p.distinct>=RESEARCH_MIN_DISTINCT};
 });
 if(predictions.some(r=>!parts.some(p=>p.part===r.part)))throw Error('Unknown predicted Part');
 const eligible=parts.filter(p=>p.rank_eligible);
 const order=key=>eligible.map(p=>({part:p.part,value:p[key]})).sort((a,b)=>a.value-b.value||a.part-b.part);
 const aiOrder=order('probability'),baselineOrder=order('baseline_probability');
 const min=aiOrder[0]?.value,max=aiOrder.at(-1)?.value;
 return {version:'app_part_research_v1',as_of:new Date(asOf).toISOString(),user_id:userId,parts,
  research:{eligible_parts:eligible.length,complete_seven_parts:eligible.length===7,
   minimum_distinct_is_research_floor:true,comparison_floor:RESEARCH_MIN_DISTINCT,
   ai_order_low_to_high:eligible.length>=2?aiOrder:[],baseline_order_low_to_high:eligible.length>=2?baselineOrder:[],
   lower_signal_candidates:eligible.length>=2?aiOrder.filter(x=>x.value===min).map(x=>x.part):[],
   higher_signal_candidates:eligible.length>=2?aiOrder.filter(x=>x.value===max).map(x=>x.part):[],
   pair_checks:candidatePairs(eligible.map(p=>({...p,status:'ready'}))),
   interpretation:'Orders are experimental V2 signals among measured Parts, not validated ability labels. Ties are retained; rank cannot turn an unmeasured Part into a weak Part.'},
  production:{strength_weakness_enabled:false,ai_recommendations_enabled:false,recommended_part:null},
  provenance:{source_attempt_ids:h.source_attempt_ids,artifact_sha256:artifactHash,feature_version:'group_history_v1',
   retrospective_diagnostic:true,prospective_validation:false,training_calls:0,database_writes:0},
  limitations:['Cumulative V2 history has no recency or item difficulty normalization. Age is reported, not silently reweighted.',
   'Missing historical first revisions are disclosed; this report does not backfill evidence or score its own inputs.',
   'Riiid evidence does not by itself validate this app bank or individual strong/weak labels.']};
}

function contentKey(q){
 return sha([Number(q.part_number),text(q.question_text),q.correct_answer,
  (q.choices||[]).map(c=>[c.choice_label,text(c.choice_text)]).sort(),
  text(q.material_audio||q.audio_url),text(q.image_url||q.group_image_url),text(q.passage_content),text(q.passage_image_url),
  (q.passages||[]).map(p=>[text(p.content),text(p.image_url)])]);
}
function contextKeys(q){
 return [q.audio_content_hash||q.material_audio||q.audio_url,
  q.stimulus_image_content_hash||q.image_url||q.group_image_url,
  q.passage_content?sha(text(q.passage_content)):null,
  q.passage_image_content_hash||q.passage_image_url,
  ...(q.passages||[]).flatMap(p=>[p.content?sha(text(p.content)):null,p.image_content_hash||p.image_url])].filter(Boolean);
}
function auditForms(tests,questions){
 const forms=tests.map(t=>{
  const qs=questions.filter(q=>q.test_id===t.test_id),parts=[...new Set(qs.map(q=>Number(q.part_number)))],issues=[];
  for(const q of qs){
   const labels=(q.choices||[]).map(c=>c.choice_label),expected=Number(q.part_number)===2?['A','B','C']:['A','B','C','D'];
   if(labels.length!==expected.length||new Set(labels).size!==labels.length||expected.some(l=>!labels.includes(l))||!expected.includes(q.correct_answer))issues.push({question_id:q.question_id,code:'invalid_choices_or_key'});
   if(Number(q.part_number)<=4&&!(q.material_audio||q.audio_url))issues.push({question_id:q.question_id,code:'missing_audio_reference'});
   if(Number(q.part_number)===1&&!(q.image_url||q.group_image_url))issues.push({question_id:q.question_id,code:'missing_image_reference'});
   if(Number(q.part_number)>=6&&!q.passage_content&&!q.passage_image_url&&!(q.passages||[]).some(p=>p.content||p.image_url))issues.push({question_id:q.question_id,code:'missing_passage'});
   if(q.asset_checks?.some(a=>a.status==='missing_local_file'))issues.push({question_id:q.question_id,code:'missing_local_media'});
  }
  const content=qs.map(contentKey);
  if(new Set(content).size!==content.length)issues.push({code:'duplicate_content_within_form'});
  return {test_id:t.test_id,title:t.title,part:parts.length===1?parts[0]:null,questions:qs.length,
   published:t.publication_status==='published'&&t.is_active&&!t.deleted_at,
   technical_issues:issues,content_fingerprints:content,
   // Runtime fingerprint remains separate so historical readers retain their contract.
   runtime_fingerprints:qs.map(fingerprint),question_ids:qs.map(q=>q.question_id),
   contexts:[...new Set(qs.flatMap(contextKeys))],assets:qs.flatMap(q=>q.asset_checks||[]),
   content_reviewed:false,difficulty_comparability:'not_established'};
 });
 const byPart=Array.from({length:7},(_,i)=>{
  const f=forms.filter(f=>f.part===i+1&&f.published),pairs=[];
  for(let a=0;a<f.length;a++)for(let b=a+1;b<f.length;b++){
   const x=f[a],y=f[b];
   const sameIds=x.question_ids.filter(id=>y.question_ids.includes(id));
   const sameContent=x.content_fingerprints.filter(id=>y.content_fingerprints.includes(id));
   const sameContexts=x.contexts.filter(id=>y.contexts.includes(id));
   pairs.push({test_ids:[x.test_id,y.test_id],question_counts:[x.questions,y.questions],shared_question_ids:sameIds.length,
    shared_content:sameContent.length,shared_audio_or_passage:sameContexts.length,
    technical_candidate:!x.technical_issues.length&&!y.technical_issues.length&&!sameIds.length&&!sameContent.length&&!sameContexts.length,
    approved_for_validation:false,review_required:'Content, key, media meaning, equivalent conditions and representativeness require reviewer validation.'});
  }
  return {part:i+1,published_forms:f.length,technical_candidates:pairs.filter(p=>p.technical_candidate).length,pairs,
   status:f.length<2?'missing_second_published_form':pairs.some(p=>p.technical_candidate)?'awaiting_content_review':'technical_blockers'};
 });
 return {version:'app_ab_bank_research_v1',forms,by_part:byPart,approved_parts:0,
  note:'Structural checks cannot certify correct TOEIC content, audio-transcript alignment or equal difficulty. Shared references/content are conservative exclusion signals.'};
}
module.exports={buildResearchProfile,auditForms,contentKey,RESEARCH_MIN_DISTINCT};
