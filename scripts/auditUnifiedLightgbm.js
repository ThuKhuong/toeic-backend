// Canonical read-only validation; preserves historical source scope and all old reports.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Client } = require('pg');
const { base } = require('./learningDevEnvironment');
const { collect, parseArgs, summaryMarkdown } = require('./auditLightgbmApp');
const root=path.resolve(__dirname,'../..');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const VERSION='unified_lightgbm_prospective_v1';
async function main(){
  const options=parseArgs(process.argv.slice(2));
  const hashes={v2:sha(fs.readFileSync(path.join(root,'toeic-ai/models/v2/lightgbm_v2.joblib'))),
    v3:sha(fs.readFileSync(path.join(root,'toeic-ai/models/v3_app_shadow/model.joblib')))};
  const code=Object.fromEntries(['auditUnifiedLightgbm.js','auditLightgbmApp.js','lightgbmValidationMetrics.js',
    '../src/modules/ai/appQuestionFeatures.js'].map(f=>[f,sha(fs.readFileSync(path.join(__dirname,f)))]));
  let protocol=null;
  if(options.protocol){
    protocol=JSON.parse(fs.readFileSync(path.resolve(options.protocol),'utf8'));
    if(protocol.version!==VERSION||protocol.database!=='toeic_learning_system'||
      JSON.stringify(protocol.artifact_sha256)!==JSON.stringify(hashes)||JSON.stringify(protocol.code_sha256)!==JSON.stringify(code)||
      !Number.isFinite(Date.parse(protocol.target_start_at_or_after)))throw Error('Canonical protocol mismatch; preserve old protocols');
    options.targetAfter=protocol.target_start_at_or_after;options.prospective=true;
  }
  const c=new Client({...base,database:'toeic_learning_system',options:'-c default_transaction_read_only=on'});
  let report;
  try{await c.connect();
    const identity=(await c.query(`SELECT current_database() AS db,shobj_description((SELECT oid FROM pg_database
      WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
    if(identity.db!=='toeic_learning_system'||identity.marker!=='TOEIC_UNIFIED_DEVELOPMENT')throw Error('Verified canonical database required');
    report=await collect(c,hashes,{...options,respectCaptureOrigin:true});
  }finally{await c.end();}
  const out=path.join(root,'toeic-ai/reports/unified_lightgbm_validation',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(out,{recursive:true});
  const save=(f,v)=>fs.writeFileSync(path.join(out,f),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx'});
  if(options.freeze){protocol={version:VERSION,database:'toeic_learning_system',
    target_start_at_or_after:new Date(report.context.captured_at).toISOString(),artifact_sha256:hashes,code_sha256:code,
    policy:'Future canonical targets only. Captured legacy forecasts replay against their source cohort; new forecasts use all prior canonical history. No retraining or ability claims.'};save('protocol.json',protocol);}
  report.migration_policy='Legacy forecasts keep original database evidence scope; frozen inputs/outcomes never rewritten.';
  save('report.json',report);save('SUMMARY.md',summaryMarkdown(report));
  save('manifest.json',{database:'toeic_learning_system',read_only:true,inference_calls:0,training_calls:0,
    artifact_sha256:hashes,code_sha256:code,report_sha256:sha(fs.readFileSync(path.join(out,'report.json')))});
  console.log(JSON.stringify({output:out,v3_rows:report.v3_pre_attempt.overall.model.rows,v2_rows:report.v2_next_attempt.overall.model.rows,
    exclusions:report.exclusions,protocol:options.freeze?path.join(out,'protocol.json'):options.protocol||null}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
