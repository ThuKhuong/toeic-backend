// Explicit research CLI. SELECT-only PostgreSQL + local V2 inference; no product imports or training.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {version,history,assertDesign,evaluate,candidatePairs,summarize}=require('./partStudyPolicy');
const {fingerprint}=require('../src/modules/ai/appQuestionFeatures');
const root=path.resolve(__dirname,'../..'),privateRoot=path.join(root,'toeic_be/private/ai/part-study');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const digest=v=>sha(JSON.stringify(v));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const hashes=()=>Object.fromEntries(['toeic-ai/models/v2/lightgbm_v2.joblib','toeic-ai/models/v3_app_shadow/model.joblib',
 'toeic-ai/src/predictor.py','toeic-ai/data/feature_config_v2.json','toeic_be/scripts/partStudy.js','toeic_be/scripts/partStudyPolicy.js',
 'toeic_be/scripts/lightgbmValidationMetrics.js','toeic_be/scripts/reportQuestionPredictions.js','toeic_be/src/modules/ai/appQuestionFeatures.js'].map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
function save(dir,name,value){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
async function snapshot(){
 const {Client}=require('pg'),{base}=require('./learningDevEnvironment');
 const c=new Client({...base,database:'toeic_learning_system',options:'-c default_transaction_read_only=on'});
 try{await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='15s'");
 const context=(await c.query(`SELECT current_database() AS database,now() AS captured_at,current_setting('transaction_read_only') AS read_only`)).rows[0];
 if(context.database!=='toeic_learning_system'||context.read_only!=='on')throw Error('Canonical READ ONLY database required');
 const attempts=(await c.query(`SELECT a.attempt_id,a.user_id,a.test_id,a.is_completed,
 a.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_time,a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,
 COALESCE(jsonb_agg(jsonb_build_object('question_id',aq.question_id,'question_snapshot',aq.question_snapshot,
 'user_answer',ua.user_answer,'first_answer_at',first_response.first_answer_at)) FILTER(WHERE aq.question_id IS NOT NULL),'[]') AS answers
 FROM user_test_attempts a LEFT JOIN attempt_questions aq USING(attempt_id)
 LEFT JOIN user_answers ua USING(attempt_id,question_id)
 LEFT JOIN LATERAL (SELECT CASE WHEN r.baseline_known AND r.previous_answer IS NULL THEN r.changed_at END AS first_answer_at
 FROM learning_answer_revisions r WHERE r.attempt_id=a.attempt_id AND r.question_id=aq.question_id AND r.user_id=a.user_id
 AND r.new_answer IS NOT NULL ORDER BY r.revision_id LIMIT 1) first_response ON true GROUP BY a.attempt_id ORDER BY a.attempt_id`)).rows;
 const tests=(await c.query(`SELECT test_id,test_name AS title,publication_status,is_active,deleted_at FROM tests ORDER BY test_id`)).rows;
 const inventory=(await c.query(`SELECT part_number AS part,count(*)::int AS questions,
 count(DISTINCT test_id)::int AS tests FROM questions GROUP BY part_number ORDER BY part_number`)).rows;
 const users=(await c.query(`SELECT user_id,role FROM "User" WHERE role='STUDENT'`)).rows;
 // A reviewed issued attempt is the canonical form template, not a handcrafted bank snapshot.
 return {context,attempts,tests,inventory,users};
 }finally{try{await c.query('ROLLBACK');}finally{await c.end();}}
}
function freezeDesign(d,s){
 assertDesign(d);
 for(const p of d.participants)if(!s.users.some(u=>u.user_id===p.user_id))throw Error('Participant must be an existing STUDENT');
 for(const f of d.forms){
  for(const role of ['history','target']){
   const id=f[role+'_test_id'],test=s.tests.find(t=>t.test_id===id);
   if(!test?.is_active||test.deleted_at||test.publication_status!=='published')throw Error('Forms must be published and active');
   const template=s.attempts.find(a=>a.attempt_id===f[role+'_template_attempt_id']&&a.test_id===id);
   if(!template?.answers.length)throw Error('Select a reviewed template attempt for each form (existing reviewer account; never create fake learner evidence)');
   const {answer}=require('./partStudyPolicy');
   const items=template.answers.map(q=>{const x=answer(q);if(x.part!==f.part)throw Error('Use single-Part forms');return {id:x.id,fingerprint:x.fingerprint};});
   if(new Set(items.map(i=>i.id)).size!==items.length)throw Error('Duplicate form items');
   f[role+'_items']=items;
  }
  if(f.target_items.some(x=>f.history_items.some(h=>x.id===h.id||x.fingerprint===h.fingerprint)))throw Error('History and independent forms overlap');
 }
 return d;
}
function verifyProtocol(p){
 const {protocol_sha256,...body}=p;
 if(!protocol_sha256||digest(body)!==protocol_sha256||p.version!==version||JSON.stringify(p.hashes)!==JSON.stringify(hashes()))throw Error('Protocol/code/artifact hash mismatch; never overwrite the original protocol');
 assertDesign(p.design);
}
function forecast(parts){
 const python=path.join(root,'toeic-ai/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const code="import sys,json;sys.path.insert(0,sys.argv[1]);from predictor import predict_probability;print(json.dumps([predict_probability(**p) for p in json.load(sys.stdin)]))";
 const ready=parts.filter(p=>p.input.part_answered_count>0);
 if(!ready.length)return [];
 return JSON.parse(execFileSync(python,['-B','-c',code,path.join(root,'toeic-ai/src')],{input:JSON.stringify(ready.map(p=>p.input)),encoding:'utf8',timeout:60000,maxBuffer:1024*1024}));
}
async function main(args=process.argv.slice(2)){
 const [command,...rest]=args,opts={};
 for(let i=0;i<rest.length;i+=2){if(!['--design','--protocol','--capture','--user'].includes(rest[i])||rest[i+1]==null||opts[rest[i]])throw Error('Invalid/duplicate arguments');opts[rest[i]]=rest[i+1];}
 if(command==='prepare'){
  const s=await snapshot(),dir=path.join(privateRoot,stamp());
  const design={version,participants:[],measurement_conditions:'',
   planning:{development_learners:10,confirmation_learners:20,part_attempts_per_learner:14,not_a_power_calculation:true},
   acceptance:{reviewed_by:null,maximum_part_mae:null,minimum_mae_improvement:null,minimum_ranking_loss_improvement:null,
    maximum_observed_interval_width:null,note:'Set with supervisor before confirmation collection; no automatic production approval.'},
   forms:Array.from({length:7},(_,i)=>({part:i+1,history_test_id:null,target_test_id:null,
    history_template_attempt_id:null,target_template_attempt_id:null,reviewed_by:null,reviewed_at:null,
    content_reviewed:false,comparable_measurement:false,comparability_rationale:''}))};
  save(dir,'design.template.json',design);save(dir,'readiness.json',{context:s.context,inventory:s.inventory,
   tests:s.tests.map(t=>({test_id:t.test_id,title:t.title,publication_status:t.publication_status})),
   completed_coverage:Array.from({length:7},(_,i)=>{const a=s.attempts.filter(a=>a.is_completed&&a.answers.some(q=>Number(q.question_snapshot?.part_number)===i+1));
    return {part:i+1,learners:new Set(a.map(a=>a.user_id)).size,attempts:a.length};}),
   code_artifact_hashes:hashes(),status:'preparation_only_no_protocol_frozen',database_writes:0,inference_calls:0});
  console.log(JSON.stringify({output:dir,status:'draft_requires_forms_participants_and_review'}));return;
 }
 if(command==='freeze'){
  if(!opts['--design'])throw Error('Provide --design');
  const s=await snapshot(),design=freezeDesign(read(opts['--design']),s);
  const p={version,frozen_at:new Date(s.context.captured_at).toISOString(),hashes:hashes(),design,
   policy:{production_ai_enabled:false,feature_version:'group_history_v1',baseline:'laplace_same_cutoff',target:'first_registered_B_presentation',
    ranking:'pairwise_loss_on_reviewed_independent_forms',blanks:'exclude_primary_report_completion_and_all_issued_sensitivity',
    scope:'app-supported Part profile; not a latent ability measurement or official TOEIC score'}};
  p.protocol_sha256=digest(p);const dir=path.join(privateRoot,stamp());save(dir,'protocol.json',p);
  console.log(JSON.stringify({output:dir,protocol_sha256:p.protocol_sha256}));return;
 }
 if(!['capture','evaluate','summarize'].includes(command)||!opts['--protocol'])throw Error('Use prepare | freeze --design FILE | capture --protocol FILE --user ID | evaluate --protocol FILE --capture FILE | summarize --protocol FILE');
 const p=read(opts['--protocol']);verifyProtocol(p);
 if(command==='capture'){
  const user=Number(opts['--user']);if(!p.design.participants.some(u=>u.user_id===user))throw Error('User not enrolled before protocol');
  const dir=path.join(privateRoot,p.protocol_sha256,String(user)),file=path.join(dir,'capture.json');
  if(fs.existsSync(file))throw Error('Capture already exists; never replace a forecast');
  const s=await snapshot(),h=history(s.attempts,user,s.context.captured_at);
  for(const f of p.design.forms){
   if(s.attempts.some(a=>a.user_id===user&&a.test_id===f.target_test_id)||f.target_items.some(x=>h.exposed_ids.includes(x.id)||h.exposed_fingerprints.includes(x.fingerprint)))throw Error('User already exposed to target form');
   const completedA=s.attempts.filter(a=>a.user_id===user&&a.is_completed&&a.test_id===f.history_test_id&&new Date(a.end_time)>new Date(p.frozen_at));
   if(!completedA.some(a=>a.answers.length===f.history_items.length&&a.answers.every(q=>f.history_items.some(x=>x.id===q.question_id&&x.fingerprint===fingerprint(q.question_snapshot)))))throw Error('Finish all seven unchanged registered A forms after protocol before capture');
  }
  const results=forecast(h.parts),expected=p.hashes['toeic-ai/models/v2/lightgbm_v2.joblib'];
  if(results.some(r=>r.model!=='lightgbm_v2'||r.artifact_sha256!==expected||!Number.isFinite(r.probability)||r.probability<0||r.probability>1))throw Error('Invalid inference response');
  for(const r of results){const x=h.parts.find(p=>p.part===r.part),i=x?.input;
   if(!i||r.features.part!==i.part||r.features.attempt_count!==i.answered_count||r.features.user_part_count!==i.part_answered_count||
     Math.abs(r.features.user_acc-(i.correct_count+1)/(i.answered_count+2))>1e-12||
     Math.abs(r.features.user_part_acc-x.baseline_probability)>1e-12||r.features.elapsed_time_missing!==1)throw Error('V2 feature contract changed');
  }
  verifyProtocol(p); // Detect artifact/code changes while inference was running.
  const frozen={version,protocol_sha256:p.protocol_sha256,user_id:user,as_of:new Date(s.context.captured_at).toISOString(),
   recorded_at:new Date().toISOString(),...h,parts:h.parts.map(x=>{const r=results.find(r=>r.part===x.part);
   return {...x,status:r?'ready':'no_history',probability:r?.probability??null,features:r?.features??null};}),
   provenance:{database:'toeic_learning_system',read_only:true,training_calls:0,model_calls:results.length},production_ai_enabled:false};
  frozen.research_combinations=candidatePairs(frozen.parts);
  frozen.capture_sha256=digest(frozen);save(dir,'capture.json',frozen);
  console.log(JSON.stringify({capture:file,model_calls:results.length,status:'research_only_do_not_show_to_learner'}));return;
 }
 if(command==='summarize'){
  const s=await snapshot(),results=[],missing=[];
  for(const u of p.design.participants){
   const file=path.join(privateRoot,p.protocol_sha256,String(u.user_id),'capture.json');
   if(!fs.existsSync(file)){missing.push(u.user_id);continue;}
   const frozen=read(file),{capture_sha256,...body}=frozen;
   if(digest(body)!==capture_sha256)throw Error('Capture checksum mismatch');
   results.push(evaluate(frozen,s.attempts,p));
  }
  const result=summarize(results,p.design),dir=path.join(privateRoot,p.protocol_sha256,'summaries',stamp());
  save(dir,'summary.json',{...result,context:s.context,protocol_sha256:p.protocol_sha256,missing_captures:missing});
  console.log(JSON.stringify({output:dir,decision:result.decision,production_ai_enabled:false}));return;
 }
 if(!opts['--capture'])throw Error('Provide --capture');
 const frozen=read(opts['--capture']),{capture_sha256,...body}=frozen;
 if(digest(body)!==capture_sha256)throw Error('Capture checksum mismatch');
 const s=await snapshot(),result=evaluate(frozen,s.attempts,p),dir=path.join(privateRoot,p.protocol_sha256,String(frozen.user_id),'evaluations',stamp());
 save(dir,'result.json',{...result,context:s.context,protocol_sha256:p.protocol_sha256,capture_sha256});
 console.log(JSON.stringify({output:dir,eligible_parts:result.units.length,excluded:result.excluded,production_ai_enabled:false}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,freezeDesign,verifyProtocol,hashes,digest};
