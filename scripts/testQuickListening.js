const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Zip=require('adm-zip');
const X=require('xlsx');
require.cache[require.resolve('../db')]={exports:{}};
const {openArchive}=require('../src/modules/imports/archive');
const {parseArchive}=require('../src/modules/imports/parser');
const {validateItems}=require('../src/modules/imports/importService');
const {stagingDir}=require('../src/middlewares/upload');
function check(part, mutate, valid=true, quick=true, inspect=null) {
 const file=path.resolve(__dirname,`../../toeic_admin_vite/public/templates/toeic_listening_part${part}_${quick?'quick':'sample'}.zip`);
 const zip=new Zip(file);if(mutate)mutate(zip);
 const temp=path.join(stagingDir,require('node:crypto').randomUUID()+'.zip');zip.writeZip(temp);
 const c=openArchive({path:temp,originalname:'test.zip'});
 try {const parsed=parseArchive(c,null,{listeningPart:part});
 const run=()=>validateItems(parsed.items,'listening',parsed.errors);
 if(valid){if(inspect)inspect(run());assert.equal(run().length,6);if(part===1 || part===2){assert.ok(run().every(q=>!q.group_key && (part===1 ? q.image_url : !q.image_url) && q.material.audio_url));assert.equal(new Set(run().map(q=>q.material.audio_url)).size,6);}else assert.equal(new Set(run().map(q=>q.group_key)).size,2);}else assert.throws(run,e=>e.status===422);
 }finally{c.cleanup();}
}
for(const p of [3,4]) {check(p);check(p,null,true,false);}
for (const quick of [true, false]) check(4, z => {
 const wb=X.read(z.readFile('questions.xlsx'));
 for (const sheet of wb.SheetNames) {
  const data=X.utils.sheet_to_json(wb.Sheets[sheet]);
  data.forEach(row=>{delete row.material_title;});
  wb.Sheets[sheet]=X.utils.json_to_sheet(data);
 }
 z.updateFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));
}, true, quick);
check(1);
function renameQuestionSheet(zip, name = 'TEST 6 - 2026') {
 const wb=X.read(zip.readFile('questions.xlsx'));
 wb.Sheets[name]=wb.Sheets.questions;delete wb.Sheets.questions;
 wb.SheetNames=wb.SheetNames.map(sheet=>sheet==='questions'?name:sheet);
 zip.updateFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));
}
for (const part of [1,2,3,4]) check(part,renameQuestionSheet,true,true,items=>{
 assert.ok(items.every(q=>q._source.sheet==='TEST 6 - 2026'));
 assert.equal(items[0]._source.row,2);
});
check(1,zip=>{
 renameQuestionSheet(zip);
 zip.deleteFile('audio/1.wav');
},false);
check(1,zip=>{
 const wb=X.read(zip.readFile('questions.xlsx'));
 wb.Sheets['Other questions']=wb.Sheets.questions;wb.SheetNames.push('Other questions');
 zip.updateFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));
},false);
check(2, null, true, true, items => {
 for(const q of items) {assert.deepEqual(q.choices.map(c=>c.label), ['A','B','C']);assert.ok(q.explanation);assert.ok(!q.image_url);}
});
check(2,z=>z.deleteFile('audio/7.wav'),false);
check(2,z=>edit(z,r=>{r[0].correct_answer='D';}),false);
check(2,z=>edit(z,r=>{r[1].question_number=7;}),false);
check(2,z=>edit(z,r=>{r[0].explanation='Lời thoại\nBản dịch';}),true,true,items=>assert.equal(items[0].explanation,'Lời thoại\nBản dịch'));

const commonExplanation = '(A) A wooden post is being painted.\n(B) Flowers have been placed under some chairs.\nBản dịch và giải thích chung.';
check(1,z=>edit(z,rows=>rows.forEach(q=>{
  for(const key of ['A','B','C','D','transcript']) delete q[key];
  q.explanation=commonExplanation;
})),true,true,items=>{
  for(const q of items){
    assert.deepEqual(q.choices.map(c=>({label:c.label,text:c.text})),['A','B','C','D'].map(label=>({label,text:label})));
    assert.equal(q.explanation,commonExplanation);
    assert.ok(!q.material.transcript);
  }
});

check(1,z=>z.deleteFile('audio/1.wav'),false);
check(1,z=>z.deleteFile('images/1.png'),false);
check(1,z=>z.addFile('images/01.png',z.readFile('images/1.png')),false);
check(1,z=>z.addFile('audio/99.wav',z.readFile('audio/1.wav')),false);
check(1,z=>edit(z,r=>{r[1].question_number=1;}),false);
check(1,z=>edit(z,r=>{r[0].correct_answer='Z';}),false);
check(1,z=>edit(z,r=>r.forEach(q=>{delete q.A;delete q.B;delete q.C;delete q.D;})));
check(4,z=>z.deleteFile('audio/71-73.wav'),false);
check(4,z=>z.addFile('audio/72-74.wav',z.readFile('audio/71-73.wav')),false);
function edit(z,fn){const wb=X.read(z.readFile('questions.xlsx'));const r=X.utils.sheet_to_json(wb.Sheets.questions);fn(r);wb.Sheets.questions=X.utils.json_to_sheet(r);z.updateFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));}
check(4,z=>edit(z,r=>r.pop()),false);
check(4,z=>edit(z,r=>{r[1].question_number=71;}),false);
check(4,z=>edit(z,r=>{r[0].correct_answer='Z';}),false);
// A filename may include an unused boundary number; actual Excel rows still
// need exactly three consecutive questions, with the canonical transcript group.
for (const part of [3,4]) check(part,z=>{
 const audio=z.getEntries().filter(e=>e.entryName.endsWith('.wav')).at(-1);
 const stem=path.posix.basename(audio.entryName,'.wav');
 const [start,end]=stem.split('-').map(Number);
 const alias=`${start}-${end+1}`;
 z.addFile(`audio/${alias}.wav`,audio.getData());z.deleteFile(audio.entryName);
 const wb=X.read(z.readFile('questions.xlsx'));
 const groups=X.utils.sheet_to_json(wb.Sheets.groups);
 groups.find(g=>g.question_range===stem).transcript='Canonical transcript';
 wb.Sheets.groups=X.utils.json_to_sheet(groups);
 z.updateFile('questions.xlsx',X.write(wb,{type:'buffer',bookType:'xlsx'}));
 const image=new Zip(path.resolve(__dirname,'../../toeic_admin_vite/public/templates/toeic_listening_part1_quick.zip')).readFile('images/1.png');
 z.addFile(`images/${alias}.png`,image);
},true,true,items=>{
 const last=items.slice(-3);
 assert.ok(last.every(q=>q.image_url?.endsWith('.png')));
 assert.ok(last.every(q=>q.material.transcript==='Canonical transcript'));
});
check(4,z=>edit(z,r=>{r[5].question_number=77;}),false);
check(4,z=>{
 const image=new Zip(path.resolve(__dirname,'../../toeic_admin_vite/public/templates/toeic_listening_part1_quick.zip')).readFile('images/1.png');
 z.addFile('images/71-73.png',image);z.addFile('other/71-73.png',image);
},false);
console.log('PASS: quick Parts 1/2/3/4, legacy templates, missing audio, overlapping ranges, missing/duplicate question numbers and invalid answers. No database writes.');

async function httpChecks() {
 const service=require('../src/modules/imports/importService');
 let saves=0;const fingerprints=[];
 service.saveBatch=async(items,kind,context)=>{saves++;fingerprints.push(context.fingerprint);return {created:items.length};};
 const controller=require('../src/modules/imports/quickController');
 const app=require('express')();
 const {authMiddleware,adminMiddleware}=require('../src/middlewares/auth');
 app.post('/quick/:part/:action',authMiddleware,adminMiddleware,controller.upload,controller.handle);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const token=role=>require('jsonwebtoken').sign({user_id:1,role},process.env.JWT_SECRET||'secret123');
 const baseline=fs.readdirSync(stagingDir).sort();
 try {
  const zip=new Zip(path.resolve(__dirname,'../../toeic_admin_vite/public/templates/toeic_listening_part4_quick.zip'));
  const request=async(action,role='ADMIN',reverse=false,part=4,renamed=false)=>{
   const archive=[1,2].includes(part)?new Zip(path.resolve(__dirname,`../../toeic_admin_vite/public/templates/toeic_listening_part${part}_quick.zip`)):zip;
   if(renamed)renameQuestionSheet(archive);
   const body=new FormData();body.append('source_set','Test integration');let entries=archive.getEntries().filter(e=>!e.isDirectory&&!e.entryName.endsWith('.txt'));
   if(reverse)entries.reverse();
   for(const e of entries)body.append('files',new Blob([e.getData()]),path.posix.basename(e.entryName));
   const response=await fetch(`http://127.0.0.1:${server.address().port}/quick/${part}/${action}`,{method:'POST',headers:{Authorization:`Bearer ${token(role)}`},body});
   return {status:response.status,data:await response.json()};
  };
  assert.equal((await request('preview','STUDENT')).status,403);
  const preview=await request('preview');assert.equal(preview.status,200);assert.equal(preview.data.groups.length,2);assert.equal(saves,0);
  const p1=await request('preview','ADMIN',false,1);assert.equal(p1.status,200);assert.equal(p1.data.groups.length,6);assert.ok(p1.data.groups.every(g=>g.image && g.questions.length===1));assert.equal(saves,0);
  const renamed=await request('preview','ADMIN',false,1,true);assert.equal(renamed.status,200);assert.equal(renamed.data.total,6);assert.ok(renamed.data.groups.every(g=>g.image && g.audio && g.questions.length===1));assert.equal(saves,0);
  const p2=await request('preview','ADMIN',false,2);assert.equal(p2.status,200);assert.equal(p2.data.groups.length,6);assert.ok(p2.data.groups.every(g=>!g.image && g.questions.length===1));assert.equal(saves,0);
  assert.equal((await request('commit')).status,201);
  assert.equal((await request('commit','ADMIN',true)).status,201);
  assert.equal(fingerprints[0],fingerprints[1]);
  assert.equal((await request('commit','ADMIN',false,2)).status,201);
  assert.deepEqual(fs.readdirSync(stagingDir).sort(),baseline);
  console.log('PASS: multipart preview, admin authorization, commit handoff, stable fingerprint across file order, staging cleanup. Persistence mocked.');
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
httpChecks().catch(e=>{console.error(e);process.exitCode=1;});
