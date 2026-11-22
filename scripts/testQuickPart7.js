const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), Zip=require('adm-zip'), X=require('xlsx');
require.cache[require.resolve('../db')]={exports:{}};
const {openArchive}=require('../src/modules/imports/archive');
const {parseQuickPart7}=require('../src/modules/imports/quickPart7');
const {validateItems}=require('../src/modules/imports/importService');
const {stagingDir}=require('../src/middlewares/upload');
const template=path.resolve(__dirname,'../../toeic_admin_vite/public/templates/toeic_reading_part7_quick.zip');
function edit(z, fn) {const w=X.read(z.readFile('questions.xlsx')),r=X.utils.sheet_to_json(w.Sheets.questions);fn(r);w.Sheets.questions=X.utils.json_to_sheet(r);z.updateFile('questions.xlsx',X.write(w,{type:'buffer',bookType:'xlsx'}));}
function check(mutate,valid=true,inspect) {
 const z=new Zip(template);mutate?.(z);const temp=path.join(stagingDir,require('node:crypto').randomUUID()+'.zip');z.writeZip(temp);
 const c=openArchive({path:temp});try{const p=parseQuickPart7(c);if(valid){const items=validateItems(p.items,'reading',p.errors);inspect?.(items);}else assert.throws(()=>validateItems(p.items,'reading',p.errors),e=>e.status===422);}finally{c.cleanup();}
}
check(null,true,items=>{assert.equal(items.length,4);assert.equal(new Set(items.map(q=>q.group_key)).size,2);assert.ok(items.every(q=>q.passages[0].image_url && !q.passages[0].content && q.passages[0].translation && q.passages[0].explanation && q.explanation));});
for (const dash of ['–','—','−','‐','‑']) check(z=>{
 for(const e of z.getEntries().filter(e=>e.entryName.endsWith('.png'))) {
  z.addFile(e.entryName.replaceAll('-',dash),e.getData());z.deleteFile(e.entryName);
 }
},true,items=>assert.equal(items.length,4));
const {decodeUploadFilename}=require('../src/modules/imports/filenames');
assert.equal(decodeUploadFilename(Buffer.from('196–200-1.png','utf8').toString('latin1')),'196–200-1.png');
assert.equal(decodeUploadFilename('café.png'),'café.png');
assert.equal(decodeUploadFilename('Đề thi.png'),'Đề thi.png');
check(z=>z.deleteFile('147-148.png'),false);
check(z=>z.addFile('other/147-148.png',z.readFile('147-148.png')),false);
check(z=>z.addFile('147-149.png',z.readFile('147-148.png')),false);
check(z=>edit(z,r=>r.pop()),false);
check(z=>edit(z,r=>{r[1].question_number=147;}),false);
check(z=>edit(z,r=>{r[0].A='';}),false);
check(z=>edit(z,r=>{r[0].correct_answer='Z';}),false);
check(z=>edit(z,r=>{r[1].passage_translation='Conflicting translation';}),false);
check(z=>{
 const img=z.readFile('147-148.png');z.deleteFile('147-148.png');z.deleteFile('149-150.png');
 for(const i of [1,2,3])z.addFile(`176-180-${i}.png`,img);
 edit(z,r=>{const sample={...r[0]};r.splice(0,r.length,...Array.from({length:5},(_,i)=>({...sample,question_number:176+i,passage_translation:i?'':'Shared translation',passage_explanation:''})));});
},true,items=>{assert.equal(items.length,5);assert.ok(items.every(q=>q.passages.length===3));assert.equal(items[0].passages[0].translation,'Shared translation');assert.equal(items[0].passages[1].translation,'');});
console.log('PASS: Part 7 image groups, question and passage explanations, translations, multi-passages, missing/overlapping/duplicate images, incomplete/duplicate questions and invalid answers.');

async function http() {
 const service=require('../src/modules/imports/importService');let saved;
 service.saveBatch=async(items,kind)=>{saved={items,kind};return{created:items.length};};
 const controller=require('../src/modules/imports/quickController'),app=require('express')();
 app.post('/quick/:part/:action',controller.upload,controller.handleReading);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try {for(const unicode of [false,true])for(const loose of [false,true]){const body=new FormData();body.append('source_set','Part 7 fixture');const z=new Zip(template);
  if(unicode)for(const e of z.getEntries().filter(e=>e.entryName.endsWith('.png'))) {z.addFile(e.entryName.replaceAll('-','–'),e.getData());z.deleteFile(e.entryName);}
  if(loose)for(const e of z.getEntries().filter(e=>!e.entryName.endsWith('.txt')))body.append('files',new Blob([e.getData()]),e.entryName);
  else body.append('files',new Blob([z.toBuffer()]),'part7.zip');
  const response=await fetch(`http://127.0.0.1:${server.address().port}/quick/7/preview`,{method:'POST',body});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.total,4);assert.equal(data.groups.length,2);assert.ok(data.groups.every(g=>g.image&&!g.audio));assert.equal(saved,undefined);
 }
 const body=new FormData();body.append('source_set','Part 7 fixture');body.append('files',new Blob([fs.readFileSync(template)]),'part7.zip');
 const response=await fetch(`http://127.0.0.1:${server.address().port}/quick/7/commit`,{method:'POST',body});assert.equal(response.status,201);assert.equal(saved.kind,'reading');assert.ok(saved.items.every(q=>q.source_set==='Part 7 fixture'));
 console.log('PASS: Part 7 multipart loose-file/ZIP preview, source set and commit handoff. Persistence mocked.');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
http().catch(e=>{console.error(e);process.exitCode=1;});
