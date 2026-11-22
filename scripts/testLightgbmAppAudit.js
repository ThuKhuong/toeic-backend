const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, compare, collect, parseArgs, verifyProtocol, assertDev, summaryMarkdown } = require('./auditLightgbmApp');
const { fingerprint, buildAppQuestionPreview } = require('../src/modules/ai/appQuestionFeatures');
const hashes = { v2: 'a'.repeat(64), v3: 'b'.repeat(64) };
function attempt(id, day, part = 5, answer = 'A', user = 1) {
  const q = { question_id: part, part_number: part, question_text: 'Audit fixture', correct_answer: 'A',
    choices: (part === 2 ? ['A','B','C'] : ['A','B','C','D']).map(choice_label => ({ choice_label, choice_text: choice_label })) };
  return { attempt_id: id, user_id: user, is_completed: true, start_time: `2026-11-${day}T00:00:00Z`, end_time: `2026-11-${day}T01:00:00Z`, answers: [{ question_id: part, question_snapshot: q, user_answer: answer, answered_at: `2026-11-${day}T00:30:00Z`, first_answer_at: `2026-11-${day}T00:30:00Z` }] };
}
function v2(a) {
  a.ai_prediction = { version: 'attempt_lightgbm_v1', status: 'ready', as_of: a.end_time, completed_at: a.end_time.replace('00:00Z','00:01Z'),
    inputs: [{ part: a.answers[0].question_snapshot.part_number, answered_count: 1, correct_count: 1, part_answered_count: 1, part_correct_count: 1 }],
    parts: [{ part: a.answers[0].question_snapshot.part_number, status:'ready', model:'lightgbm_v2', artifact_sha256:hashes.v2, probability:.7, feature_version:'group_history_v1', time_feature_missing:true }] };
}
function v3(a, all) {
  const evidence = all.filter(x => x.is_completed).flatMap(x => x.answers.map(r => ({ ...r,user_id:x.user_id,is_completed:true,end_time:x.end_time })));
  a.question_predictions = { status:'ready',mode:'app_observation_only',model:'lightgbm_question_catalog_v3',artifact_sha256:hashes.v3,version:'app_question_catalog_v1',as_of:a.start_time,
    recorded_at:a.start_time.replace('00:00:00','00:00:01'),questions:a.answers.map(r => {
      const preview = buildAppQuestionPreview({question:r.question_snapshot,userId:a.user_id,evidence,asOf:a.start_time});
      return {question_id:r.question_id,part:r.question_snapshot.part_number,question_fingerprint:fingerprint(r.question_snapshot),features:preview.features,probability:.6,baseline_probability:preview.features.user_part_acc};
    }) };
}
const report = all => buildReport(all, [], hashes, Date.parse('2026-11-17T00:00:00Z'));

test('migration preserves legacy source scope; new canonical predictions see both past cohorts', () => {
  const legacy=attempt(1,'02',5,'A',3), main=attempt(2,'01',5,'B',2);
  legacy.capture_origin='toeic_learning_events_dev';main.capture_origin='toeic_learning_system';
  v3(legacy,[legacy]);
  assert.equal(report([legacy,main]).v3_pre_attempt.overall.model.rows,0);
  const options={respectCaptureOrigin:true};
  assert.equal(buildReport([legacy,main],[],hashes,Date.parse('2026-11-17T00:00:00Z'),options).v3_pre_attempt.overall.model.rows,1);
  const future=attempt(3,'03',5,'A',3);v3(future,[legacy,main,future]);
  assert.equal(buildReport([legacy,main,future],[],hashes,Date.parse('2026-11-17T00:00:00Z'),options).v3_pre_attempt.overall.model.rows,2);
});

test('post-submission v2 never scores its donor labels', () => {
  const a=attempt(1,'01');v2(a);const r=report([a]);
  assert.equal(r.v2_next_attempt.overall.model.rows,0);
  assert.equal(r.exclusions.v2.no_next_completed_part_attempt,1);
});
test('v2 scores next Part attempt with a frozen pre-target baseline', () => {
  const a=attempt(1,'01'),b=attempt(2,'02',5,'B');v2(a);
  const r=report([a,b]);assert.equal(r.v2_next_attempt.overall.model.rows,1);
  assert.ok(Math.abs(r.v2_next_attempt.overall.model.log_loss+Math.log(.3))<1e-12);
  assert.ok(Math.abs(r.v2_next_attempt.overall.baseline.log_loss+Math.log(1/3))<1e-12);
});
test('retroactively saved v2 is not prospective evidence', () => {
  const a=attempt(1,'01'),b=attempt(2,'02');v2(a);a.ai_prediction.completed_at=b.end_time;
  const r=report([a,b]);assert.equal(r.v2_next_attempt.overall.model.rows,0);
  assert.equal(r.exclusions.v2.prediction_saved_after_next_attempt_started,1);
});
test('v2 rejects mismatched artifact and history counts', () => {
  const a=attempt(1,'01'),b=attempt(2,'02');v2(a);a.ai_prediction.inputs[0].answered_count=9;
  assert.equal(report([a,b]).exclusions.v2.history_cutoff_mismatch,1);
  v2(a);a.ai_prediction.parts[0].artifact_sha256='wrong';assert.equal(report([a,b]).exclusions.v2.artifact_or_input_mismatch,1);
});
test('v3 checks seven Parts, replay, repeat and other-user catalog separately', () => {
  for(let part=1;part<=7;part++) {
    const a=attempt(1,'01',part),b=attempt(2,'02',part,'B');v3(b,[a,b]);
    const r=report([a,b]);assert.equal(r.v3_pre_attempt.overall.model.rows,1);
    assert.equal(r.v3_pre_attempt.by_part[part-1].model.rows,1);
    assert.equal(r.v3_pre_attempt.repeat.model.rows,1);assert.equal(r.v3_pre_attempt.with_catalog.model.rows,0);
  }
});
test('v3 excludes blank answers and invalid Part 2 choice D', () => {
  const a=attempt(1,'01',5,null);v3(a,[a]);assert.equal(report([a]).exclusions.v3.blank,1);
  const b=attempt(2,'02',2,'D');v3(b,[b]);assert.equal(report([b]).exclusions.v3.invalid_answer_or_key,1);
});
test('v3 rejects label-after-answer prediction timing, edited content and fabricated baseline', () => {
  const a=attempt(1,'01');v3(a,[a]);a.question_predictions.recorded_at=a.end_time;
  assert.equal(report([a]).exclusions.v3.prediction_after_answer,1);
  v3(a,[a]);a.question_predictions.questions[0].question_fingerprint='wrong';assert.equal(report([a]).exclusions.v3.question_version_or_part_mismatch,1);
  v3(a,[a]);a.question_predictions.questions[0].baseline_probability=.9;assert.equal(report([a]).exclusions.v3.frozen_features_or_baseline_mismatch,1);
});
test('v3 refuses current/future history leakage and duplicate question expansion', () => {
  const a=attempt(1,'01');v3(a,[a]);a.question_predictions.questions[0].features.attempt_count=1;
  assert.equal(report([a]).exclusions.v3.frozen_features_or_baseline_mismatch,1);
  v3(a,[a]);a.question_predictions.questions.push({...a.question_predictions.questions[0]});assert.equal(report([a]).exclusions.v3.invalid_question_set,1);
});
test('single learner produces no pretend confidence interval; user clustering is paired', () => {
  const one=[{user:1,actual:1,probability:.8,baseline_probability:.5}];assert.equal(compare(one).paired_user_bootstrap_95,null);
  const r=compare([...one,{user:2,actual:0,probability:.2,baseline_probability:.5}]);
  assert.ok(r.paired_user_bootstrap_95[1]<0);assert.ok(r.model.log_loss<r.baseline.log_loss);
});
test('inventory retains unobserved Parts; audit never automatically enables ability scoring', () => {
  const r=report([attempt(1,'01')]);assert.equal(r.inventory.length,7);assert.equal(r.inventory[1].answered,0);
  assert.equal(r.release.decision,'not_approved_by_audit');assert.equal(r.v3_pre_attempt.overall.model.rows,0);
  assert.equal(JSON.stringify(r).includes('user_id'),false);
});

test('missing or invalid as_of is rejected rather than passing a NaN comparison', () => {
  const a=attempt(1,'01'),b=attempt(2,'02');v2(a);delete a.ai_prediction.as_of;
  assert.equal(report([a,b]).exclusions.v2.invalid_anchor_timing,1);
  v3(b,[a,b]);delete b.question_predictions.as_of;
  assert.equal(report([a,b]).exclusions.v3.invalid_pre_answer_timing,1);
  b.question_predictions.as_of='invalid';assert.equal(report([a,b]).v3_pre_attempt.overall.model.rows,0);
});

test('no mutable last-save timestamp can replace first server-persisted response evidence', () => {
  const a=attempt(1,'01');v3(a,[a]);delete a.answers[0].first_answer_at;
  assert.equal(report([a]).exclusions.v3.missing_or_invalid_first_answer_evidence,1);
  a.answers[0].first_answer_at=a.start_time;
  a.answers[0].answered_at=a.end_time;
  assert.equal(report([a]).exclusions.v3.prediction_after_answer,1);
  a.answers[0].first_answer_at=a.question_predictions.recorded_at;
  assert.equal(report([a]).exclusions.v3.prediction_after_answer,1);
});

test('v2 also requires known initial answer evidence and strict pre-target recording', () => {
  const a=attempt(1,'01'),b=attempt(2,'02');v2(a);delete b.answers[0].first_answer_at;
  assert.equal(report([a,b]).exclusions.v2.missing_or_invalid_first_answer_evidence,1);
  b.answers[0].first_answer_at=b.end_time;a.ai_prediction.completed_at=b.start_time;
  assert.equal(report([a,b]).exclusions.v2.prediction_saved_after_next_attempt_started,1);
  a.ai_prediction.completed_at='2026-11-18T00:00:00Z';
  assert.equal(report([a,b]).exclusions.v2.invalid_anchor_timing,1);
});

test('nonfinite feature snapshots and probabilities are never evaluation evidence', () => {
  const a=attempt(1,'01');
  for(const bad of [NaN,Infinity,null,'0']) {
    v3(a,[a]);a.question_predictions.questions[0].features.user_part_acc=bad;
    assert.equal(report([a]).exclusions.v3.frozen_features_or_baseline_mismatch,1);
  }
  v3(a,[a]);a.question_predictions.questions[0].probability=NaN;
  assert.equal(report([a]).v3_pre_attempt.overall.model.rows,0);
});

test('malformed records are excluded without crashing or silently expanding labels', () => {
  const a=attempt(1,'01');v3(a,[a]);a.question_predictions.questions=[null];
  assert.equal(report([a]).exclusions.v3.invalid_question_set,1);
  a.ai_prediction={parts:{part:5}};assert.equal(report([a]).exclusions.v2.invalid_prediction_parts,1);
  v3(a,[a]);a.answers[0].question_snapshot=null;
  assert.equal(report([a]).exclusions.v3.question_version_or_part_mismatch,1);
  a.start_time=a.end_time;assert.equal(report([a]).collection.completed_attempts_rejected,1);
});

test('target window keeps warm-up history and never includes future completed labels', () => {
  const a=attempt(1,'01'),b=attempt(2,'02'),future=attempt(3,'18',5,'B');v3(a,[a,b]);v3(b,[a,b]);
  const r=buildReport([a,b,future],[],hashes,Date.parse('2026-11-17T00:00:00Z'),{targetAfter:b.start_time});
  assert.equal(r.collection.completed_attempts,2);assert.equal(r.collection.target_attempts,1);
  assert.equal(r.v3_pre_attempt.overall.model.rows,1);assert.equal(r.v3_pre_attempt.repeat.model.rows,1);
  assert.ok(Math.abs(r.v3_pre_attempt.overall.baseline.log_loss+Math.log(2/3))<1e-12);
  assert.throws(()=>buildReport([a],[],hashes,1,{targetAfter:b.start_time}),/window/);
});

test('other accounts contribute only past catalog evidence, never personal Part accuracy', () => {
  const other=attempt(1,'01',5,'A',9),own=attempt(2,'02',5,'B',1),future=attempt(3,'03',5,'A',8);
  v3(own,[other,own,future]);const r=report([other,own,future]).v3_pre_attempt;
  assert.equal(r.cold_user.model.rows,1);assert.equal(r.cold_part.model.rows,1);
  assert.equal(r.with_catalog.model.rows,1);assert.equal(r.first_exposure.model.rows,1);
  assert.ok(Math.abs(r.overall.baseline.log_loss-Math.log(2))<1e-12);
});

test('macro-user metrics reduce dominance from a prolific learner; paired CIs are reproducible', () => {
  const rs=[...Array.from({length:9},()=>({user:1,actual:1,probability:.9,baseline_probability:.5})),
    {user:2,actual:0,probability:.9,baseline_probability:.5}];
  const r=compare(rs);assert.notEqual(r.model.log_loss,r.macro_per_learner.model.log_loss);
  assert.ok(Math.abs(r.macro_per_learner.model.log_loss-(-Math.log(.9)-Math.log(.1))/2)<1e-12);
  assert.deepEqual(compare(rs),r);
  for(const key of ['paired_user_bootstrap_95','paired_user_brier_bootstrap_95','paired_user_macro_log_loss_bootstrap_95','paired_user_macro_brier_bootstrap_95']) assert.equal(r[key].length,2);
  assert.equal(r.macro_per_learner.model.auc_eligible_learners,0);
});

test('both forecasts have calibration bins; AUC requires both classes and handles ties', () => {
  const one=[{user:1,actual:1,probability:.8,baseline_probability:.5}];
  const r=compare(one);assert.equal(r.model.roc_auc,null);assert.equal(r.ece.baseline,.5);
  assert.equal(r.baseline_calibration[0].n,1);assert.equal(r.paired_user_brier_bootstrap_95,null);
  const both=compare([...one,{user:1,actual:0,probability:.8,baseline_probability:.5}]);
  assert.equal(both.model.roc_auc,.5);assert.equal(both.baseline.roc_auc,.5);
  assert.equal(compare([]).ece.model,null);
  assert.throws(()=>compare([{...one[0],probability:2}]),/probabilities/);
});

test('CLI rejects unintended DB options, timezone-free cutoffs and conflicting protocols', () => {
  assert.deepEqual(parseArgs([]),{});
  assert.equal(parseArgs(['--after','2026-11-18T15:00:00Z']).targetAfter,'2026-11-18T15:00:00Z');
  for(const args of [['--database','toeic_learning_system'],['--until','2026-11-18'],['--protocol','x','--after','2026-11-18T00:00:00Z'],['--freeze-protocol','--until','2026-11-18T00:00:00Z'],['--unknown'],['--after']]) assert.throws(()=>parseArgs(args));
  assert.throws(()=>assertDev({database:'toeic_learning_system',marker:'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT'}),/marked/);
  assert.throws(()=>assertDev({database:'toeic_learning_events_dev',marker:null}),/marked/);
});

test('frozen protocol refuses model/code changes and aggregate outputs contain no response payload', () => {
  const p={version:'lightgbm_app_prospective_audit_v2',database:'toeic_learning_events_dev',target_start_at_or_after:'2026-11-18T00:00:00Z',artifact_sha256:hashes,code_sha256:{a:'b'}};
  assert.equal(verifyProtocol(p,hashes,{a:'b'}),p.target_start_at_or_after);
  assert.throws(()=>verifyProtocol(p,{...hashes,v3:'changed'},{a:'b'}),/mismatch/);
  assert.throws(()=>verifyProtocol(p,hashes,{a:'changed'}),/mismatch/);
  const a=attempt(1,'01');v3(a,[a]);const r=report([a]);r.context={database:'toeic_learning_events_dev'};
  const text=JSON.stringify(r)+summaryMarkdown(r);
  for(const secret of ['question_snapshot','correct_answer','user_answer','Audit fixture','user_id','question_id']) assert.equal(text.includes(secret),false,secret);
});

test('read-only collection rolls back and stops before reading attempts on wrong database', async () => {
  const calls=[];const client={query:async(sql)=>{calls.push(sql);if(sql.includes('current_database()'))return {rows:[{database:'toeic_learning_system',read_only:'on',captured_at:new Date()}]};return{rows:[]};}};
  await assert.rejects(collect(client,hashes,{requireDev:true}),/marked/);
  assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(calls.at(-1),'ROLLBACK');assert.equal(calls.some(sql=>sql.includes('FROM user_test_attempts')),false);
});

test('v2 does not skip a blank next Part attempt to select a later favourable target', () => {
  const a=attempt(1,'01'),blank=attempt(2,'02',5,null),later=attempt(3,'03');v2(a);
  const r=report([a,blank,later]);assert.equal(r.v2_next_attempt.overall.model.rows,0);
  assert.equal(r.exclusions.v2.blank,1);
});
