// Explicit research CLI. Database access comes only from READ ONLY collect().
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const policy=require('./partStudyV2Policy');
const old=require('./partStudyPolicy');
const {collect,asset,infer}=require('./runAppPartResearch');
const {fingerprint}=require('../src/modules/ai/appQuestionFeatures');
const root=path.resolve(__dirname,'../..'),store=path.join(root,'toeic_be/private/ai/part-study-v2');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const files=['toeic-ai/models/v2/lightgbm_v2.joblib','toeic-ai/models/v3_app_shadow/model.joblib','toeic-ai/data/feature_config_v2.json',
 'toeic-ai/src/predictor.py','toeic_be/scripts/partStudyV2.js','toeic_be/scripts/partStudyV2Policy.js','toeic_be/scripts/partStudyPolicy.js',
 'toeic_be/scripts/runAppPartResearch.js','toeic_be/scripts/appPartResearchPolicy.js','toeic_be/scripts/lightgbmValidationMetrics.js','toeic_be/src/modules/ai/appQuestionFeatures.js'];
const hashes=()=>Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
function save(dir,name,v){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
function verify(p){const {protocol_sha256,...body}=p;if(p.version!==policy.version||!protocol_sha256||digest(body)!==protocol_sha256||JSON.stringify(p.hashes)!==JSON.stringify(hashes()))throw Error('Protocol/code/artifact checksum mismatch');policy.assertDesign(p.design);}
function mediaState(s,ids){
 const media=new Map();
 for(const q of s.questions.filter(q=>ids.includes(q.test_id))){
  const refs=[q.material_audio||q.audio_url,q.image_url||q.group_image_url,q.passage_image_url,...(q.passages||[]).map(x=>x.image_url)].filter(Boolean);
  for(const ref of refs){if(!media.has(ref))media.set(ref,asset(ref));if(media.get(ref)?.status!=='local_file_present')throw Error('Cannot verify registered media bytes');}
  q.audio_content_hash=refs.length?media.get(q.material_audio||q.audio_url)?.sha256:undefined;
  q.stimulus_image_content_hash=media.get(q.image_url||q.group_image_url)?.sha256;
  q.passage_image_content_hash=media.get(q.passage_image_url)?.sha256;
  for(const p of q.passages||[])p.image_content_hash=media.get(p.image_url)?.sha256;
 }
 return [...media].sort(([a],[b])=>a.localeCompare(b));
}
function checkBank(p,s){
 const ids=p.design.forms.flatMap(f=>[...f.history_test_ids,f.target_test_id]);
 if(digest(mediaState(s,ids))!==digest(p.media))throw Error('Registered media changed');
 for(const f of p.design.forms)for(const form of [...f.history_forms,{test_id:f.target_test_id,items:f.target_items}]){
  const t=s.tests.find(t=>t.test_id===form.test_id),qs=s.questions.filter(q=>q.test_id===form.test_id);
  if(!t?.is_active||t.deleted_at||t.publication_status!=='published'||qs.length!==form.items.length||qs.some(q=>!form.items.some(i=>i.id===q.question_id&&i.fingerprint===fingerprint(q))))throw Error('Registered form changed or unpublished');
 }
}
async function main(args=process.argv.slice(2)){
 const [command,...rest]=args,opts={};
 if(rest.length%2)throw Error('Missing option value');
 for(let i=0;i<rest.length;i+=2){if(!['--design','--protocol','--capture','--user'].includes(rest[i])||opts[rest[i]])throw Error('Invalid/duplicate argument');opts[rest[i]]=rest[i+1];}
 if(command==='prepare'){
  const s=await collect(),dir=path.join(store,stamp());
  const pairs=[[18,33,47],[28,48],[29,37],[27,38],[19,39,46],[30,45],[31,32]];
  const design={version:policy.version,purpose:'workflow_pilot',participants:[2,5,6].filter(id=>s.users.some(u=>u.user_id===id)).map(user_id=>({user_id})),
   history_floor_distinct:10,measurement_conditions:'',maximum_target_hours:null,reviewed_by:null,
   acceptance:{reviewed_by:null,maximum_part_mae:null,minimum_mae_improvement:null,minimum_ranking_loss_improvement:null,maximum_observed_interval_width:null},
   forms:pairs.map((ids,i)=>({part:i+1,history_test_ids:ids.slice(0,-1),target_test_id:ids.at(-1),history_mode:'existing_or_new',
    content_reviewed:false,comparable_measurement:false,reviewed_by:null,reviewed_at:null,comparability_rationale:''}))};
  const publicFacts=s.tests.map(t=>({...t,question_count:s.questions.filter(q=>q.test_id===t.test_id).length}));
  save(dir,'design.draft.json',design);save(dir,'inventory.json',{context:s.context,tests:publicFacts,status:'draft_only_no_enrollment_or_protocol_frozen',database_writes:0});
  console.log(JSON.stringify({output:dir,status:'draft_requires_real_content_review_and_measurement_conditions',database_writes:0}));return;
 }
 if(command==='freeze'){
  if(!opts['--design'])throw Error('Provide --design');
  const before=hashes(),s=await collect(),draft=read(opts['--design']);policy.assertDesign(draft);
  const ids=draft.forms.flatMap(f=>[...f.history_test_ids,f.target_test_id]),media=mediaState(s,ids);
  const design=policy.freezeDesign(draft,s),after=hashes();if(digest(before)!==digest(after))throw Error('Protected files changed');
  const p={version:policy.version,frozen_at:new Date(s.context.as_of).toISOString(),hashes:before,design,media,
   registration_source:'reviewed_bank_content_and_local_media_not_fake_attempt',production_ai_enabled:false};
  p.protocol_sha256=digest(p);const dir=path.join(store,stamp());save(dir,'protocol.json',p);
  console.log(JSON.stringify({output:dir,status:'registered_research_only',production_ai_enabled:false}));return;
 }
 if(!['readiness','capture','evaluate','summarize'].includes(command)||!opts['--protocol'])throw Error('Use prepare | freeze --design FILE | readiness/capture --protocol FILE --user ID | evaluate --protocol FILE --capture FILE | summarize --protocol FILE');
 const p=read(opts['--protocol']);verify(p);const s=await collect();checkBank(p,s);
 if(['readiness','capture'].includes(command)){
  const user=Number(opts['--user']),r=policy.readiness(p,s,user);
  if(command==='readiness'){console.log(JSON.stringify({user_id:user,ready:r.ready,blockers:r.blockers,production_ai_enabled:false}));return;}
  if(!r.ready)throw Error('Capture blocked: '+JSON.stringify(r.blockers));
  const dir=path.join(store,p.protocol_sha256,String(user));if(fs.existsSync(path.join(dir,'capture.json')))throw Error('Capture already exists; never overwrite');
  const rs=infer(r.history.parts.map(p=>p.input)),config=read(path.join(root,'toeic-ai/data/feature_config_v2.json'));
  policy.validatePredictions(r.history,rs,p.hashes['toeic-ai/models/v2/lightgbm_v2.joblib'],config.elapsed_median_ms/1000);
  // B may be opened during inference: recheck before writing a capture.
  const after=await collect();checkBank(p,after);if(!policy.readiness(p,after,user).ready)throw Error('History/readiness changed during inference');
  if(digest(old.history(after.attempts,user,after.context.as_of))!==digest(r.history))throw Error('Learner history changed during inference; retry before B');
  verify(p);
  const frozen={version:policy.version,protocol_sha256:p.protocol_sha256,user_id:user,as_of:new Date(s.context.as_of).toISOString(),recorded_at:new Date().toISOString(),...r.history,
   parts:r.history.parts.map(x=>({...x,status:'ready',probability:rs.find(r=>r.part===x.part).probability,features:rs.find(r=>r.part===x.part).features})),
   production_ai_enabled:false,database_writes:0,training_calls:0};
  frozen.capture_sha256=digest(frozen);save(dir,'capture.json',frozen);
  console.log(JSON.stringify({capture:path.join(dir,'capture.json'),status:'capture_complete_B_may_start_under_registered_conditions',production_ai_enabled:false}));return;
 }
 function score(file){const frozen=read(file),{capture_sha256,...body}=frozen;if(!capture_sha256||digest(body)!==capture_sha256)throw Error('Capture checksum mismatch');
  const config=read(path.join(root,'toeic-ai/data/feature_config_v2.json'));
  policy.validatePredictions(frozen,frozen.parts.map(x=>({part:x.part,model:'lightgbm_v2',artifact_sha256:p.hashes['toeic-ai/models/v2/lightgbm_v2.joblib'],probability:x.probability,features:x.features})),p.hashes['toeic-ai/models/v2/lightgbm_v2.joblib'],config.elapsed_median_ms/1000);
  return policy.evaluate(frozen,s.attempts,p);
 }
 const dir=path.join(store,p.protocol_sha256,'evaluations',stamp());
 if(command==='evaluate'){if(!opts['--capture'])throw Error('Provide --capture');const result=score(opts['--capture']);save(dir,'result.json',result);console.log(JSON.stringify({output:dir,eligible_parts:result.units.length,excluded:result.excluded,production_ai_enabled:false}));return;}
 const results=[],missing=[];for(const u of p.design.participants){const f=path.join(store,p.protocol_sha256,String(u.user_id),'capture.json');if(fs.existsSync(f))results.push(score(f));else missing.push(u.user_id);}
 const cohort=p.design.purpose==='workflow_pilot'?'development':'confirmation';
 const summary=old.summarize(results,{...p.design,planning:{development_learners:cohort==='development'?p.design.participants.length:0,confirmation_learners:cohort==='confirmation'?p.design.participants.length:Number.MAX_SAFE_INTEGER}});
 save(dir,'summary.json',{...summary,version:policy.version,purpose:p.design.purpose,missing_captures:missing,workflow_pilot_cannot_approve_production:true});
 console.log(JSON.stringify({output:dir,production_ai_enabled:false,status:'manual_review_required'}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,verify,checkBank,mediaState,hashes,digest};
