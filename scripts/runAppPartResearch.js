// Research command only: SELECT/READ ONLY, local frozen V2 inference, private preview.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {history}=require('./partStudyPolicy');
const {buildResearchProfile,auditForms}=require('./appPartResearchPolicy');
const root=path.resolve(__dirname,'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const protectedFiles=['toeic-ai/models/v2/lightgbm_v2.joblib','toeic-ai/models/v3_app_shadow/model.joblib',
 'toeic-ai/src/predictor.py','toeic-ai/data/feature_config_v2.json','toeic_be/src/modules/ai/partAssessment.js',
 'toeic_be/src/modules/ai/learningOverview.js','toeic_be/src/modules/tests/attemptService.js','toeic_be/src/modules/tests/grading.js',
 'toeic_be/scripts/partStudyPolicy.js','toeic_be/scripts/partStudy.js'];
const hashes=()=>Object.fromEntries(protectedFiles.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
function write(dir,name,value){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
async function collect(){
 const {Client}=require('pg'),{base}=require('./learningDevEnvironment');
 const c=new Client({...base,database:'toeic_learning_system',options:'-c default_transaction_read_only=on'});
 try{await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='15s'");
  const context=(await c.query(`SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only,now() AS as_of`)).rows[0];
  if(context.database!=='toeic_learning_system'||context.read_only!=='on')throw Error('Canonical READ ONLY database required');
  const users=(await c.query(`SELECT user_id FROM "User" WHERE role='STUDENT' ORDER BY user_id`)).rows;
  const tests=(await c.query(`SELECT test_id,test_name AS title,is_active,deleted_at,publication_status FROM tests ORDER BY test_id`)).rows;
  const attempts=(await c.query(`SELECT a.attempt_id,a.user_id,a.test_id,a.is_completed,
   a.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_time,a.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_time,
   COALESCE(jsonb_agg(jsonb_build_object('question_id',aq.question_id,'question_snapshot',aq.question_snapshot,'user_answer',ua.user_answer,
   'first_answer_at',first_response.first_answer_at)) FILTER(WHERE aq.question_id IS NOT NULL),'[]') AS answers
   FROM user_test_attempts a LEFT JOIN attempt_questions aq USING(attempt_id) LEFT JOIN user_answers ua USING(attempt_id,question_id)
   LEFT JOIN LATERAL (SELECT CASE WHEN r.baseline_known AND r.previous_answer IS NULL THEN r.changed_at END AS first_answer_at
    FROM learning_answer_revisions r WHERE r.attempt_id=a.attempt_id AND r.question_id=aq.question_id AND r.user_id=a.user_id
    AND r.new_answer IS NOT NULL ORDER BY r.revision_id LIMIT 1) first_response ON true GROUP BY a.attempt_id ORDER BY a.attempt_id`)).rows;
  const questions=(await c.query(`SELECT q.*,rp.content AS passage_content,rp.image_url AS passage_image_url,
   lm.audio_url AS material_audio,lm.transcript AS material_transcript,g.image_url AS group_image_url,
   COALESCE((SELECT jsonb_agg(ac ORDER BY ac.choice_label) FROM answer_choices ac WHERE ac.question_id=q.question_id),'[]') AS choices,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('passage_id',p.passage_id,'content',p.content,'image_url',p.image_url,'position',gp.position)
    ORDER BY gp.position) FROM question_group_passages gp JOIN reading_passages p USING(passage_id) WHERE gp.group_id=q.group_id),'[]') AS passages
   FROM questions q LEFT JOIN question_groups g ON g.group_id=q.group_id
   LEFT JOIN reading_passages rp ON rp.passage_id=q.passage_id
   LEFT JOIN listening_materials lm ON lm.material_id=COALESCE(q.material_id,g.material_id) ORDER BY q.question_id`)).rows;
  return {context,users,tests,attempts,questions};
 }finally{try{await c.query('ROLLBACK');}finally{await c.end();}}
}
function asset(reference){
 if(!reference)return null;
 let pathname=String(reference).replace(/\\/g,'/');
 try{if(/^https?:/i.test(pathname)){const url=new URL(pathname);if(!['localhost','127.0.0.1','10.0.2.2'].includes(url.hostname))return {status:'unverified_remote_reference'};pathname=url.pathname;}pathname=decodeURIComponent(pathname.split('?')[0]);}catch{return {status:'invalid_reference'};}
 pathname=pathname.replace(/^\/+/, '');
 if(!pathname.startsWith('uploads/'))return {status:'unverified_non_upload_reference'};
 const allowed=path.join(root,'toeic_be/uploads'),file=path.resolve(root,'toeic_be',pathname),relative=path.relative(allowed,file);
 if(relative.startsWith('..')||path.isAbsolute(relative))return {status:'refused_outside_uploads'};
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return {status:'missing_local_file'};
 const b=fs.readFileSync(file);return {status:'local_file_present',bytes:b.length,sha256:sha(b)};
}
function infer(inputs){
 if(!inputs.length)return [];
 const python=path.join(root,'toeic-ai/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const code="import sys,json;sys.path.insert(0,sys.argv[1]);from predictor import predict_probability;print(json.dumps([predict_probability(**p) for p in json.load(sys.stdin)]))";
 return JSON.parse(execFileSync(python,['-B','-c',code,path.join(root,'toeic-ai/src')],
  {input:JSON.stringify(inputs),encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024}));
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function preview(profiles,asOf){
 return '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Hồ sơ Part nghiên cứu</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px}table{border-collapse:collapse;width:100%;margin-bottom:28px}th,td{border:1px solid #ccc;padding:8px;text-align:left}aside{background:#fff4d2;padding:16px}small{color:#555}</style>'+
  '<h1>Hồ sơ bảy Part ở chế độ nghiên cứu</h1><aside>Chưa dùng cho người học. Thứ tự AI là tín hiệu thử nghiệm, không phải nhãn mạnh/yếu hoặc điểm năng lực. Gợi ý AI trên ứng dụng vẫn tắt.</aside><p>Mốc dữ liệu: '+esc(asOf)+'</p>'+
  profiles.map((p,i)=>'<h2>Hồ sơ L'+String(i+1).padStart(2,'0')+'</h2><p>Part có thể so trong nghiên cứu: '+p.research.eligible_parts+'/7. Thứ tự tín hiệu V2 thấp → cao: '+
   esc(p.research.ai_order_low_to_high.map((x,i,all)=>(i?(all[i-1].value===x.value?' = ':' → '):'')+'Part '+x.part).join('')||'Chưa đủ hai Part')+'</p><table><thead><tr><th>Part</th><th>Đã trả lời / riêng biệt / lặp</th><th>Tỷ lệ đúng lần đầu</th><th>Xác suất V2 thử nghiệm</th><th>Baseline Laplace</th><th>Trạng thái</th><th>Ngày từ bài gần nhất</th></tr></thead><tbody>'+
   p.parts.map(r=>'<tr><td>'+r.part+'</td><td>'+r.input.part_answered_count+' / '+r.distinct+' / '+r.repeat_answers+'</td><td>'+esc(r.first_correct_rate==null?'—':(100*r.first_correct_rate).toFixed(1)+'%')+'</td><td>'+esc(r.probability==null?'—':r.probability.toFixed(4))+'</td><td>'+esc(r.input.part_answered_count?r.baseline_probability.toFixed(4):'—')+'</td><td>'+esc(r.status)+'</td><td>'+esc(r.age_days?.toFixed(1)??'—')+'</td></tr>').join('')+
   '</tbody></table><small>Chỉ quan sát trong lịch sử app; không đo được việc gặp câu ngoài ứng dụng. Không dùng report hồi cứu để đánh giá dự đoán đã có trước đáp án.</small>').join('')+'</html>';
}
async function main(){
 if(process.argv.length>2)throw Error('No arguments accepted; fixed canonical READ ONLY research audit');
 const id=stamp(),privateDir=path.join(root,'toeic_be/private/ai/app-part-research',id),out=path.join(root,'toeic-ai/reports/app_part_research',id);
 const before=hashes();write(privateDir,'backup_manifest.json',before);
 for(const f of protectedFiles)write(path.join(privateDir,'backup'),f.replace(/[\/]/g,'__'),fs.readFileSync(path.join(root,f)));
 const s=await collect(),cache=new Map();
 for(const q of s.questions){
  const refs=[q.material_audio||q.audio_url,q.image_url||q.group_image_url,q.passage_image_url,...(q.passages||[]).map(p=>p.image_url)].filter(Boolean);
  q.asset_checks=refs.map(ref=>{if(!cache.has(ref))cache.set(ref,asset(ref));return cache.get(ref);});
  const audio=q.material_audio||q.audio_url;if(audio)q.audio_content_hash=cache.get(audio)?.sha256;
  const stimulus=q.image_url||q.group_image_url;if(stimulus)q.stimulus_image_content_hash=cache.get(stimulus)?.sha256;
  if(q.passage_image_url)q.passage_image_content_hash=cache.get(q.passage_image_url)?.sha256;
  for(const passage of q.passages||[])if(passage.image_url)passage.image_content_hash=cache.get(passage.image_url)?.sha256;
 }
 const bank=auditForms(s.tests,s.questions),config=JSON.parse(fs.readFileSync(path.join(root,'toeic-ai/data/feature_config_v2.json'),'utf8'));
 const profiles=[],errors=[],inferenceStatus=[];
 for(const {user_id} of s.users){
  try{const h=history(s.attempts,user_id,s.context.as_of),inputs=h.parts.filter(p=>p.input.part_answered_count>0).map(p=>p.input);
   let predictions=[];
   try{predictions=infer(inputs);inferenceStatus.push({user_id,calls:inputs.length,status:'ok'});}catch{inferenceStatus.push({user_id,calls:inputs.length,status:'unavailable'});}
   profiles.push(buildResearchProfile({attempts:s.attempts,userId:user_id,asOf:s.context.as_of,predictions,
    artifactHash:before['toeic-ai/models/v2/lightgbm_v2.joblib'],elapsedMedianSeconds:config.elapsed_median_ms/1000}));
  }catch(e){errors.push({user_id,code:'profile_evidence_or_contract_invalid',message:e.message});}
 }
 const after=hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Protected model/runtime changed during audit');
 write(privateDir,'snapshot.json',s);write(privateDir,'profiles.json',profiles);write(privateDir,'bank.json',bank);
 write(privateDir,'preview.html',preview(profiles,new Date(s.context.as_of).toISOString()));
 write(privateDir,'errors.json',errors);
 const publicBank=bank.forms.map(({test_id,title,part,questions,published,technical_issues,assets})=>({test_id,title,part,questions,published,technical_issues,
  assets:{checked:assets.length,missing_local:assets.filter(a=>a.status==='missing_local_file').length,unverified:assets.filter(a=>!['local_file_present','missing_local_file'].includes(a.status)).length}}));
 const aggregate={version:'app_part_research_v1',context:s.context,student_accounts:s.users.length,profiles_built:profiles.length,failed_profiles:errors.length,
  profiles_with_two_research_parts:profiles.filter(p=>p.research.eligible_parts>=2).length,complete_seven_part_profiles:profiles.filter(p=>p.research.complete_seven_parts).length,
  by_part:Array.from({length:7},(_,i)=>({part:i+1,with_history:profiles.filter(p=>p.parts[i].input.part_answered_count>0).length,
   research_comparison_floor_met:profiles.filter(p=>p.parts[i].rank_eligible).length})),
  bank:{forms:publicBank,by_part:bank.by_part,approved_parts:0},
  model_inference_calls:inferenceStatus.reduce((n,r)=>n+r.calls,0),inference_failures:inferenceStatus.filter(r=>r.status!=='ok').length,
  production_ai_enabled:false,ability_labels_enabled:false,recommendation_enabled:false,database_writes:0,training_calls:0,
  interpretation:'Diagnostic on current app history, not prospective validation; no app-quality metric or strong/weak label inferred from this run.'};
 write(out,'report.json',aggregate);write(out,'manifest.json',{before,after,preservation_verified:true,
  code_sha256:sha(fs.readFileSync(__filename)),policy_sha256:sha(fs.readFileSync(path.join(__dirname,'appPartResearchPolicy.js'))),
  private_outputs:path.relative(root,privateDir),read_only:true,database_writes:0,training_calls:0});
 const lines=['# Bộ đánh giá Part nghiên cứu trên dữ liệu app','',
  'V2 giữ nguyên. Không ghi database, không chấm lại bài hoặc bật nhãn mạnh/yếu. Đây là kiểm tra tích hợp hồi cứu, không phải kiểm định hiệu quả AI.',
  '',`Mốc dữ liệu: ${new Date(s.context.as_of).toISOString()}. Có ${s.users.length} tài khoản STUDENT; dựng ${profiles.length} hồ sơ, ${errors.length} hồ sơ lỗi.`,
  `Hồ sơ có ít nhất hai Part qua ngưỡng so sánh nghiên cứu: ${aggregate.profiles_with_two_research_parts}; đủ bảy Part: ${aggregate.complete_seven_part_profiles}.`,
  '', '| Part | Người có lịch sử | Người qua ngưỡng nghiên cứu | Đề công khai | Cặp qua kiểm tra kỹ thuật | Trạng thái |','|---|---:|---:|---:|---:|---|'];
 for(const r of aggregate.by_part){const b=bank.by_part[r.part-1];lines.push(`| ${r.part} | ${r.with_history} | ${r.research_comparison_floor_met} | ${b.published_forms} | ${b.technical_candidates} | ${b.status} |`);}
 lines.push('','Ngưỡng 10 câu riêng biệt là floor nghiên cứu đối chiếu với Riiid, không phải điều kiện đủ để xác nhận năng lực. Cặp đề qua kỹ thuật vẫn cần review nội dung và tính tương đương.',
  '',`Bản xem trước và hồ sơ riêng: ${path.relative(root,privateDir)}. Không đưa snapshot hoặc file private lên frontend/Git.`,
  '', 'Chưa có đánh giá độc lập mới để tính sai số/hiệu quả AI trên app. Không lấy đáp án đã làm để tự chấm tín hiệu vừa suy luận.');
 write(out,'SUMMARY.md',lines.join('\n')+'\n');
 console.log(JSON.stringify({output:out,private_preview:path.join(privateDir,'preview.html'),profiles:profiles.length,errors:errors.length,
  complete_seven_parts:aggregate.complete_seven_part_profiles,database_writes:0,production_ai_enabled:false}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={collect,asset,infer,preview};
