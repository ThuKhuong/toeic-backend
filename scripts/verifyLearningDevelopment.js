// Read-only service/source verification. Does not register learners or create attempts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const XLSX=require('xlsx');
const dev=require('./learningDevEnvironment');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
 const services=[];
 for(const [service,url] of [['node','http://127.0.0.1:3001/api'],['catalog','http://127.0.0.1:3001/api/tests'],
   ['python','http://127.0.0.1:8000/health'],['flutter','http://127.0.0.1:8081/']]) {
   const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
   const body=service==='flutter'?{flutter_bootstrap:(await r.text()).includes('flutter_bootstrap.js')}:await r.json();
   services.push({service,url,http_status:r.status,body});
 }
 const c=await dev.connect('toeic_learning_events_dev');let database;
 try {
   await c.query('BEGIN READ ONLY');
   database=(await c.query(`SELECT current_database() AS database,(SELECT COUNT(*)::integer FROM questions) AS questions,
     (SELECT COUNT(*)::integer FROM "User") AS users,(SELECT COUNT(*)::integer FROM learning_events) AS events,
     (SELECT COUNT(*)::integer FROM learning_kc_mapping_versions) AS mapping_versions,
     (SELECT COUNT(*)::integer FROM bkt_ready_observations) AS bkt_ready`)).rows[0];
   await c.query('ROLLBACK');
 }finally{await c.end();}
 const source=await dev.fingerprintSource();
 const baseline=JSON.parse(fs.readFileSync(path.join(dev.reportRoot,'source_database_before.json'),'utf8'));
 const sourceUnchanged=JSON.stringify(source)===JSON.stringify(baseline);
 const workspace=path.resolve(__dirname,'../..'),ai=path.join(workspace,'toeic-ai');
 const old=JSON.parse(fs.readFileSync(path.join(ai,'reports/mapping_review_v1/protected_files_before.json'),'utf8'));
 const names=Object.keys(old).filter(n=>n.endsWith('.joblib')||n.startsWith('toeic_be/uploads/')||
   ['toeic-ai/knowledge_components.csv','toeic-ai/question_skill_mapping_proposal.csv','toeic-ai/KNOWLEDGE_TAXONOMY.md','toeic-ai/TAXONOMY_COVERAGE_REPORT.md'].includes(n));
 const changed=names.filter(n=>digest(path.join(workspace,n))!==old[n]);
 const book=XLSX.read(fs.readFileSync(path.join(ai,'MAPPING_REVIEW_TEMPLATE.csv')),{type:'buffer',raw:true});
 const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:''});
 const pending=rows.filter(r=>r.review_status==='pending_review').length;
 const health=services.find(s=>s.service==='python').body;
 const manifest=JSON.parse(fs.readFileSync(path.join(ai,'models/v3_app_shadow/manifest.json'),'utf8'));
 const checks={services_http_200:services.every(s=>s.http_status===200),
   node_is_isolated_development:services[0].body.learning_events?.enabled===true&&services[0].body.learning_events?.environment==='isolated_development',
   source_database_unchanged:sourceUnchanged,protected_models_media_taxonomy_unchanged:changed.length===0,
   all_real_mappings_still_pending:rows.length===222&&pending===222,
   python_v2_hash_matches:health.artifact_sha256===digest(path.join(ai,'models/v2/lightgbm_v2.joblib')),
   python_v3_hash_matches:health.question_model?.artifact_sha256===manifest.artifact_sha256};
 const report={at:new Date().toISOString(),services,development_database:database,source_database_unchanged:sourceUnchanged,
   protected_files_checked:names.length,protected_files_changed:changed,mapping_review_rows:rows.length,pending_rows:pending,
   flutter_api_base_url:'http://127.0.0.1:3001/api',flutter_configuration_evidence:'actual flutter run --dart-define and successful web compiler',
   checks,all_passed:Object.values(checks).every(Boolean)};
 fs.writeFileSync(path.join(dev.reportRoot,'development_verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({all_passed:report.all_passed,checks,database,pending_rows:pending,at:report.at}));
 if(!report.all_passed)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
