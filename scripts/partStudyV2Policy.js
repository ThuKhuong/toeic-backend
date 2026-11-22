// Research-only successor. Never modify the frozen v1 protocol or product routes.
const old = require('./partStudyPolicy');
const {fingerprint} = require('../src/modules/ai/appQuestionFeatures');
const {auditForms} = require('./appPartResearchPolicy');
const version = 'v2_part_study_v2';
const time = v => v == null ? NaN : new Date(v).getTime();
const positive = v => Number.isSafeInteger(v) && v > 0;
function assertDesign(d) {
  if (d.version !== version || !['workflow_pilot','confirmation'].includes(d.purpose)) throw Error('Explicit study version/purpose required');
  if (!d.participants?.length || d.participants.some(p => !positive(p.user_id)) || new Set(d.participants.map(p=>p.user_id)).size !== d.participants.length) throw Error('Register distinct real participants');
  if (d.forms?.length !== 7 || new Set(d.forms.map(f=>f.part)).size !== 7) throw Error('Seven distinct Parts required');
  if (!d.measurement_conditions?.trim() || !d.reviewed_by?.trim() || !(d.maximum_target_hours > 0) || !Number.isFinite(d.maximum_target_hours)) throw Error('Review measurement conditions and maximum target horizon');
  if (d.history_floor_distinct !== 10) throw Error('This version preserves the research floor of 10; not an ability threshold');
  const all=[];
  for (const f of d.forms) {
    if (!positive(f.part) || f.part>7 || !f.history_test_ids?.length || f.history_test_ids.some(x=>!positive(x)) || !positive(f.target_test_id)) throw Error('Valid registered A/B forms required');
    if (!['existing_or_new','after_registration'].includes(f.history_mode)) throw Error('Explicit history reuse policy required');
    if (f.content_reviewed!==true || f.comparable_measurement!==true || !f.reviewed_by?.trim() || !Number.isFinite(time(f.reviewed_at)) || !f.comparability_rationale?.trim()) throw Error('Document real content/comparability review; never auto-approve');
    all.push(...f.history_test_ids, f.target_test_id);
  }
  if (new Set(all).size!==all.length) throw Error('A/B form IDs must be distinct across study');
  if (d.purpose==='confirmation' && (!d.acceptance?.reviewed_by?.trim() || ['maximum_part_mae','minimum_mae_improvement','minimum_ranking_loss_improvement','maximum_observed_interval_width'].some(k=>typeof d.acceptance[k]!=='number'||!Number.isFinite(d.acceptance[k])||d.acceptance[k]<0||d.acceptance[k]>1))) throw Error('Confirmation needs reviewed acceptance criteria');
}
function assertTimes(attempts) {
  if (attempts.some(a=>!Number.isFinite(time(a.start_time)) || (a.is_completed && (!Number.isFinite(time(a.end_time)) || time(a.end_time)<time(a.start_time))))) throw Error('Invalid historical timestamps');
}
function exposure(s,userId,form) {
  return s.attempts.filter(a=>a.user_id===userId).some(a=>a.test_id===form.target_test_id || a.answers.some(q=>form.target_items.some(x=>x.id===q.question_id||x.fingerprint===fingerprint(q.question_snapshot))));
}
function freezeDesign(design,s) {
  const d=structuredClone(design); assertDesign(d); assertTimes(s.attempts);
  if (time(d.forms.reduce((m,f)=>time(f.reviewed_at)>time(m)?f.reviewed_at:m,'1970-01-01'))>time(s.context.as_of)) throw Error('Review cannot be in the future');
  if(d.participants.some(p=>!s.users.some(u=>u.user_id===p.user_id))) throw Error('Participant is not an existing STUDENT');
  const bank=auditForms(s.tests,s.questions);
  for(const f of d.forms) {
    const readForm=id=>{
      const b=bank.forms.find(b=>b.test_id===id);
      if(!b?.published || b.part!==f.part || !b.questions || b.technical_issues.length) throw Error('Invalid/unpublished or incomplete form '+id);
      return s.questions.filter(q=>q.test_id===id).map(q=>({id:q.question_id,fingerprint:fingerprint(q)}));
    };
    f.history_forms=f.history_test_ids.map(test_id=>({test_id,items:readForm(test_id)}));
    f.target_items=readForm(f.target_test_id);
    const sourceItems=f.history_forms.flatMap(h=>h.items);
    if(new Set(sourceItems.map(x=>x.fingerprint)).size!==sourceItems.length) throw Error('A forms contain duplicate content');
    for(const id of f.history_test_ids) {
      const pair=bank.by_part[f.part-1].pairs.find(p=>p.test_ids.includes(id)&&p.test_ids.includes(f.target_test_id));
      if(!pair?.technical_candidate) throw Error('A/B content or stimulus overlap');
    }
    if(d.participants.some(p=>exposure(s,p.user_id,f))) throw Error('Participant already exposed to B Part '+f.part);
  }
  return d;
}
function readiness(protocol,s,userId) {
  if(!protocol.design.participants.some(p=>p.user_id===userId)) throw Error('Unregistered participant');
  assertTimes(s.attempts.filter(a=>a.user_id===userId));
  const h=old.history(s.attempts,userId,s.context.as_of), blockers=[];
  for(const f of protocol.design.forms) {
    if(exposure(s,userId,f)) blockers.push({part:f.part,reason:'target_already_exposed'});
    for(const form of f.history_forms) {
      const completed=s.attempts.filter(a=>a.user_id===userId&&a.test_id===form.test_id&&a.is_completed&&time(a.end_time)<=time(s.context.as_of)&&
        (f.history_mode==='existing_or_new'||time(a.start_time)>time(protocol.frozen_at)));
      if(!completed.some(a=>a.answers.length===form.items.length&&a.answers.every(q=>form.items.some(x=>x.id===q.question_id&&x.fingerprint===fingerprint(q.question_snapshot))))) blockers.push({part:f.part,test_id:form.test_id,reason:'history_form_not_completed_unchanged'});
    }
    if(h.parts[f.part-1].distinct<protocol.design.history_floor_distinct) blockers.push({part:f.part,reason:'insufficient_distinct_answered_history',distinct:h.parts[f.part-1].distinct});
  }
  return {history:h,blockers,ready:blockers.length===0};
}
function validatePredictions(h,rs,hash,median) {
  if(rs.length!==7||new Set(rs.map(r=>r.part)).size!==7) throw Error('Exactly seven V2 outputs required');
  for(const p of h.parts) {
    const r=rs.find(r=>r.part===p.part),i=p.input;
    const expected={part:p.part,user_acc:(i.correct_count+1)/(i.answered_count+2),user_part_acc:p.baseline_probability,attempt_count:i.answered_count,user_part_count:i.part_answered_count,prior_elapsed_seconds:median,elapsed_time_missing:1};
    if(!r||r.model!=='lightgbm_v2'||r.artifact_sha256!==hash||typeof r.probability!=='number'||!Number.isFinite(r.probability)||r.probability<0||r.probability>1||Object.entries(expected).some(([k,v])=>typeof r.features?.[k]!=='number'||!Number.isFinite(r.features[k])||Math.abs(r.features[k]-v)>1e-12)) throw Error('V2 artifact/feature/probability mismatch');
  }
}
function evaluate(frozen,attempts,p) {
  if(frozen.version!==version || frozen.protocol_sha256!==p.protocol_sha256 || time(frozen.as_of)<time(p.frozen_at)) throw Error('V2 capture identity/timing mismatch');
  assertTimes(attempts.filter(a=>a.user_id===frozen.user_id));
  // Explicit compatibility adapter reuses frozen v1 scoring, not its capture policy.
  const cohort=p.design.purpose==='workflow_pilot'?'development':'confirmation';
  const adapted={...p,version:old.version,design:{...p.design,participants:p.design.participants.map(x=>({...x,cohort}))}};
  const within=[],late=[];
  for(const f of p.design.forms) {
    const first=attempts.filter(a=>a.user_id===frozen.user_id&&a.test_id===f.target_test_id).sort((a,b)=>time(a.start_time)-time(b.start_time)||a.attempt_id-b.attempt_id)[0];
    if(first && (time(first.start_time)-time(frozen.as_of)>p.design.maximum_target_hours*3600000 || (first.is_completed&&time(first.end_time)-time(frozen.as_of)>p.design.maximum_target_hours*3600000))) late.push({part:f.part,reason:'outside_registered_measurement_horizon'});
    else within.push(f);
  }
  adapted.design.forms=within;
  const result=old.evaluate({...frozen,version:old.version},attempts,adapted);
  return {...result,version,purpose:p.design.purpose,excluded:[...result.excluded,...late],compatibility_evaluator:'partStudyPolicy.v1.evaluate',production_ai_enabled:false};
}
module.exports={version,assertDesign,freezeDesign,readiness,validatePredictions,evaluate};
