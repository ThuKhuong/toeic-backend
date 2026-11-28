// Stateless live V2 competency estimation view. No database writes, accounts, training or saved forecasts.
const fs=require('node:fs'),path=require('node:path');
const {v2Hash,evaluateAiCompetency}=require('./partAssessment');
const {buildLearningOverview}=require('./learningOverview');
const validCounts=p=>['answered','correct'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0)&&p.correct<=p.answered;
function createV2Client({fetchImpl=fetch,baseUrl=process.env.AI_SERVICE_URL||'http://127.0.0.1:8000',timeoutMs=4000}={}){
 return async input=>{
  const response=await fetchImpl(baseUrl.replace(/\/$/,'')+'/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Error('Model unavailable');
  return response.json();
 };
}
async function estimateProfile(overview,{predict=createV2Client(),artifactHash=v2Hash(),medianSeconds,
 synthetic=false,asOf=overview.source?.as_of}={}){
 if(!Number.isFinite(Date.parse(asOf))||overview.parts?.length!==7||new Set(overview.parts.map(p=>p.part)).size!==7||overview.parts.some(p=>!Number.isInteger(p.part)||p.part<1||p.part>7||!validCounts(p)))throw Error('Valid seven-Part history/cutoff required');
 if(medianSeconds===undefined){try{medianSeconds=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../toeic-ai/data/feature_config_v2.json'),'utf8')).elapsed_median_ms/1000;}catch{medianSeconds=null;}}
 const answered=overview.parts.reduce((n,p)=>n+p.answered,0),correct=overview.parts.reduce((n,p)=>n+p.correct,0);
 const parts=await Promise.all(overview.parts.map(async p=>{
  const ai={model:'lightgbm_v2',status:'no_data',probability:null,baseline_probability:p.answered?(p.correct+1)/(p.answered+2):null,
   as_of:asOf,validation_status:'validated_on_riiid_and_app_pilot',ability_label_enabled:false,rank_eligible:false,
   ability_level:null,ability_label:null,relative_rank:null};
  if(!p.answered)return {...p,ai};
  const input={part:p.part,answered_count:answered,correct_count:correct,part_answered_count:p.answered,part_correct_count:p.correct};
  try{
   if(!/^[a-f0-9]{64}$/.test(artifactHash||'')||!Number.isFinite(medianSeconds))throw Error('Unavailable contract');
   const r=await predict(input),expected={part:p.part,user_acc:(correct+1)/(answered+2),user_part_acc:ai.baseline_probability,
    attempt_count:answered,user_part_count:p.answered,prior_elapsed_seconds:medianSeconds,elapsed_time_missing:1};
   if(r.model!=='lightgbm_v2'||r.part!==p.part||r.artifact_sha256!==artifactHash||typeof r.probability!=='number'||!Number.isFinite(r.probability)||r.probability<0||r.probability>1||
     Object.entries(expected).some(([k,v])=>typeof r.features?.[k]!=='number'||!Number.isFinite(r.features[k])||Math.abs(r.features[k]-v)>1e-12))throw Error('Invalid V2 response');
   // Content fingerprints, rather than question IDs, establish distinctness.
   const eligible=(p.content_distinct_answered??0)>=10;
   Object.assign(ai,{probability:r.probability,status:'ready',rank_eligible:eligible,
    message:eligible?`AI LightGBM V2 dự báo xác suất trả lời đúng lượt tiếp theo: ${(r.probability * 100).toFixed(1)}%.`:'Đã suy luận nhưng chưa đủ 10 câu riêng biệt để xếp hạng Part.'});
  }catch{Object.assign(ai,{status:'unavailable',message:'AI chưa sẵn sàng; thống kê lịch sử vẫn sử dụng được.'});}
  return {...p,ai};
 }));
 const evaluation=evaluateAiCompetency(overview,parts);
 const compare=evaluation.compare,lowest=evaluation.lowestParts;
 const aiPriority=evaluation.hasRelativeSpread&&lowest.length===1?[{part:lowest[0].part,title:synthetic?`Minh họa ưu tiên Part ${lowest[0].part}`:`AI gợi ý ưu tiên Part ${lowest[0].part}`,
  reason:synthetic?'Theo tín hiệu V2 thấp nhất trong các Part đủ dữ liệu demo.':`AI LightGBM V2 dự báo xác suất đúng lượt tiếp theo thấp nhất (${(lowest[0].probability * 100).toFixed(1)}%) trong các Part đã đủ dữ liệu.`,
  method:'lightgbm_v2_priority',probability:lowest[0].probability,synthetic}]:[];
 return {...overview,parts,recommendations:evaluation.recommendations,summary:evaluation.summary,
  ai_ranking:{order_low_to_high:compare,weakest_part:evaluation.hasRelativeSpread&&lowest.length===1?lowest[0].part:null,
   strongest_part:evaluation.hasRelativeSpread&&evaluation.highestParts.length===1?evaluation.highestParts[0].part:null},
  source:{mode:synthetic?'synthetic_demo':'live_readonly',as_of:asOf},
  experiment:{version:'part_profile_experiment_v1',synthetic,model:'lightgbm_v2',artifact_sha256:artifactHash,
   as_of:asOf,order_low_to_high:compare,ranking_is_experimental:false,ranking_floor_distinct:10,
   ranking_floor_is_display_policy:true,demo_recommendations:aiPriority,inference_requests:parts.filter(p=>p.answered>0).length,
   status:parts.some(p=>p.ai.status==='unavailable')?'model_unavailable_or_partial':answered?'ready':'no_data',
   learner_ai_recommendations_enabled:evaluation.hasRelativeSpread,strength_weakness_enabled:evaluation.hasRelativeSpread,not_prospective_validation:true,database_writes:0,training_calls:0,
   notice:synthetic?'DỮ LIỆU GIẢ LẬP — không phải bài làm thật hoặc bằng chứng kiểm định AI.':'Đánh giá năng lực tương đối theo 7 Part và gợi ý ưu tiên ôn tập bằng mô hình LightGBM V2 tại cùng mốc lịch sử.',
   limitations:['Mô hình LightGBM V2 ước lượng xác suất trả lời đúng lượt tiếp theo theo Part dựa trên lịch sử câu trả lời.','Chỉ xếp hạng mạnh/yếu và gợi ý AI cho các Part đã đạt tối thiểu 10 câu trả lời lần đầu.']},
  policy:{...overview.policy,method:'lightgbm_v2_with_evidence_gate',strength_weakness_enabled:evaluation.hasRelativeSpread,inference_called:answered>0,
   recommendation_method:evaluation.aiDrivenRecommendations?'lightgbm_v2_priority':'descriptive_rules',ai_validation_status:'validated_on_riiid_and_app_pilot'}};
}
function demoOverview(id){
 if(!['new','single','seven'].includes(id))throw Object.assign(Error('Hồ sơ demo không hợp lệ.'),{status:400});
 const rows=[];
 const add=(part,attempt,n,correct,start=0)=>{for(let i=0;i<n;i++)rows.push({attempt_id:attempt,end_time:`2026-11-0${attempt}T10:00:00Z`,position:i+1,question_id:part*1000+start+i,
  user_answer:i<correct?'A':'B',question_snapshot:{part_number:part,question_text:`SYNTHETIC Part ${part} item ${start+i}`,correct_answer:'A',choices:(part===2?['A','B','C']:['A','B','C','D']).map(choice_label=>({choice_label,choice_text:choice_label}))}});};
 if(id==='single')add(5,1,18,9);
 if(id==='seven')for(let p=1;p<=7;p++){add(p,1,20,[16,12,8,9,14,11,10][p-1]);add(p,2,20,[18,14,11,13,16,13,12][p-1],20);add(p,3,10,10);}
 const o=buildLearningOverview(rows);
 return {...o,source:{mode:'synthetic_demo',as_of:'2026-11-04T10:00:00Z'},demo:{id,synthetic:true,label:{new:'Demo 01 — Chưa có dữ liệu',single:'Demo 02 — Một Part',seven:'Demo 03 — Bảy Part, nhiều lượt'}[id]},
  limitation:'Dữ liệu giả lập chỉ kiểm thử chức năng; không dùng để báo cáo độ chính xác AI.'};
}
module.exports={createV2Client,estimateProfile,demoOverview};
