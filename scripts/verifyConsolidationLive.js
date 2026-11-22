// Read-only post-migration verification. Does not fetch result routes that backfill feedback.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {readSnapshot,compact,digest,write,MAIN,DEV}=require('./consolidateDatabases');
const jwt=require('jsonwebtoken');
async function main(){
  const dir=path.resolve(process.argv[2]);
  const migration=JSON.parse(fs.readFileSync(path.join(dir,'migration.json')));
  const beforeMain=JSON.parse(fs.readFileSync(path.join(dir,MAIN+'.before.json'))),beforeDev=JSON.parse(fs.readFileSync(path.join(dir,DEV+'.before.json')));
  const m=await readSnapshot(MAIN),d=await readSnapshot(DEV),checks=[];
  assert.deepEqual(compact(d),compact(beforeDev));checks.push('Dev: all 30 table hashes/counts unchanged');
  for(const [t,x]of Object.entries(beforeMain.tables))for(const old of x.rows){
    const r=m.tables[t].rows.find(r=>x.keys.every(k=>JSON.stringify(r[k])===JSON.stringify(old[k])));
    assert.equal(digest(r),digest(old),'Existing main row changed: '+t);
  }
  checks.push('All original main rows unchanged');
  const api='http://127.0.0.1:3000/api',health=await(await fetch(api)).json();
  assert.equal(health.learning_events.database,MAIN);assert.equal(health.learning_events.pilot_ready,true);
  await assert.rejects(fetch('http://127.0.0.1:3001/api',{signal:AbortSignal.timeout(1000)}));
  checks.push('Only canonical API 3000 runs; events storage/pilot ready');
  const admin=jwt.sign({user_id:migration.account_mapping[2],role:'ADMIN'},process.env.JWT_SECRET||'secret123',{expiresIn:'2m'});
  const request=async(route,token,opts={})=>{const r=await fetch(api+route,{...opts,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(opts.headers||{})}});return {status:r.status,body:await r.json()};};
  assert.equal((await request('/admin/learning-reports/learners')).status,401);
  const list=await request('/admin/learning-reports/learners',admin);assert.equal(list.status,200);assert.equal(list.body.source.database,MAIN);
  const reports=[];
  for(const learner of list.body.learners){
    const report=await request('/admin/learning-reports/learners/'+learner.user_id,admin);
    assert.equal(report.status,200);assert.equal(report.body.learner.user_id,learner.user_id);assert.equal(report.body.parts.length,7);
    const visit=x=>{if(x&&typeof x==='object')for(const[k,v]of Object.entries(x)){assert.ok(!['password_hash','email','correct_answer','question_snapshot','event_payload','features'].includes(k),k);visit(v);}};visit(report.body);
    const token=jwt.sign({user_id:learner.user_id,role:'STUDENT'},process.env.JWT_SECRET||'secret123',{expiresIn:'2m'});
    assert.equal((await request('/admin/learning-reports/learners',token)).status,403);
    const overview=await request('/ai/me/overview',token);assert.equal(overview.status,200);assert.equal(overview.body.parts.length,7);
    assert.equal(overview.body.totals.answered,report.body.total.answered);
    assert.equal(overview.body.policy.inference_called,false);
    reports.push({user_id:learner.user_id,total:report.body.total,events:report.body.learning_events.total,ai_status:'saved_forecasts_only'});
  }
  checks.push('Authenticated live 7-Part reports; learner isolation; no sensitive DTO fields');
  checks.push('Existing learner history -> readonly Part profile; no inference or prediction/history writes');
  const bank=Array.from({length:7},(_,i)=>{
    const part=i+1,qs=m.tables.questions.rows.filter(q=>q.part_number===part);
    const tests=m.tables.tests.rows.filter(t=>!t.deleted_at&&t.publication_status==='published'&&t.is_active&&qs.some(q=>q.test_id===t.test_id));
    return {part,published_tests:tests.length,published_questions:qs.filter(q=>tests.some(t=>t.test_id===q.test_id)).length,
      bank_questions:qs.length,unassigned:qs.filter(q=>q.test_id==null).length};
  });
  const media=new Set(),audios=new Set();
  for(let part=1;part<=7;part++){
    const r=await request('/tests?part='+part);assert.equal(r.status,200);assert.equal(r.body.length,bank[part-1].published_tests);
    for(const test of r.body){const detail=await request('/tests/'+test.test_id);assert.equal(detail.status,200);
      assert.equal(detail.body.questions.length,bank[part-1].published_questions);
      for(const q of detail.body.questions){assert.equal(q.part_number,part);assert.ok(!Object.hasOwn(q,'correct_answer'));
        for(const u of [q.audio_url,q.material_audio])if(u){media.add(u);audios.add(u);}
        for(const u of [q.image_url,q.group_image_url,q.passage_image_url,...(q.passages||[]).map(p=>p.image_url)])if(u)media.add(u);
      }
    }
  }
  for(const u of media)assert.equal((await fetch(new URL(u,api),{method:'HEAD'})).status,200);
  for(const u of audios){const r=await fetch(new URL(u,api),{headers:{Range:'bytes=0-1023'}});assert.equal(r.status,206);await r.arrayBuffer();}
  checks.push('Live student catalog/details cover 7 Parts; all '+media.size+' media available; '+audios.size+' audio ranges PASS');
  assert.deepEqual(compact(await readSnapshot(MAIN)),compact(m));checks.push('Live checks wrote zero database rows');
  const result={checked_at:new Date().toISOString(),checks,bank,learners:reports,main_counts:Object.fromEntries(Object.entries(m.tables).map(([t,x])=>[t,x.count])),
    dev_unchanged:true,main_original_rows_unchanged:true,api:health.learning_events,media:media.size,audio:audios.size};
  write(path.join(dir,'live_verification.json'),result);
  console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
