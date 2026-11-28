// Local real V2 inference on synthetic evidence only. Never calls collect/DB.
const fs=require('node:fs'),path=require('node:path');
const {demoOverview,estimateProfile}=require('../src/modules/ai/partProfileExperiment');
const {v2Hash}=require('../src/modules/ai/partAssessment');
const {infer}=require('./runAppPartResearch');
async function main(){
 const hash=v2Hash(),profiles=[];
 for(const id of ['new','single','seven']){
  const overview=demoOverview(id);
  const inputs=overview.parts.filter(p=>p.answered>0).map(p=>({part:p.part,answered_count:overview.totals.answered,correct_count:overview.totals.correct,part_answered_count:p.answered,part_correct_count:p.correct}));
  const outputs=infer(inputs);
  profiles.push(await estimateProfile(overview,{synthetic:true,artifactHash:hash,predict:async input=>outputs.find(r=>r.part===input.part)}));
 }
 if(v2Hash()!==hash)throw Error('V2 changed');
 if(profiles.some(p=>p.experiment.status==='model_unavailable_or_partial'))throw Error('Real V2 demo inference failed');
 const dir=path.resolve(__dirname,'../private/ai/part-profile-demo',new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'DEMO_ONLY.json'),JSON.stringify({synthetic:true,not_validation:true,artifact_sha256:hash,database_connections:0,database_writes:0,training_calls:0,profiles},null,2),{flag:'wx'});
 console.log(JSON.stringify({output:dir,profiles:profiles.length,synthetic:true,real_v2_inference:true,database_connections:0,database_writes:0,training_calls:0,validation_claim:false}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
