// Research only. Never imported by product routes; no fitting or persistence.
const { compare } = require('./lightgbmValidationMetrics');
const { fingerprint } = require('../src/modules/ai/appQuestionFeatures');
const version = 'v2_part_study_v1';
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const time = v => v == null ? NaN : new Date(v).getTime();
const probability = p => typeof p === 'number' && Number.isFinite(p) && p>=0 && p<=1;
function answer(q) {
  const s=q.question_snapshot,part=Number(s?.part_number),labels=part===2?['A','B','C']:['A','B','C','D'];
  if(!Number.isInteger(part)||part<1||part>7||!labels.includes(s?.correct_answer)||
    !Array.isArray(s.choices)||!s.choices.some(c=>c.choice_label===s.correct_answer)) throw Error('Invalid snapshot/key');
  if(q.user_answer!=null&&(!labels.includes(q.user_answer)||!s.choices.some(c=>c.choice_label===q.user_answer))) throw Error('Invalid answer');
  return {part,actual:q.user_answer==null?null:Number(q.user_answer===s.correct_answer),
    fingerprint:fingerprint(s),id:q.question_id};
}
function wilson(correct,n) {
  if(!n)return null;
  const z=1.959963984540054,p=correct/n,d=1+z*z/n,c=(p+z*z/(2*n))/d;
  const h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
function history(attempts,userId,cutoff) {
  const until=time(cutoff);if(!Number.isFinite(until))throw Error('Invalid cutoff');
  const counts=Array.from({length:7},(_,i)=>({part:i+1,answered:0,correct:0,first_correct:0,distinct: new Set()}));
  const exposed=new Set(),ids=new Set(),source=[];
  for(const a of attempts.filter(a=>a.user_id===userId).sort((a,b)=>time(a.end_time||a.start_time)-time(b.end_time||b.start_time)||a.attempt_id-b.attempt_id)) {
    if(time(a.start_time)>until)continue;
    for(const q of a.answers){const x=answer(q);exposed.add(x.fingerprint);ids.add(x.id);}
    if(!a.is_completed||!Number.isFinite(time(a.end_time))||time(a.end_time)>until||time(a.end_time)<time(a.start_time))continue;
    source.push(a.attempt_id);
    for(const q of a.answers){const x=answer(q);if(x.actual===null)continue;
      const c=counts[x.part-1];c.answered++;c.correct+=x.actual;
      if(!c.distinct.has(x.fingerprint)){c.first_correct+=x.actual;c.distinct.add(x.fingerprint);}}
  }
  const total=counts.reduce((n,c)=>n+c.answered,0),correct=counts.reduce((n,c)=>n+c.correct,0);
  return {source_attempt_ids:source,exposed_fingerprints:[...exposed],exposed_ids:[...ids],
    parts:counts.map(c=>({part:c.part,distinct:c.distinct.size,first_correct_rate:c.distinct.size?c.first_correct/c.distinct.size:null,
      observed_wilson_95:wilson(c.first_correct,c.distinct.size),baseline_probability:(c.correct+1)/(c.answered+2),
      input:{part:c.part,answered_count:total,correct_count:correct,part_answered_count:c.answered,part_correct_count:c.correct}}))};
}
function assertDesign(d) {
  if(d.version!==version||!Array.isArray(d.participants)||!d.participants.length||!Array.isArray(d.forms)||d.forms.length!==7)throw Error('Study needs participants and seven forms');
  if(new Set(d.participants.map(p=>p.user_id)).size!==d.participants.length||d.participants.some(p=>!Number.isSafeInteger(p.user_id)||p.user_id<1||!['development','confirmation'].includes(p.cohort)))throw Error('Invalid participant/cohort');
  if(new Set(d.forms.map(f=>f.part)).size!==7)throw Error('Duplicate Part');
  for(const f of d.forms)if(!Number.isInteger(f.part)||f.part<1||f.part>7||
    !Number.isSafeInteger(f.history_test_id)||!Number.isSafeInteger(f.target_test_id)||f.history_test_id<1||f.target_test_id<1||
    f.history_test_id===f.target_test_id||!f.reviewed_by?.trim()||!f.reviewed_at||!Number.isFinite(time(f.reviewed_at))||
    f.content_reviewed!==true||f.comparable_measurement!==true||!f.comparability_rationale?.trim())throw Error('Forms require real IDs and documented content/comparability review');
  const ids=d.forms.flatMap(f=>[f.history_test_id,f.target_test_id]);
  if(new Set(ids).size!==ids.length)throw Error('Use fourteen distinct single-Part test forms');
  if(!d.measurement_conditions?.trim())throw Error('Document timing, feedback and session conditions');
  if(!d.planning||!['development_learners','confirmation_learners'].every(k=>Number.isSafeInteger(d.planning[k])&&d.planning[k]>0))throw Error('Explicit positive pilot counts required');
  for(const cohort of ['development','confirmation'])if(d.participants.filter(p=>p.cohort===cohort).length!==d.planning[cohort+'_learners'])throw Error('Enroll the planned cohort before freezing; never add favourable learners after seeing results');
}
function evaluate(frozen,attempts,protocol) {
  const rows=[],units=[],excluded=[];
  const learner=protocol.design.participants.find(p=>p.user_id===frozen.user_id);
  if(!learner||frozen.protocol_sha256!==protocol.protocol_sha256||frozen.version!==version||
    !Number.isFinite(time(frozen.recorded_at))||time(frozen.recorded_at)<time(protocol.frozen_at)||
    !Number.isFinite(time(frozen.as_of))||time(frozen.as_of)>time(frozen.recorded_at))throw Error('Frozen study identity/timing mismatch');
  for(const f of protocol.design.forms){
    const estimate=frozen.parts.find(p=>p.part===f.part);
    const fail=reason=>excluded.push({part:f.part,reason});
    if(!estimate||estimate.status!=='ready'){fail('no_valid_frozen_estimate');continue;}
    if(!probability(estimate.probability)||!probability(estimate.baseline_probability)||
      Math.abs(estimate.baseline_probability-(estimate.input.part_correct_count+1)/(estimate.input.part_answered_count+2))>1e-12)throw Error('Invalid frozen probabilities');
    // First presentation, including incomplete attempts: never skip an unfavourable target.
    const candidates=attempts.filter(a=>a.user_id===frozen.user_id&&a.test_id===f.target_test_id)
      .sort((a,b)=>time(a.start_time)-time(b.start_time)||a.attempt_id-b.attempt_id);
    const a=candidates[0];
    if(!a){fail('target_not_started');continue;}
    if(time(a.start_time)<=time(frozen.recorded_at)){fail('target_not_after_capture');continue;}
    if(!a.is_completed||!Number.isFinite(time(a.end_time))||time(a.end_time)<=time(a.start_time)){fail('first_target_incomplete');continue;}
    if(a.answers.length!==f.target_items.length){fail('target_item_set_mismatch');continue;}
    const xs=a.answers.map(q=>({...answer(q),first:q.first_answer_at}));
    if(new Set(xs.map(x=>x.id)).size!==xs.length||xs.some(x=>x.part!==f.part||!f.target_items.some(i=>i.id===x.id&&i.fingerprint===x.fingerprint))){fail('target_content_changed');continue;}
    if(xs.some(x=>frozen.exposed_ids.includes(x.id)||frozen.exposed_fingerprints.includes(x.fingerprint))){fail('repeat_target');continue;}
    // Any intervening exposure, even a blank/incomplete attempt, disqualifies independence.
    const other=attempts.filter(h=>h.user_id===a.user_id&&h.attempt_id!==a.attempt_id&&time(h.start_time)>time(frozen.as_of)&&time(h.start_time)<=time(a.start_time));
    if(other.some(h=>h.answers.some(q=>xs.some(x=>x.id===q.question_id||x.fingerprint===fingerprint(q.question_snapshot))))){fail('intervening_target_exposure');continue;}
    const answered=xs.filter(x=>x.actual!==null);
    if(!answered.length){fail('all_blank');continue;}
    if(answered.some(x=>!Number.isFinite(time(x.first))||time(x.first)<=time(frozen.recorded_at)||time(x.first)<time(a.start_time)||time(x.first)>time(a.end_time))){fail('missing_first_revision_or_invalid_timing');continue;}
    const correct=answered.reduce((n,x)=>n+x.actual,0),n=answered.length,rate=correct/n;
    const ci=wilson(correct,n);
    units.push({part:f.part,attempt:a.attempt_id,issued:xs.length,answered:n,blank:xs.length-n,correct,observed_rate:rate,
      observed_wilson_95:ci,model:estimate.probability,baseline:estimate.baseline_probability,
      all_issued_rate_sensitivity:correct/xs.length,observed_interval_width:ci[1]-ci[0],
      squared_error_model:(estimate.probability-rate)**2,squared_error_baseline:(estimate.baseline_probability-rate)**2,
      absolute_error_model:Math.abs(estimate.probability-rate),absolute_error_baseline:Math.abs(estimate.baseline_probability-rate)});
    rows.push(...answered.map(x=>({user:a.user_id,attempt:a.attempt_id,question:x.id,part:f.part,actual:x.actual,
      probability:estimate.probability,baseline_probability:estimate.baseline_probability})));
  }
  const pairs=[];
  for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
    const a=units[i],b=units[j],truth=Math.sign(a.observed_rate-b.observed_rate);
    if(!truth)continue;
    const loss=key=>Math.sign(a[key]-b[key])===truth?0:(a[key]===b[key]?0.5:1);
    const separated=a.observed_wilson_95[0]>b.observed_wilson_95[1]||b.observed_wilson_95[0]>a.observed_wilson_95[1];
    pairs.push({parts:[a.part,b.part],model_loss:loss('model'),baseline_loss:loss('baseline'),observed_intervals_separated:separated});
  }
  return {cohort:learner.cohort,units,excluded,response_metrics:compare(rows),
    mae_model:mean(units.map(u=>u.absolute_error_model)),mae_baseline:mean(units.map(u=>u.absolute_error_baseline)),
    ranking:{eligible_parts:units.length,complete_seven_parts:units.length===7,pairs,
      pairwise_loss_model:mean(pairs.map(p=>p.model_loss)),pairwise_loss_baseline:mean(pairs.map(p=>p.baseline_loss)),
      note:'Observed Wilson intervals describe answer sampling only; NOT model confidence. Comparisons require reviewed forms; no ability labels.'},
    production_ai_enabled:false,decision:'research_only_not_approved'};
}
function candidatePairs(parts) {
  // AI supplies the ordering; history supplies a consistency/precision check, never a weighted AI score.
  const pairs=[];
  for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
    const a=parts[i],b=parts[j];if(a.status!=='ready'||b.status!=='ready')continue;
    const ai=Math.sign(a.probability-b.probability),observed=Math.sign(a.first_correct_rate-b.first_correct_rate);
    const separated=a.observed_wilson_95&&b.observed_wilson_95&&
      (a.observed_wilson_95[0]>b.observed_wilson_95[1]||b.observed_wilson_95[0]>a.observed_wilson_95[1]);
    pairs.push({parts:[a.part,b.part],ai_lower:ai<0?a.part:ai>0?b.part:null,
      status:ai===0?'model_tie':ai!==observed?'model_history_disagree':!separated?'observed_uncertainty':'research_candidate_only'});
  }
  return {pairs,production_ai_enabled:false,note:'No ability labels. Wilson intervals are historical response uncertainty, not a V2 confidence interval; correlated items can widen uncertainty.'};
}
function clusteredInterval(values) {
  if(values.length<2)return null;
  let seed=20261120;const samples=[];
  for(let b=0;b<1000;b++){let sum=0;for(let i=0;i<values.length;i++){
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;sum+=values[Math.floor(seed/4294967296*values.length)];
  }samples.push(sum/values.length);}
  samples.sort((a,b)=>a-b);return [samples[24],samples[974]];
}
function calibrationUnits(units,key){
  const bins=Array.from({length:10},(_,bin)=>({bin,answered:0,correct:0,sum_probability:0}));
  for(const u of units){const b=bins[Math.min(9,Math.floor(u[key]*10))];b.answered+=u.answered;b.correct+=u.correct;b.sum_probability+=u[key]*u.answered;}
  const n=bins.reduce((n,b)=>n+b.answered,0);
  const populated=bins.filter(b=>b.answered).map(b=>({bin:b.bin,answered:b.answered,observed_rate:b.correct/b.answered,mean_probability:b.sum_probability/b.answered}));
  return {bins:populated,ece:n?populated.reduce((s,b)=>s+b.answered*Math.abs(b.observed_rate-b.mean_probability),0)/n:null};
}
function summarize(results,design){
  const groups={};
  for(const cohort of ['development','confirmation']){
    const rs=results.filter(r=>r.cohort===cohort),complete=rs.filter(r=>r.ranking.complete_seven_parts);
    const errors=complete.map(r=>r.mae_model-r.mae_baseline);
    const rank=complete.filter(r=>r.ranking.pairwise_loss_model!==null).map(r=>r.ranking.pairwise_loss_model-r.ranking.pairwise_loss_baseline);
    groups[cohort]={captured_learners:rs.length,complete_seven_part_learners:complete.length,
      calibration_model:calibrationUnits(rs.flatMap(r=>r.units),'model'),calibration_baseline:calibrationUnits(rs.flatMap(r=>r.units),'baseline'),
      macro_mae_delta_model_minus_baseline:mean(errors),paired_learner_mae_delta_95:clusteredInterval(errors),
      macro_response_log_loss_model:mean(rs.map(r=>r.response_metrics.model.log_loss).filter(v=>v!==null)),
      macro_response_log_loss_baseline:mean(rs.map(r=>r.response_metrics.baseline.log_loss).filter(v=>v!==null)),
      macro_response_brier_model:mean(rs.map(r=>r.response_metrics.model.brier_score).filter(v=>v!==null)),
      macro_response_brier_baseline:mean(rs.map(r=>r.response_metrics.baseline.brier_score).filter(v=>v!==null)),
      macro_ranking_loss_delta_model_minus_baseline:mean(rank),paired_learner_ranking_delta_95:clusteredInterval(rank),
      by_part:Array.from({length:7},(_,i)=>{const us=rs.flatMap(r=>r.units.filter(u=>u.part===i+1));
        return {part:i+1,learners:us.length,mae_model:mean(us.map(u=>u.absolute_error_model)),mae_baseline:mean(us.map(u=>u.absolute_error_baseline)),
          rmse_model:us.length?Math.sqrt(mean(us.map(u=>u.squared_error_model))):null,
          rmse_baseline:us.length?Math.sqrt(mean(us.map(u=>u.squared_error_baseline))):null,
          mean_completion:mean(us.map(u=>u.answered/u.issued)),
          mae_delta_95:clusteredInterval(us.map(u=>u.absolute_error_model-u.absolute_error_baseline))};})};
  }
  const a=design.acceptance,c=groups.confirmation;
  const reviewed=!!a?.reviewed_by?.trim()&&['maximum_part_mae','minimum_mae_improvement','minimum_ranking_loss_improvement','maximum_observed_interval_width']
    .every(k=>typeof a[k]==='number'&&Number.isFinite(a[k])&&a[k]>=0&&a[k]<=1);
  return {cohorts:groups,acceptance_criteria_reviewed:reviewed,
    review_conditions:{planned_confirmation_complete:c.complete_seven_part_learners>=design.planning.confirmation_learners,
      mae_interval_exceeds_margin:reviewed&&c.paired_learner_mae_delta_95?.[1]<-a.minimum_mae_improvement||false,
      ranking_interval_exceeds_margin:reviewed&&c.paired_learner_ranking_delta_95?.[1]<-a.minimum_ranking_loss_improvement||false,
      all_part_mae_within_tolerance:reviewed&&c.by_part.every(p=>p.learners>=design.planning.confirmation_learners&&p.mae_model<=a.maximum_part_mae)||false,
      all_observed_intervals_within_reviewed_width:reviewed&&results.filter(r=>r.cohort==='confirmation').length>0&&
        results.filter(r=>r.cohort==='confirmation').every(r=>r.ranking.complete_seven_parts&&r.units.every(u=>u.observed_interval_width<=a.maximum_observed_interval_width))||false},
    decision:'manual_review_required_no_production_approval',production_ai_enabled:false,
    limitations:['Pilot counts are feasibility targets, not statistical power guarantees.','User bootstrap does not remove shared item/audio/passage dependence.',
      'Independent form rates are performance evidence, not latent ability ground truth.','Calibration, subgroup errors and all-issued/blank sensitivity require review before any release.']};
}
module.exports={version,history,answer,wilson,assertDesign,evaluate,candidatePairs,summarize};
