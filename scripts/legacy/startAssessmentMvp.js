// Standalone development API. Never imports a DB driver, main server or AI service.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {buildAssessment}=require('./assessment');
function createAssessmentServer(snapshot) {
 return http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(403);return res.end(JSON.stringify({error:'Local development host only'}));}
  const origin=req.headers.origin;
  if(origin&&!['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:5174','http://localhost:5174'].includes(origin)){res.writeHead(403);return res.end(JSON.stringify({error:'Development origin not allowed'}));}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method!=='GET'){res.writeHead(405);return res.end(JSON.stringify({error:'Read-only API'}));}
  try {
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/assessment-api/health')return res.end(JSON.stringify({status:'ok',mode:'isolated_snapshot_only',database_connected:false,model_inference_used:false,snapshot_id:snapshot.snapshot_id}));
   if(url.pathname==='/assessment-api/learners')return res.end(JSON.stringify(snapshot.users));
   const match=url.pathname.match(/^\/assessment-api\/learners\/([1-9]\d*)$/);
   if(!match){res.writeHead(404);return res.end(JSON.stringify({error:'Not found'}));}
   const options=url.searchParams.has('cutoff')?{cutoffMs:Date.parse(url.searchParams.get('cutoff'))}:{};
   res.end(JSON.stringify(buildAssessment(snapshot,Number(match[1]),options)));
  }catch(e){res.writeHead(e.status||500);res.end(JSON.stringify({error:e.status?e.message:'Assessment failed'}));}
 });
}
if(require.main===module){try{
 const snap=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../private/assessment-mvp/snapshot.json'),'utf8'));
 if(snap.format_version!==1||snap.read_only!=='on'||snap.database!=='toeic_learning_events_dev')throw Error('Export a readonly snapshot first');
 const server=createAssessmentServer(snap);server.on('error',e=>{console.error(e.message);process.exitCode=1;});
 server.listen(3012,'127.0.0.1',()=>console.log('Assessment MVP: http://127.0.0.1:3012/assessment-api/health (snapshot only; no DB/AI connection)'));
}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={createAssessmentServer};
