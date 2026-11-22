const assert = require('node:assert/strict');
const { isolatedContentTest } = require('./support/isolatedContentTest');
(async () => {
 const fixture = await isolatedContentTest('source');
 const { client } = fixture;
 try {
  const {saveBatch} = require('../src/modules/imports/importService');
  const token = require('node:crypto').randomUUID();
  const item = source => ({source_set:source,part_number:1,order_in_test:1,correct_answer:'A',difficulty_level:1,explanation:'English\nBản dịch',choices:['A','B','C','D'].map(label=>({label,text:label}))});
  const first = await saveBatch([item(`Test 8 ${token}`)],'listening');
  assert.equal(first.created,1);
  const other = await saveBatch([item(`Test 1 ${token}`)],'listening');
  assert.equal(other.created,1);
  assert.equal((await saveBatch([item(`Test 8 ${token}`)],'listening')).duplicate,true);
  await assert.rejects(saveBatch([{...item(`TEST 8 ${token}`), explanation:'Changed'}],'listening'),e=>e.status===422 && e.errors[0].column==='question_number');
  const found=await client.query('SELECT source_set, explanation FROM questions WHERE question_id=$1',[first.items[0].question_id]);
  assert.equal(found.rows[0].source_set,`Test 8 ${token}`);
  assert.equal(found.rows[0].explanation,'English\nBản dịch');
  const readingItem=source=>({...item(source),part_number:5,order_in_test:101,question_text:'Choose the correct word.'});
  const {validateItems}=require('../src/modules/imports/importService');
  const reading=await saveBatch(validateItems([readingItem(`Reading 8 ${token}`)],'reading'),'reading');
  assert.equal(reading.created,1);
  assert.equal((await saveBatch(validateItems([readingItem(`Reading 1 ${token}`)],'reading'),'reading')).created,1);
  await assert.rejects(saveBatch([{...readingItem(`Reading 8 ${token}`),explanation:'Updated'}],'reading'),e=>e.status===422);
  assert.throws(()=>validateItems([{...readingItem('   ')}],'reading'),e=>e.status===422);
  const model=require('../src/modules/questions/questionModel');
  const filter=model.buildWhereClause({part_number:5,source_set:`Reading 8 ${token}`});
  const filtered=await client.query(`SELECT question_id FROM questions q ${filter.whereClause}`,filter.params);
  assert.deepEqual(filtered.rows.map(r=>r.question_id),[reading.items[0].question_id]);
  assert.ok(model.buildWhereClause({source_set:'__unassigned__'}).whereClause.includes('q.source_set IS NULL'));
  const archive=require('../src/modules/imports/archive');
  const fs=require('node:fs'),path=require('node:path');
  const staged=path.join(require('../src/middlewares/upload').stagingDir,`${token}.zip`);
  fs.copyFileSync(path.resolve(__dirname,'../../toeic_admin_vite/public/templates/toeic_reading_part6_quick.zip'),staged);
  const context=archive.openArchive({path:staged,originalname:'part6.zip'});
  try {
    const parsed=require('../src/modules/imports/quickReading').parseQuickPart6(context);
    const items=validateItems(parsed.items,'reading',parsed.errors).map(q=>({...q,source_set:`Part6 ${token}`}));
    const imported=await saveBatch(items,'reading');assert.equal(imported.created,16);
    const groups=await client.query('SELECT group_id,COUNT(*)::int AS count FROM questions WHERE question_id=ANY($1::int[]) GROUP BY group_id',[imported.items.map(q=>q.question_id)]);
    assert.equal(groups.rows.length,4);assert.ok(groups.rows.every(g=>g.group_id&&g.count===4));
    const passages=await client.query('SELECT DISTINCT p.passage_id,p.image_url FROM questions q JOIN question_group_passages gp USING(group_id) JOIN reading_passages p ON p.passage_id=gp.passage_id WHERE q.question_id=ANY($1::int[])',[imported.items.map(q=>q.question_id)]);
    assert.equal(passages.rows.length,4);assert.ok(passages.rows.every(p=>p.image_url));
    const numbers=await client.query('SELECT source_question_number FROM questions WHERE question_id=ANY($1::int[]) ORDER BY source_question_number',[imported.items.map(q=>q.question_id)]);
    assert.deepEqual(numbers.rows.map(q=>q.source_question_number),Array.from({length:16},(_,i)=>131+i));
    const groupSearch=model.buildWhereClause({part_number:6,source_set:`Part6 ${token}`,search:'131'});
    const matches=await client.query(`SELECT question_id FROM questions q ${groupSearch.whereClause}`,groupSearch.params);
    assert.equal(matches.rows.length,4);
    console.log('PASS: Part 6 database persistence with 16 source-numbered questions, 4 groups and 4 image passages.');
  } finally {context.cleanup();}
  console.log('PASS: Part 5 persistence, source filtering, source validation and duplicate rejection.');
  console.log('PASS: source numbering/filtering, duplicate rejection, multiline explanation. Explicit marked toeic_learning_events_test only; fixture transaction rolled back and own schema removed.');
 } finally {await fixture.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
