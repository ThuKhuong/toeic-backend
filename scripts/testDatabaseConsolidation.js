// In-memory planning only; no database writes or artificial collection data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makePlan}=require('./consolidateDatabases');
const col=n=>({column_name:n,udt_name:'int4',is_nullable:'NO',column_default:null});
const table=(keys,rows)=>({keys,rows,count:rows.length,columns:Object.keys(rows[0]||Object.fromEntries(keys.map(k=>[k,null]))).map(col)});
function fixture(){
  const m={tables:{User:table(['user_id'],[{user_id:1,email:'main@example.invalid'}]),user_stats:table(['stat_id'],[{stat_id:1,user_id:1}]),
    questions:table(['question_id'],[{question_id:7,test_id:1,order_in_test:1}])}};
  const d=structuredClone(m);d.tables.User.rows=[{user_id:1,email:'dev@example.invalid'}];d.tables.questions.rows=[{question_id:7,test_id:null,order_in_test:null}];
  return [m,d];
}
test('colliding account/stat IDs map separately; existing bank assignment is retained',()=>{
  const [m,d]=fixture(),before=JSON.stringify([m,d]),p=makePlan(m,d);
  assert.deepEqual(p.maps.User,{'1':2});assert.equal(p.additions.user_stats[0].row.user_id,2);
  assert.equal(p.additions.questions.length,0);assert.equal(p.reused.questions,1);assert.equal(JSON.stringify([m,d]),before);
});
test('ambiguous emails, edited content and unknown graph dependencies stop before writes',()=>{
  let [m,d]=fixture();d.tables.User.rows[0].email=m.tables.User.rows[0].email;assert.throws(()=>makePlan(m,d),/Ambiguous account/);
  [m,d]=fixture();d.tables.questions.rows[0].order_in_test=2;d.tables.questions.rows[0].test_id=2;assert.throws(()=>makePlan(m,d),/Unresolved row/);
  [m,d]=fixture();d.tables.questions.rows[0].question_id=8;assert.throws(()=>makePlan(m,d),/Unexpected missing content/);
});
