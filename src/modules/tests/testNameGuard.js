// Names identify forms in the learner UI; keep deleted historical rows intact.
function normalizeTestName(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Vui lòng nhập tên đề thi.'), {status:400});
  const name=value.normalize('NFKC').trim().replace(/\s+/gu,' ');
  if(!name || name.length>500) throw Object.assign(new Error('Tên đề thi phải từ 1 đến 500 ký tự.'), {status:400});
  return name;
}
async function assertUniqueTestName(client,value,excludeId=null) {
  const name=normalizeTestName(value),key=name.toLocaleLowerCase('vi');
  // All application create/rename paths use this transaction-level lock, so
  // simultaneous requests cannot both pass the check before committing.
  await client.query('SELECT pg_advisory_xact_lock(20261121, 103)');
  const rows=(await client.query('SELECT test_id,test_name FROM tests WHERE deleted_at IS NULL')).rows;
  if(rows.some(t=>Number(t.test_id)!==Number(excludeId)&&normalizeTestName(t.test_name).toLocaleLowerCase('vi')===key)) {
    throw Object.assign(new Error('Tên đề thi đã tồn tại. Vui lòng chọn tên khác.'), {status:409,code:'DUPLICATE_TEST_NAME'});
  }
  return name;
}
module.exports={normalizeTestName,assertUniqueTestName};
