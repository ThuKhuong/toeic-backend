const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeTestName,assertUniqueTestName}=require('../src/modules/tests/testNameGuard');
test('normalize spacing and Unicode compatibility, reject blank/non-string/oversize names',()=>{
 assert.equal(normalizeTestName('  Part\u00a03  -  Test 6  '),'Part 3 - Test 6');
 for(const v of [null,{},'', '   ','x'.repeat(501)])assert.throws(()=>normalizeTestName(v),e=>e.status===400);
});
test('lock before checking names, reject case/spacing variants and allow own unchanged name',async()=>{
 const calls=[],client={query:async(sql)=>{calls.push(sql);return {rows:[{test_id:37,test_name:'Part 3 - Test 6'}]};}};
 await assert.rejects(assertUniqueTestName(client,' PART 3  - TEST 6 '),e=>e.status===409&&e.code==='DUPLICATE_TEST_NAME');
 assert.match(calls[0],/pg_advisory_xact_lock/);assert.match(calls[1],/deleted_at IS NULL/);
 assert.equal(await assertUniqueTestName(client,' Part 3 - Test 6 ',37),'Part 3 - Test 6');
 assert.equal(await assertUniqueTestName(client,'Part 3 - Test 8'),'Part 3 - Test 8');
});
