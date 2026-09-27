// Integration tests: isolated PostgreSQL schema and generated ZIP/Excel fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
function workbook(sheets) {
  const wb=XLSX.utils.book_new();
  for(const [name,rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
function zip(files) { const z=new AdmZip(); for(const [name,data] of Object.entries(files))z.addFile(name,Buffer.isBuffer(data)?data:Buffer.from(data));return z.toBuffer(); }
const options=['A','B','C','D'].map(label=>({label,text:label}));
const reading=(part,key,n,extra={})=>Array.from({length:n},(_,i)=>({part_number:part,passage_key:key,passage:{content:'Passage '+key},question_text:'Question '+i,correct_answer:'A',choices:options,...extra}));
const rows=(key,n)=>Array.from({length:n},(_,i)=>({passage_key:key,question_text:'Question '+i,A:'One',B:'Two',C:'Three',D:'Four',correct_answer:'a',explanation:'Because '+i}));
async function main(){
  if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL must point to an isolated test server');
  const schema='import_check_'+crypto.randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  let server,uploadsDir;const mediaDirs=new Set();
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(fs.readFileSync(path.join(__dirname,'../database/toeic_learning_system.sql'),'utf8'));
    const dbPath=require.resolve('../db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:pool};
    process.env.JWT_SECRET='import-test-secret';
    const app=require('../server');
    const uploadPaths=require('../src/middlewares/upload');uploadsDir=uploadPaths.importsDir;
    const beforeStage=fs.readdirSync(uploadPaths.stagingDir).sort();
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const token=require('jsonwebtoken').sign({user_id:1,role:'ADMIN'},process.env.JWT_SECRET);
    async function request(endpoint,{items,archive,status=201,auth=true}={}){
      const headers=auth?{Authorization:`Bearer ${token}`} : {};
      let body;
      if(archive){body=new FormData();body.append('file',new Blob([archive]),'fixture.zip');}
      else{headers['Content-Type']='application/json';body=JSON.stringify({items});}
      const response=await fetch(base+endpoint,{method:'POST',headers,body});
      const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
    }
    const endpoint='/api/admin/questions/import';
    const q5={part_number:5,question_text:'Choose the word',correct_answer:' a ',choices:options,explanation:'Saved explanation'};
    const imported=await request(endpoint,{items:[q5]});assert.equal(imported.created,1);assert.equal(imported.items[0].correct_answer,'A');
    const duplicates=await Promise.all([1,2].map(()=>request(endpoint,{items:[q5],status:200})));assert.ok(duplicates.every(r=>r.duplicate && r.created===0));
    const badGroup=reading(6,'bad',4);badGroup[3].choices=options.slice(0,3);
    const rejected=await request(endpoint,{items:badGroup,status:422});assert.equal(rejected.created,0);assert.equal(rejected.errors[0].column,'choices');
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM questions')).rows[0].n,1);
    await request(endpoint,{items:reading(6,'valid',4)});
    const badPart7=reading(7,'small',1);await request(endpoint,{items:badPart7,status:422});
    const a=workbook({passages:[{key:'p1',content:'Workbook A passage'}],questions:rows('p1',2)});
    const b=workbook({passages:[{key:'p1',content:'Workbook B passage'}],questions:rows('p1',2)});
    const multiWorkbook=zip({'a.xlsx':a,'b.xlsx':b});
    const collision=await request('/api/admin/questions/import-zip/part7',{archive:multiWorkbook});
    assert.equal(new Set(collision.items.map(q=>q.passage_id)).size,2);
    await request('/api/admin/questions/import-zip/part7',{archive:multiWorkbook,status:200});
    const badRows=rows('p1',2);badRows[1].correct_answer='X';
    const bad=await request('/api/admin/questions/import-zip/part7',{archive:zip({'bad.xlsx':workbook({passages:[{key:'p1',content:'Bad'}],questions:badRows})}),status:422});
    assert.ok(bad.errors.some(e=>e.file==='bad.xlsx'&&e.sheet==='questions'&&e.row===3&&e.column==='correct_answer'));
    const multi=await request('/api/admin/questions/import-zip/part7',{archive:zip({'multi.xlsx':workbook({passages:[{key:'p1',content:'Email'},{key:'p2',content:'Schedule'}],questions:rows('p1',5).map(q=>({...q,passage_keys:'p1|p2',group_key:'double'}))})})});
    assert.equal(multi.items[0].passages.length,2);
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM question_group_passages WHERE group_id=$1',[multi.items[0].group_id])).rows[0].n,2);
    const img=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=','base64');
    const listenRow={part:1,correct_answer:'A',A:'a',B:'b',C:'c',D:'d',audio_path:'audio.mp3',image_path:'picture.png',explanation:'Photo explanation'};
    const listenZip=zip({'questions.xlsx':workbook({questions:[listenRow]}),'audio.mp3':Buffer.from('ID3testfixture'),'picture.png':img});
    const listening=await request('/api/admin/listening/questions/import-zip',{archive:listenZip});
    assert.equal(listening.items[0].explanation,'Photo explanation');
    const mediaUrl=listening.items[0].image_url;mediaDirs.add(mediaUrl.split('/')[3]);
    assert.equal((await fetch(base+mediaUrl)).status,200);
    const files=fs.readdirSync(path.join(uploadsDir,mediaUrl.split('/')[3]));assert.ok(files.every(f=>!f.endsWith('.xlsx')));
    await request('/api/admin/listening/questions/import-zip',{archive:listenZip,status:200});
    const missing=await request('/api/admin/listening/questions/import-zip',{archive:zip({'questions.xlsx':workbook({questions:[listenRow]})}),status:422});assert.ok(missing.errors.some(e=>e.column==='audio_url'));
    for(const part of [2,3,4]){
      const count=part>=3?3:1;
      const r=await request('/api/admin/listening/questions/import',{items:Array.from({length:count},(_,i)=>({part_number:part,question_text:part===2?'':'Question '+i,correct_answer:'A',choices:part===2?options.slice(0,3):options,material:{audio_url:'https://example.invalid/audio.mp3',title:'Group '+part}}))});assert.equal(r.created,count);
    }
    await request('/api/admin/listening/questions/import',{items:[{part_number:1,correct_answer:'A',choices:options}],status:422});
    await request('/api/admin/listening/questions/import',{items:[{part_number:1,correct_answer:'A',choices:options,image_url:'/uploads/../package.json',material:{audio_url:'https://example.invalid/a.mp3'}}],status:422});
    await request('/api/admin/questions/import-zip/part7',{archive:zip({'notes.exe':'not allowed','q.xlsx':a}),status:422});
    await request('/api/admin/questions/import-zip/part7',{archive:zip({'bad.xlsx':workbook({wrong:rows('p1',2)})}),status:422});
    await request('/api/admin/questions/import-zip/part7',{archive:Buffer.from('not a zip'),status:422});
    const ambiguous=zip({'q.xlsx':workbook({questions:[listenRow]}),'a/picture.png':img,'b/picture.png':img,'audio.mp3':Buffer.from('ID3test')});
    await request('/api/admin/listening/questions/import-zip',{archive:ambiguous,status:422});
    const vocabEndpoint='/api/admin/vocabulary/import';
    await request(vocabEndpoint,{items:[{word:'invoice',meaning_vi:'hóa đơn',part_of_speech:'noun',topic_id:1}]});
    await request(vocabEndpoint,{items:[{word:'missing',meaning_vi:'',_source:{row:6}}],status:422});
    await request(vocabEndpoint,{items:[{word:'bad topic',meaning_vi:'test',topic_id:2147483647}],status:422});
    const n=(await pool.query('SELECT COUNT(*)::integer AS n FROM questions')).rows[0].n;
    const sqlFail=[{...q5,question_text:'Rollback this'},...reading(7,'db-fail',2,{passage:{title:'x'.repeat(501),content:'Too long title'}})];
    await request(endpoint,{items:sqlFail,status:422});
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM questions')).rows[0].n,n);
    await request(endpoint,{items:[q5],auth:false,status:401});
    const result=await require('../src/modules/questions/questionService').getQuestionById(multi.items[0].question_id);assert.equal(result.passages.length,2);
    await require('../src/modules/questions/questionService').deletePassageGroup(multi.items[0].passage_id);
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM question_group_passages WHERE group_id=$1',[multi.items[0].group_id])).rows[0].n,0);
    assert.deepEqual(fs.readdirSync(uploadPaths.stagingDir).sort(),beforeStage);
    console.log('PASS: Parts 1–7, exact choices, atomic groups/batches, workbook keys, multi-passages, explanations, duplicate/concurrent requests, media serving, missing/ambiguous media, bad archives, row errors, vocabulary topics, SQL rollback, group deletion, auth, staging cleanup.');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    // Only directories referenced by this isolated test's own imported questions are removed.
    if(uploadsDir)for(const id of mediaDirs){assert.match(id,/^[a-f0-9-]{36}$/);const dir=path.resolve(uploadsDir,id);assert.equal(path.dirname(dir),path.resolve(uploadsDir));fs.rmSync(dir,{recursive:true,force:true});}
    await pool.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});
