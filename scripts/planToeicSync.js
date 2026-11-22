// Inventory/proposal only. No INSERT/UPDATE/DELETE/DDL, restore, inference or submission.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { base } = require('./learningDevEnvironment');
const { compareRows } = require('./planDevTestCopy');
const root = path.resolve(__dirname, '../..');
const SOURCE = 'toeic_learning_system', TARGET = 'toeic_learning_events_dev';
const assignments = ['test_id', 'order_in_test', 'source_set', 'source_question_number'];
const tables = { tests: ['test_id'], questions: ['question_id'], answer_choices: ['choice_id'],
  question_groups: ['group_id'], listening_materials: ['material_id'], reading_passages: ['passage_id'],
  question_group_passages: ['group_id', 'position', 'passage_id'], question_skills: ['question_id', 'skill_id'], skills: ['skill_id'] };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex');
const omit = (r, ks) => Object.fromEntries(Object.entries(r).filter(([k]) => !ks.includes(k)));
const unique = xs => [...new Set(xs.filter(x => x != null))].sort((a, b) => a - b);
const orderedQuestions = (data, id) => data.questions.filter(q => q.test_id === id).sort((a, b) => a.order_in_test - b.order_in_test || a.question_id - b.question_id);
const name = value => String(value || '').trim().normalize('NFKC').toLowerCase();
const toeicTests = data => data.tests.filter(t => t.deleted_at == null &&
  ((t.parts || []).some(p => p >= 1 && p <= 7) || data.questions.some(q => q.test_id === t.test_id && q.part_number >= 1 && q.part_number <= 7)));

async function load(client) {
  const out = {};
  for (const [table, keys] of Object.entries(tables)) out[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY ${keys.map(k => '"' + k + '"').join(',')}`)).rows.map(r => r.row);
  return out;
}

function graphFor(data, qs) {
  const ids = unique(qs.map(q => q.question_id)), gids = unique(qs.map(q => q.group_id));
  const groups = data.question_groups.filter(g => gids.includes(g.group_id));
  const gp = data.question_group_passages.filter(r => gids.includes(r.group_id));
  const mids = unique([...qs.map(q => q.material_id), ...groups.map(g => g.material_id)]);
  const pids = unique([...qs.map(q => q.passage_id), ...gp.map(r => r.passage_id)]);
  const skills = data.question_skills.filter(r => ids.includes(r.question_id));
  return { questions: qs, answer_choices: data.answer_choices.filter(c => ids.includes(c.question_id)), question_groups: groups,
    listening_materials: data.listening_materials.filter(m => mids.includes(m.material_id)),
    reading_passages: data.reading_passages.filter(p => pids.includes(p.passage_id)), question_group_passages: gp,
    question_skills: skills, skills: data.skills.filter(s => skills.some(r => r.skill_id === s.skill_id)) };
}

function matchTest(sourceTest, source, target) {
  // A matching number alone is not proof of identity; normalized names + Part set prevent duplicate creation.
  const matches = toeicTests(target).filter(t => name(t.test_name) === name(sourceTest.test_name) &&
    hash([...(t.parts || [])].sort()) === hash([...(sourceTest.parts || [])].sort()));
  if (matches.length > 1) return { status: 'ambiguous_existing_tests', target_ids: matches.map(t => t.test_id) };
  if (!matches.length) return { status: 'missing_test', source_id_collision: target.tests.some(t => t.test_id === sourceTest.test_id) };
  const existing = matches[0];
  const metadata = r => omit(r, ['test_id', 'created_by', 'created_at', 'updated_at']);
  const sg = graphFor(source, orderedQuestions(source, sourceTest.test_id));
  const tg = graphFor(target, orderedQuestions(target, existing.test_id));
  const normalized = (g, ignoreProvenance = false) => ({ ...g, questions: g.questions.map(q => omit(q, ['test_id', ...(ignoreProvenance ? ['source_set', 'source_question_number'] : [])])) });
  const metadataEqual = hash(metadata(sourceTest)) === hash(metadata(existing));
  const graphEqual = hash(normalized(sg)) === hash(normalized(tg));
  const contentOrderEqual = hash(normalized(sg, true)) === hash(normalized(tg, true));
  return { status: metadataEqual && graphEqual ? 'present_identical' : metadataEqual && contentOrderEqual ? 'present_content_equal_keep_dev_metadata' : 'present_requires_review',
    target_ids: [existing.test_id], metadata_equal: hash(metadata(sourceTest)) === hash(metadata(existing)),
    question_dependency_graph_equal: graphEqual, content_choices_media_and_order_equal: contentOrderEqual,
    provenance_differences_to_preserve: contentOrderEqual && !graphEqual ? sg.questions.map(q => {
      const old = tg.questions.find(r => r.question_id === q.question_id);
      return { question_id: q.question_id, changes: Object.fromEntries(['source_set', 'source_question_number'].filter(k => hash([q[k]]) !== hash([old?.[k]])).map(k => [k, { source: q[k], dev: old?.[k] }])) };
    }).filter(q => Object.keys(q.changes).length) : [] };
}

function qualityFor(test, data) {
  const qs = orderedQuestions(data, test.test_id), graph = graphFor(data, qs), issues = [];
  const qError = (q, code) => issues.push({ question_id: q.question_id, code });
  for (const q of qs) {
    if (!test.parts?.includes(q.part_number)) qError(q, 'test_part_mismatch');
    const labels = q.part_number === 2 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
    const choices = graph.answer_choices.filter(c => c.question_id === q.question_id);
    if (choices.length !== labels.length || labels.some(l => choices.filter(c => c.choice_label === l).length !== 1) ||
      choices.filter(c => c.is_correct).length !== 1 || !choices.some(c => c.is_correct && c.choice_label === q.correct_answer)) qError(q, 'invalid_choices_or_key');
    const group = graph.question_groups.find(g => g.group_id === q.group_id);
    if (q.group_id != null && (!group || group.part_number !== q.part_number)) qError(q, 'invalid_group');
    if (q.material_id != null && !graph.listening_materials.some(m => m.material_id === q.material_id)) qError(q, 'missing_material');
    if (q.vocab_id != null) qError(q, 'vocabulary_dependency_needs_separate_policy');
    const material = graph.listening_materials.find(m => m.material_id === (q.material_id ?? group?.material_id));
    if (q.part_number <= 4 && !(q.audio_url || material?.audio_url)) qError(q, 'missing_audio');
    const linked = graph.question_group_passages.filter(p => p.group_id === q.group_id).map(p => p.passage_id);
    if (q.part_number >= 6 && !graph.reading_passages.some(p => [q.passage_id, ...linked].includes(p.passage_id) && (p.content?.trim() || p.image_url))) qError(q, 'missing_reading_content');
    if (linked.length && q.passage_id != null && !linked.includes(q.passage_id)) qError(q, 'direct_passage_not_in_group');
  }
  if (test.total_questions !== qs.length) issues.push({ code: 'declared_question_count_mismatch' });
  if (new Set(qs.map(q => q.order_in_test)).size !== qs.length || qs.some(q => !Number.isInteger(q.order_in_test) || q.order_in_test < 1)) issues.push({ code: 'invalid_or_duplicate_question_order' });
  const bundles = graph.question_groups.map(g => ({ group_id: g.group_id, part: g.part_number,
    questions: qs.filter(q => q.group_id === g.group_id).length,
    passages: graph.question_group_passages.filter(p => p.group_id === g.group_id).sort((a, b) => a.position - b.position).map(p => ({ passage_id: p.passage_id, position: p.position })) }));
  for (const b of bundles) {
    if ([3, 4].includes(b.part) && b.questions !== 3 || b.part === 6 && b.questions !== 4) issues.push({ group_id: b.group_id, code: 'incomplete_bundle' });
    if (b.passages.length && (new Set(b.passages.map(p => p.position)).size !== b.passages.length || b.passages.some(p => !Number.isInteger(p.position) || p.position < 1))) issues.push({ group_id: b.group_id, code: 'invalid_passage_order' });
  }
  return { questions: qs.length, choices: graph.answer_choices.length, question_ids_in_order: qs.map(q => q.question_id),
    order_in_test: qs.map(q => q.order_in_test), source_question_numbers: qs.map(q => q.source_question_number),
    groups: graph.question_groups.length, audio_materials: graph.listening_materials.length,
    nonempty_transcripts: graph.listening_materials.filter(m => m.transcript?.trim()).length,
    empty_transcripts: graph.listening_materials.filter(m => !m.transcript?.trim()).map(m => m.material_id),
    question_image_references: qs.filter(q => q.image_url).length, passage_images: graph.reading_passages.filter(p => p.image_url).length,
    reading_passages: graph.reading_passages.length, group_passage_links: graph.question_group_passages.length, bundles, issues };
}

async function collectMedia(data) {
  const collected = new Map();
  function add(url, ref) {
    if (typeof url !== 'string' || !url.trim()) return;
    if (!collected.has(url)) collected.set(url, { url, references: [] });
    collected.get(url).references.push(ref);
  }
  for (const [table, records] of Object.entries(data)) for (const row of records) {
    const id = row[tables[table]?.[0]] ?? null;
    for (const key of ['audio_url', 'image_url']) add(row[key], { table, id, field: key });
    for (const [field, value] of Object.entries(row)) if (typeof value === 'string') {
      for (const m of value.matchAll(/(?:src)\s*=\s*["']([^"']+)["']/gi)) add(m[1], { table, id, field, embedded: true });
    }
  }
  for (const item of collected.values()) {
    if (/^data:image\//.test(item.url)) { item.status = 'inline_image'; item.sha256 = hash(item.url); continue; }
    let url;
    try { url = new URL(item.url, 'http://127.0.0.1:3001'); } catch { item.status = 'invalid_url'; continue; }
    item.absolute_host_override = /^https?:\/\//i.test(item.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/uploads/')) { item.status = 'external_or_non_upload_unverified'; continue; }
    const relative = decodeURIComponent(url.pathname.slice('/uploads/'.length));
    const match = [path.join(root, 'toeic_be/uploads'), path.join(root, 'uploads')].map(folder => ({ folder, file: path.resolve(folder, relative) }))
      .find(({ folder, file }) => file.startsWith(folder + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() &&
        fs.realpathSync(file).toLowerCase().startsWith((fs.realpathSync(folder) + path.sep).toLowerCase()));
    if (!match) { item.status = 'missing_file'; continue; }
    item.file = path.relative(root, match.file).replaceAll('\\', '/'); item.bytes = fs.statSync(match.file).size;
    item.sha256 = hash(fs.readFileSync(match.file));
    try {
      const response = await fetch('http://127.0.0.1:3001' + url.pathname, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'error' });
      item.http_status = response.status; item.content_type = response.headers.get('content-type');
      item.status = response.ok && item.bytes > 0 ? 'verified_file_http' : 'http_or_empty_file_error';
      if (response.ok && (item.content_type?.startsWith('audio/') || /\.(mp3|m4a|wav|ogg)$/i.test(url.pathname))) {
        const range = await fetch('http://127.0.0.1:3001' + url.pathname, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
        item.range_http_status = range.status; item.content_range = range.headers.get('content-range');
        if (range.status === 206) item.range_bytes = (await range.arrayBuffer()).byteLength;
        else await range.body?.cancel();
      }
    } catch { item.status = 'http_unreachable'; }
  }
  return [...collected.values()];
}

async function databaseFingerprint(client) {
  const result = {};
  for (const { tablename } of (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    result[tablename] = (await client.query(`SELECT count(*)::int AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${quoted} t`)).rows[0];
  }
  return result;
}

async function snapshot(database) {
  const c = new Client({ ...base, database, connectionTimeoutMillis: 5000, options: '-c default_transaction_read_only=on' });
  await c.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); await c.query("SET LOCAL statement_timeout='20s'");
    const context = (await c.query(`SELECT current_database() AS database,now() AS captured_at,current_setting('transaction_read_only') AS read_only,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
    if (context.database !== database || context.read_only !== 'on' || database === TARGET && context.marker !== 'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT') throw Error('Unexpected database/read-only/marker');
    return { context, data: await load(c), fingerprint: await databaseFingerprint(c) };
  } finally { await c.query('ROLLBACK'); await c.end(); }
}

async function inspect(source, target, backup) {
  const tests = toeicTests(source.data), targetTests = toeicTests(target.data);
  const testRows = tests.map(t => ({ source_id: t.test_id, test_name: t.test_name, parts: t.parts, publication_status: t.publication_status,
    is_active: t.is_active, match: matchTest(t, source.data, target.data), quality: qualityFor(t, source.data) }));
  const missing = testRows.filter(t => t.match.status === 'missing_test');
  const missingIds = missing.map(t => t.source_id), qs = source.data.questions.filter(q => missingIds.includes(q.test_id));
  const graph = graphFor(source.data, qs), comparisons = {};
  for (const [table, records] of Object.entries(graph)) {
    if (table === 'question_group_passages' || table === 'question_skills') {
      const key = table === 'question_group_passages' ? 'group_id' : 'question_id', ids = unique(records.map(r => r[key]));
      const existing = target.data[table].filter(r => ids.includes(r[key]));
      comparisons[table] = { source_rows: records.length, matching_target_set: hash(records) === hash(existing), target_rows: existing.length };
    } else comparisons[table] = compareRows(records, target.data[table], tables[table][0], table === 'questions' ? assignments : []);
  }
  const metadata = qs.map(q => { const old = target.data.questions.find(t => t.question_id === q.question_id); return { question_id: q.question_id,
    source_test_id: q.test_id, changes: old ? Object.fromEntries(assignments.filter(k => hash([q[k]]) !== hash([old[k]])).map(k => [k, { source: q[k], current_dev: old[k] }])) : null,
    already_assigned_dev_test: old?.test_id ?? null }; });
  const blockers = [];
  for (const [table, result] of Object.entries(comparisons)) {
    if (result.conflict_ids?.length) blockers.push({ table, code: 'same_id_different_content', ids: result.conflict_ids });
    // Safe proposal refuses new inserts until missing IDs have an independent content-duplicate review.
    if (result.missing_ids?.length) blockers.push({ table, code: 'missing_ids_require_content_deduplication_and_id_mapping_review', ids: result.missing_ids });
    if (result.matching_target_set === false) blockers.push({ table, code: 'relation_set_differs' });
  }
  if (metadata.some(m => m.already_assigned_dev_test != null)) blockers.push({ code: 'candidate_questions_already_assigned' });
  for (const t of testRows) if (t.match.status.includes('review') || t.match.status.startsWith('ambiguous')) blockers.push({ source_test_id: t.source_id, code: t.match.status });
  for (const t of missing) if (t.quality.issues.length) blockers.push({ source_test_id: t.source_id, code: 'structural_quality_issues', issues: t.quality.issues });
  const allGraph = graphFor(source.data, source.data.questions.filter(q => tests.some(t => t.test_id === q.test_id)));
  const media = await collectMedia(allGraph);
  for (const t of testRows) {
    const g = graphFor(source.data, source.data.questions.filter(q => q.test_id === t.source_id));
    const ownMedia = media.filter(m => m.references.some(r => g[r.table]?.some(row => row[tables[r.table][0]] === r.id)));
    t.quality.media = { unique_files: ownMedia.length, audio: ownMedia.filter(m => m.content_type?.startsWith('audio/')).length,
      images: ownMedia.filter(m => m.content_type?.startsWith('image/')).length,
      verified: ownMedia.filter(m => m.status === 'verified_file_http').length };
  }
  if (media.some(m => !['verified_file_http', 'inline_image'].includes(m.status) || m.absolute_host_override)) blockers.push({ code: 'media_needs_review' });
  const candidateMedia = new Set((await collectMedia(graph)).map(m => m.url));
  const c = new Client({ ...base, database: TARGET, options: '-c default_transaction_read_only=on' });
  await c.connect(); let history;
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    history = {};
    for (const table of ['attempt_questions', 'user_answers', 'learning_events', 'learning_answer_observations', 'learning_answer_revisions']) history[table] =
      (await c.query(`SELECT count(*)::int AS count FROM "${table}" WHERE question_id=ANY($1::int[])`, [qs.map(q => q.question_id)])).rows[0].count;
  } finally { await c.query('ROLLBACK'); await c.end(); }
  if (Object.values(history).some(n => n > 0)) blockers.push({ code: 'candidate_questions_have_learner_history' });
  const models = {};
  for (const file of ['toeic-ai/models/v2/lightgbm_v2.joblib', 'toeic-ai/models/v3_app_shadow/model.joblib']) models[file] = hash(fs.readFileSync(path.join(root, file)));
  const perPart = Array.from({ length: 7 }, (_, i) => { const part = i + 1, rows = testRows.filter(t => t.parts?.includes(part));
    const tm = rows.filter(t => t.match.status === 'missing_test');
    return { part, source_tests: rows.length, dev_tests: targetTests.filter(t => t.parts?.includes(part)).length,
      missing_tests: tm.length, questions_in_source_tests: rows.reduce((n, t) => n + t.quality.questions, 0),
      questions_in_missing_tests: tm.reduce((n, t) => n + t.quality.questions, 0),
      existing_candidate_questions: qs.filter(q => q.part_number === part && comparisons.questions.identical_ids.includes(q.question_id)).length,
      new_question_rows_required: qs.filter(q => q.part_number === part && comparisons.questions.missing_ids.includes(q.question_id)).length };
  });
  return { created_at: new Date().toISOString(), mode: 'inventory_and_plan_only', database_writes: 0, approval_required: true,
    source: source.context, target: target.context, backup,
    scope: 'All non-deleted TOEIC tests, including drafts/unpublished. Soft-deleted tests and unassigned bank questions are inventoried but not selected for migration.',
    totals: { source_tests: tests.length, dev_tests: targetTests.length, missing_tests: missing.length, questions_in_missing_tests: qs.length,
      existing_reusable_question_rows: comparisons.questions.identical_ids.length, new_question_rows_required: comparisons.questions.missing_ids.length,
      source_bank_questions: source.data.questions.length, dev_bank_questions: target.data.questions.length,
      source_unassigned_questions_excluded: source.data.questions.filter(q => q.test_id == null).length,
      source_soft_deleted_tests_excluded: source.data.tests.filter(t => t.deleted_at != null).map(t => t.test_id) },
    per_part: perPart, tests: testRows,
    missing_graph: { counts: Object.fromEntries(Object.entries(graph).map(([table, rows]) => [table, rows.length])), comparisons,
      source_graph_sha256: hash({ tests: source.data.tests.filter(t => missingIds.includes(t.test_id)), graph }),
      target_content_sha256: hash(target.data), question_assignment_changes_requiring_approval: metadata, candidate_history_references: history },
    media, media_summary: { all_tests_unique_files: media.length, missing_tests_unique_files: media.filter(m => candidateMedia.has(m.url)).length,
      verified: media.filter(m => m.status === 'verified_file_http').length, audio: media.filter(m => m.content_type?.startsWith('audio/')).length,
      images: media.filter(m => m.content_type?.startsWith('image/')).length, audio_range_206: media.filter(m => m.range_http_status === 206).length },
    batches: missing.sort((a, b) => (a.parts[0] - b.parts[0])).map((t, i) => ({ batch: i + 1, source_test_id: t.source_id, test_name: t.test_name,
      part: t.parts[0], insert_test_rows: 1, reuse_and_assign_question_rows: t.quality.questions, insert_question_rows: 0,
      publication_status: t.publication_status, is_active: t.is_active, transaction: 'one transaction per test; rollback entire current batch on error; previously committed batches remain' })),
    blockers, model_sha256: models,
    limitations: ['Structural/key consistency is not semantic answer-key verification.', 'HTTP/file/range checks do not establish playback on a physical device.',
      'No attempts/submissions were created; post-sync submission testing needs real learner actions.', 'No source users, learner history, events, mappings or model artifacts are selected for copy.'] };
}

function markdown(report) {
  return '# TOEIC synchronization inventory — approval pending\n\n' +
    `Source: ${SOURCE}; target: ${TARGET}. Database writes: 0.\n\n` +
    '| Part | Source tests | Dev tests | Missing tests | Questions to assign | New question rows |\n|---|---:|---:|---:|---:|---:|\n' +
    report.per_part.map(p => `| ${p.part} | ${p.source_tests} | ${p.dev_tests} | ${p.missing_tests} | ${p.questions_in_missing_tests} | ${p.new_question_rows_required} |`).join('\n') +
    '\n\nDo not execute database writes until the user approves the detailed plan. See inventory.json for IDs, deltas, graphs, media, backup and blockers.\n';
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--backup-manifest') throw Error('Usage: node scripts/planToeicSync.js --backup-manifest <existing backup_manifest.json>; no apply mode exists');
  const privateBackup = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
  const backupFile = path.resolve(root, privateBackup.backup_path);
  const backupRoot = path.join(root, 'toeic_be/private/ai/toeic-sync') + path.sep;
  if (!backupFile.startsWith(backupRoot) || privateBackup.context?.database !== TARGET || !privateBackup.archive_list_verified || !privateBackup.full_archive_decompression_verified ||
      hash(fs.readFileSync(backupFile)) !== privateBackup.sha256) throw Error('Verified dev backup required');
  const source = await snapshot(SOURCE), target = await snapshot(TARGET);
  const report = await inspect(source, target, { ...privateBackup, restore_executed: false });
  const sourceAfter = await snapshot(SOURCE), targetAfter = await snapshot(TARGET);
  const unchanged = { source: hash(source.fingerprint) === hash(sourceAfter.fingerprint), dev: hash(target.fingerprint) === hash(targetAfter.fingerprint),
    models: Object.entries(report.model_sha256).every(([file, digest]) => hash(fs.readFileSync(path.join(root, file))) === digest),
    media: report.media.filter(m => m.file).every(m => hash(fs.readFileSync(path.join(root, m.file))) === m.sha256) };
  const output = path.join(root, 'toeic-ai/reports/toeic_sync_inventory', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'SUMMARY.md'), markdown(report), { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'preservation.json'), JSON.stringify({ checked_at: new Date().toISOString(), unchanged,
    before: { source: source.fingerprint, dev: target.fingerprint }, after: { source: sourceAfter.fingerprint, dev: targetAfter.fingerprint },
    model_sha256: report.model_sha256, database_writes: 0 }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, totals: report.totals, missing_graph_counts: report.missing_graph.counts, media: report.media_summary, blockers: report.blockers, unchanged }));
  if (!Object.values(unchanged).every(Boolean)) process.exitCode = 1;
}
module.exports = { graphFor, matchTest, qualityFor, inspect, markdown };
if (require.main === module) main().catch(e => { console.error(e.message.split('\n')[0]); process.exitCode = 1; });
