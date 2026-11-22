// Live GET-only smoke. No credentials, keys, raw answers or tokens in output.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg'),{base}=require('./learningDevEnvironment');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const {readSnapshot,compact}=require('./consolidateDatabases');
async function main(){
  const before=await readSnapshot('toeic_learning_system');
  const c=new Client({...base,database:'toeic_learning_system',options:'-c default_transaction_read_only=on'});
  await c.connect();const checks=[];
  try{
    const users=(await c.query('SELECT user_id,role FROM "User" WHERE user_id=ANY($1::int[]) ORDER BY user_id',[[1,2,5,6]])).rows;
    const jwt=require('jsonwebtoken');
    const token=u=>jwt.sign({user_id:u.user_id,role:u.role},process.env.JWT_SECRET||'secret123',{expiresIn:120});
    async function get(url,u){const r=await fetch('http://127.0.0.1:3000/api'+url,{headers:u?{Authorization:'Bearer '+token(u)}:{},signal:AbortSignal.timeout(10000)});
      assert.equal(r.status,200,url);return r.json();}
    const admin=users.find(u=>u.role==='ADMIN');assert.ok(admin);
    const ai=(await(await fetch('http://127.0.0.1:8000/health')).json());assert.equal(ai.model,'lightgbm_v2');
    for(const u of users.filter(u=>u.role==='STUDENT')){
      const p=await get('/ai/me/part-assessment?user_id=999999',u);
      assert.equal(p.profile_version,'part_assessment_v1');assert.equal(p.parts.length,7);
      assert.equal(p.policy.inference_called,false);assert.equal(p.policy.strength_weakness_enabled,false);
      assert.equal(p.skills,undefined);assert.equal(JSON.stringify(p).includes('correct_answer'),false);
      const a=await get('/admin/learning-reports/learners/'+u.user_id,admin);
      assert.equal(a.total.answered,p.totals.answered);assert.equal(a.total.correct,p.totals.correct);
      for(let i=0;i<7;i++){assert.equal(a.parts[i].answered,p.parts[i].answered);assert.deepEqual(a.parts[i].history_points,p.parts[i].history_points);}
      const latest=(await c.query('SELECT attempt_id FROM user_test_attempts WHERE user_id=$1 AND is_completed ORDER BY end_time DESC,attempt_id DESC LIMIT 1',[u.user_id])).rows[0];
      if(latest){const result=await get('/tests/attempts/'+latest.attempt_id+'/results',u);assert.equal(result.question_prediction,undefined);assert.equal(result.attempt.question_predictions,undefined);assert.equal(result.ai_prediction?.token,undefined);}
      checks.push({user_id:u.user_id,answered:p.totals.answered,parts:p.parts.map(x=>({part:x.part,answered:x.answered,ai:x.ai.status,trend:x.trend.status}))});
    }
    for(const [method,p]of [['POST','/ai/admin/train'],['GET','/ai/admin/status'],['POST','/ai/me'],['GET','/ai/me'],['POST','/ai/me/predict']]){
      const r=await fetch('http://127.0.0.1:3000/api'+p,{method,headers:{Authorization:'Bearer '+token(admin)}});assert.equal(r.status,404,p);
    }
    const after=await readSnapshot('toeic_learning_system');const unchanged=JSON.stringify(compact(before))===JSON.stringify(compact(after));assert.ok(unchanged,'Live table state changed during smoke; inspect concurrent activity');
    const out=path.resolve(__dirname,'../private/ai/cleanup',new Date().toISOString().replace(/[:.]/g,'-'));
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'live_profile.json'),JSON.stringify({checks,retired_routes:5,read_only:true,no_inference:true,table_hashes_unchanged:unchanged,primary_model:ai.model},null,2));
    console.log(JSON.stringify({report:path.join(out,'live_profile.json'),learners:checks.length,retired_routes:5,table_hashes_unchanged:unchanged}));
  }finally{await c.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
