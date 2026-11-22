// READ ONLY: inspect exactly the two requested tests. This script cannot perform a copy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { base } = require('./learningDevEnvironment');
const root = path.resolve(__dirname, '../..');
const SOURCE = 'toeic_learning_system', TARGET = 'toeic_learning_events_dev';
const wanted = ['Part 2 - Test 8', 'Part 3 - Test 8'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
const digest = row => sha(JSON.stringify(sorted(row)));
const unique = values => [...new Set(values.filter(x => x != null))].sort((a, b) => a - b);
const without = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

async function rows(client, table, column, ids) {
  // Identifiers are private constants; values always go through parameters.
  return (await client.query(`SELECT to_jsonb(t) AS data FROM "${table}" t WHERE "${column}"=ANY($1::int[]) ORDER BY "${column}",to_jsonb(t)::text`, [ids])).rows.map(r => r.data);
}

function compareRows(source, target, key, ignore = []) {
  const found = new Map(target.map(r => [r[key], r]));
  const result = { identical_ids: [], missing_ids: [], conflict_ids: [] };
  for (const row of source) {
    const other = found.get(row[key]);
    result[!other ? 'missing_ids' : digest(without(row, ignore)) === digest(without(other, ignore)) ? 'identical_ids' : 'conflict_ids'].push(row[key]);
  }
  return result;
}

async function inspect(source, target) {
  const tests = (await source.query('SELECT to_jsonb(t) AS data FROM tests t WHERE test_name=ANY($1::text[]) AND deleted_at IS NULL ORDER BY test_id', [wanted])).rows.map(r => r.data);
  if (tests.length !== 2 || wanted.some(name => tests.filter(t => t.test_name === name).length !== 1)) throw Error('Expected exactly one source test for each requested name');
  const sourceTestIds = tests.map(t => t.test_id);
  const questions = await rows(source, 'questions', 'test_id', sourceTestIds);
  const qids = unique(questions.map(q => q.question_id));
  const groups = await rows(source, 'question_groups', 'group_id', unique(questions.map(q => q.group_id)));
  const groupPassages = await rows(source, 'question_group_passages', 'group_id', groups.map(g => g.group_id));
  const graph = {
    questions,
    answer_choices: await rows(source, 'answer_choices', 'question_id', qids),
    question_groups: groups,
    listening_materials: await rows(source, 'listening_materials', 'material_id', unique([...questions.map(q => q.material_id), ...groups.map(g => g.material_id)])),
    reading_passages: await rows(source, 'reading_passages', 'passage_id', unique([...questions.map(q => q.passage_id), ...groupPassages.map(g => g.passage_id)])),
    question_group_passages: groupPassages,
    question_skills: await rows(source, 'question_skills', 'question_id', qids),
  };
  graph.skills = await rows(source, 'skills', 'skill_id', unique(graph.question_skills.map(r => r.skill_id)));
  graph.vocabulary = await rows(source, 'vocabulary', 'vocab_id', unique(questions.map(q => q.vocab_id)));
  const keys = { questions: 'question_id', answer_choices: 'choice_id', question_groups: 'group_id', listening_materials: 'material_id', reading_passages: 'passage_id', skills: 'skill_id', vocabulary: 'vocab_id' };
  const comparisons = {}, targetGraph = {};
  for (const [table, key] of Object.entries(keys)) {
    targetGraph[table] = await rows(target, table, key, graph[table].map(r => r[key]));
    comparisons[table] = compareRows(graph[table], targetGraph[table], key, table === 'questions' ? ['test_id'] : []);
  }
  const assignmentFields = ['test_id', 'order_in_test', 'source_set', 'source_question_number'];
  comparisons.question_content = compareRows(questions, targetGraph.questions, 'question_id', assignmentFields);
  const metadataChanges = questions.map(q => {
    const old = targetGraph.questions.find(r => r.question_id === q.question_id);
    if (!old) return null;
    const changes = Object.fromEntries(assignmentFields.filter(k => JSON.stringify(q[k]) !== JSON.stringify(old[k])).map(k =>
      [k, { source: q[k], current_dev: old[k] }]));
    return { question_id: q.question_id, changes };
  }).filter(Boolean);
  for (const [table, column, ids] of [['question_group_passages', 'group_id', groups.map(g => g.group_id)], ['question_skills', 'question_id', qids]]) {
    targetGraph[table] = await rows(target, table, column, ids);
    comparisons[table] = { source_rows: graph[table].length, target_rows: targetGraph[table].length,
      identical_set: digest(graph[table]) === digest(targetGraph[table]) };
  }
  const targetTests = (await target.query('SELECT test_id,test_name,parts,publication_status,is_active,deleted_at FROM tests WHERE test_name=ANY($1::text[]) OR test_id=ANY($2::int[]) ORDER BY test_id', [wanted, sourceTestIds])).rows;
  const assigned = targetGraph.questions.filter(q => q.test_id != null).map(q => ({ question_id: q.question_id, test_id: q.test_id }));
  const history = (await target.query(`SELECT
    (SELECT count(*)::int FROM attempt_questions WHERE question_id=ANY($1::int[])) AS attempt_question_references,
    (SELECT count(*)::int FROM user_answers WHERE question_id=ANY($1::int[])) AS answer_references,
    (SELECT count(*)::int FROM learning_events WHERE question_id=ANY($1::int[])) AS learning_event_references`, [qids])).rows[0];
  const quality = tests.map(t => {
    const qs = questions.filter(q => q.test_id === t.test_id);
    const issues = qs.filter(q => {
      const choices = graph.answer_choices.filter(c => c.question_id === q.question_id);
      const labels = q.part_number === 2 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
      return choices.length !== labels.length || labels.some(label => choices.filter(c => c.choice_label === label).length !== 1) ||
        choices.filter(c => c.is_correct).length !== 1 || !choices.some(c => c.is_correct && c.choice_label === q.correct_answer);
    }).map(q => q.question_id);
    return { test_id: t.test_id, test_name: t.test_name, publication_status: t.publication_status, is_active: t.is_active, parts: t.parts,
      questions: qs.length, question_ids: qs.map(q => q.question_id), answers: graph.answer_choices.filter(c => qs.some(q => q.question_id === c.question_id)).length,
      material_ids: unique(qs.map(q => q.material_id)), group_ids: unique(qs.map(q => q.group_id)),
      passage_ids: unique(qs.map(q => q.passage_id)), invalid_choice_or_key_ids: issues,
      mismatched_part_ids: qs.filter(q => !t.parts?.includes(q.part_number)).map(q => q.question_id),
      mismatched_group_ids: unique(qs.filter(q => q.group_id != null && groups.find(g => g.group_id === q.group_id)?.part_number !== q.part_number).map(q => q.group_id)),
      nonempty_material_transcripts: graph.listening_materials.filter(m => qs.some(q => q.material_id === m.material_id) && m.transcript?.trim()).length,
      question_audio: qs.filter(q => q.audio_url).length, question_images: qs.filter(q => q.image_url).length };
  });
  const media = new Map();
  const addMedia = (url, from) => {
    if (typeof url !== 'string' || !url.trim()) return;
    if (!media.has(url)) media.set(url, { url, references: [] });
    media.get(url).references.push(from);
  };
  for (const [table, records] of Object.entries(graph)) for (const row of records) {
    for (const key of ['audio_url', 'image_url']) addMedia(row[key], `${table}:${row[keys[table]] ?? row.group_id}:${key}`);
    for (const [key, value] of Object.entries(row)) if (typeof value === 'string') {
      for (const m of value.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) addMedia(m[1], `${table}:${key}:embedded`);
    }
  }
  for (const item of media.values()) {
    let url;
    try { url = new URL(item.url, 'http://127.0.0.1:3001'); } catch { item.status = 'invalid_url'; continue; }
    item.absolute_host_override = /^https?:\/\//i.test(item.url);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.startsWith('/uploads/')) { item.status = 'external_or_non_upload_not_verified'; continue; }
    const relative = decodeURIComponent(url.pathname.slice('/uploads/'.length));
    const candidates = [path.join(root, 'toeic_be/uploads'), path.join(root, 'uploads')].map(folder => ({ folder, file: path.resolve(folder, relative) }));
    const match = candidates.find(({ folder, file }) => file.startsWith(folder + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile());
    if (!match) { item.status = 'missing_local_file'; continue; }
    item.file = path.relative(root, match.file).replaceAll('\\', '/');
    item.bytes = fs.statSync(match.file).size; item.sha256 = sha(fs.readFileSync(match.file));
    try {
      const response = await fetch('http://127.0.0.1:3001' + url.pathname, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'error' });
      item.http_status_dev = response.status; item.content_type = response.headers.get('content-type');
      item.status = response.ok && item.bytes > 0 ? 'verified_file_and_http' : 'http_or_empty_file_error';
    } catch { item.status = 'http_unreachable'; }
  }
  const ignored = ['question_content', 'answer_choices', 'question_groups', 'listening_materials', 'reading_passages', 'skills', 'vocabulary'];
  const blocking = [];
  for (const table of ignored) if (comparisons[table].conflict_ids.length || comparisons[table].missing_ids.length) blocking.push(`Review ${table}: missing or conflicting dependencies`);
  for (const table of ['question_group_passages', 'question_skills']) if (!comparisons[table].identical_set) blocking.push(`Review ${table}: relation set differs`);
  if (Object.values(history).some(n => n > 0)) blocking.push('Existing learner history references candidate questions; no reassignment without a separate review');
  if (assigned.length) blocking.push('Candidate questions are already assigned in dev');
  if (targetTests.length) blocking.push('Existing dev test name or ID collision requires explicit reconciliation');
  if (quality.some(t => t.invalid_choice_or_key_ids.length)) blocking.push('Answer-choice/key structural mismatch');
  if (quality.some(t => t.mismatched_part_ids.length || t.mismatched_group_ids.length)) blocking.push('Question/test/group Part mismatch');
  if ([...media.values()].some(m => m.status !== 'verified_file_and_http' || m.absolute_host_override)) blocking.push('Review media availability or absolute host overrides');
  if (graph.vocabulary.length) blocking.push('Vocabulary and ownership dependencies need a separate content-only policy');
  return { created_at: new Date().toISOString(), mode: 'plan_only_no_database_writes', source_database: SOURCE, target_database: TARGET,
    tests: quality, source_content_digest_sha256: digest({ tests, graph }), target_comparison_digest_sha256: digest({ targetTests, targetGraph }),
    dependencies: Object.fromEntries(Object.entries(graph).map(([table, rs]) => [table, rs.length])), comparisons,
    question_assignment_metadata_changes_requiring_approval: metadataChanges,
    target_tests_matching_name_or_id: targetTests, target_questions_already_assigned: assigned, target_history_references: history,
    transcript_nonempty: graph.listening_materials.filter(m => m.transcript?.trim()).length,
    media: [...media.values()], media_summary: { unique: media.size, verified: [...media.values()].filter(m => m.status === 'verified_file_and_http').length },
    blocking_issues: blocking, approval_required: true, database_writes: 0,
    proposed_action: 'After approval only: insert two dev tests with generated IDs, bind identical unassigned existing dev questions, reuse verified dependencies/media, preserve current source publication state, never copy users/history/events/mapping approvals.' };
}

async function main() {
  const source = new Client({ ...base, database: SOURCE, options: '-c default_transaction_read_only=on' });
  const target = new Client({ ...base, database: TARGET, options: '-c default_transaction_read_only=on' });
  try {
    await source.connect(); await target.connect();
    for (const client of [source, target]) { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); await client.query("SET LOCAL statement_timeout='15s'"); }
    const context = (await target.query(`SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
    if (context.database !== TARGET || context.marker !== 'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT' || context.read_only !== 'on') throw Error('Unexpected dev environment');
    const report = await inspect(source, target);
    const output = path.join(root, 'toeic-ai/reports/environment_alignment', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'copy_plan.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, tests: report.tests.map(({ question_ids, ...t }) => t), dependencies: report.dependencies,
      media_summary: report.media_summary, blocking_issues: report.blocking_issues, database_writes: 0 }));
  } finally {
    for (const client of [source, target]) { try { await client.query('ROLLBACK'); } finally { await client.end(); } }
  }
}
module.exports = { compareRows, inspect };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
