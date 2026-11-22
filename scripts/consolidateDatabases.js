// Explicit, backed-up consolidation into toeic_learning_system. Never trains AI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { connect, base } = require('./learningDevEnvironment');
const MAIN = 'toeic_learning_system', DEV = 'toeic_learning_events_dev';
const root = path.resolve(__dirname, '../private/ai/consolidation');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
// Match the local PostgreSQL 15 server (v17 emits transaction_timeout unsupported by v15).
const pg = name => `C:/Program Files/PostgreSQL/15/bin/${name}.exe`;
function run(name, args) {
  return execFileSync(pg(name), ['-h', base.host, '-p', String(base.port), '-U', base.user, ...args],
    { env: { ...process.env, PGPASSWORD: base.password }, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
async function snapshot(c) {
  const names = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  const tables = {};
  for (const t of names) {
    const columns = (await c.query(`SELECT column_name,udt_name,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t])).rows;
    // JSONB in PostgreSQL preserves timestamp-without-time-zone text without JS timezone conversions.
    const rows = (await c.query(`SELECT to_jsonb(t) AS row FROM ${quote(t)} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row);
    const keys = (await c.query(`SELECT a.attname FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(n,ord) ON true
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.ord`, [quote(t)])).rows.map(r => r.attname);
    tables[t] = { columns, keys, count: rows.length, sha256: digest(rows), rows };
  }
  const constraints = (await c.query(`SELECT conrelid::regclass::text AS tab,conname,contype,pg_get_constraintdef(oid) AS definition,convalidated
    FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2`)).rows;
  const triggers = (await c.query(`SELECT tgrelid::regclass::text AS tab,tgname,pg_get_triggerdef(oid) AS definition
    FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1,2`)).rows;
  const identity = (await c.query('SELECT current_database() AS database,version() AS server')).rows[0];
  return { ...identity, tables, constraints, triggers };
}
async function readSnapshot(name) {
  const c = await connect(name);
  try { await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); return await snapshot(c); }
  finally { await c.query('ROLLBACK'); await c.end(); }
}
function compact(s) {
  return Object.fromEntries(Object.entries(s.tables).map(([t, x]) => [t, { count: x.count, sha256: x.sha256, keys: x.keys }]));
}
async function backup() {
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'));
  fs.mkdirSync(dir);
  const manifest = { created_at: new Date().toISOString(), databases: {} };
  const admin = await connect('postgres');
  try {
    for (const name of [MAIN, DEV]) {
      const before = await readSnapshot(name);
      const file = path.join(dir, name + '.dump');
      run('pg_dump', ['-d', name, '--format=custom', '--file', file]);
      const toc = run('pg_restore', ['--list', file]);
      fs.writeFileSync(path.join(dir, name + '.toc'), toc);
      run('pg_restore', ['--no-owner', '--no-privileges', '--file', 'NUL', file]);
      const restored = 'toeic_verify_' + (name === MAIN ? 'main_' : 'dev_') + Date.now();
      // Fresh database only; no DROP, overwrite or restore into a live database.
      await admin.query(`CREATE DATABASE ${quote(restored)} TEMPLATE template0`);
      await admin.query(`COMMENT ON DATABASE ${quote(restored)} IS 'TOEIC consolidation backup verification; disposable isolated restored copy'`);
      run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '-d', restored, file]);
      const restoredState = await readSnapshot(restored);
      const after = await readSnapshot(name);
      const ok = JSON.stringify(compact(before)) === JSON.stringify(compact(restoredState)) &&
        JSON.stringify(compact(before)) === JSON.stringify(compact(after)) &&
        // pg_dump/restore reparses equivalent VARCHAR-array CHECK casts. All restored
        // checks must validate; FK/unique/PK definitions must match exactly.
        JSON.stringify(before.constraints.map(x => x.contype === 'c' ? { ...x, definition: null } : x)) ===
          JSON.stringify(restoredState.constraints.map(x => x.contype === 'c' ? { ...x, definition: null } : x)) &&
        JSON.stringify(before.triggers) === JSON.stringify(restoredState.triggers);
      write(path.join(dir, name + '.before.json'), before);
      write(path.join(dir, name + '.restored.json'), restoredState);
      manifest.databases[name] = { file, bytes: fs.statSync(file).size, sha256: digest(fs.readFileSync(file)),
        restored_database: restored, verified: ok, tables: compact(before), foreign_keys_validated: before.constraints.filter(x => x.contype === 'f').every(x => x.convalidated) };
      write(path.join(dir, 'manifest.json'), manifest);
      if (!ok) throw Error('Backup verification/source stability failed for ' + name);
      console.log(JSON.stringify({ database: name, backup: file, restored_database: restored, verified: ok,
        tables: Object.fromEntries(Object.entries(before.tables).map(([t, x]) => [t, x.count])) }));
    }
  } finally { await admin.end(); }
  console.log('Manifest: ' + path.join(dir, 'manifest.json'));
  return dir;
}
function makePlan(main, dev) {
  const maps = {}, additions = {}, reused = {}, special = [];
  for (const [t, d] of Object.entries(dev.tables)) {
    const m = main.tables[t];
    if (!m) continue;
    const extra = m.columns.filter(x => !d.columns.some(y => y.column_name===x.column_name));
    if (d.columns.some(x => JSON.stringify(x)!==JSON.stringify(m.columns.find(y=>y.column_name===x.column_name))) ||
        extra.some(x => t!=='questions' || !['source_set','source_question_number'].includes(x.column_name) || x.is_nullable!=='YES')) throw Error('Schema conflict: ' + t);
  }
  // This audited migration accepts only the observed content topology, not arbitrary future conflicts.
  for (const t of ['User', 'user_stats']) {
    const key = dev.tables[t].keys[0], occupied = new Set(main.tables[t].rows.map(r => r[key]));
    let next = Math.max(0, ...occupied); maps[t] = {};
    for (const r of [...dev.tables[t].rows].sort((a,b) => a[key]-b[key])) {
      if (t === 'User' && main.tables[t].rows.some(x => x.email.toLowerCase() === r.email.toLowerCase())) throw Error('Ambiguous account email; manual identity decision required');
      maps[t][r[key]] = ++next;
    }
  }
  const mapRow = (t, row) => {
    const r = structuredClone(row);
    if (t === 'User') r.user_id = maps.User[r.user_id];
    else if (Object.hasOwn(r, 'user_id')) r.user_id = maps.User[r.user_id];
    if (t === 'user_stats') r.stat_id = maps.user_stats[r.stat_id];
    return r;
  };
  for (const [t, d] of Object.entries(dev.tables)) {
    additions[t] = []; reused[t] = 0;
    const m = main.tables[t];
    for (const original of d.rows) {
      const row = mapRow(t, original), key = r => JSON.stringify(d.keys.map(k => r[k]));
      const existing = m?.rows.find(x => key(x) === key(row));
      if (existing) {
        const differences = Object.keys(row).filter(k => JSON.stringify(row[k]) !== JSON.stringify(existing[k]));
        const safeQuestion = t === 'questions' && differences.every(k => ['test_id','order_in_test'].includes(k)) && original.test_id == null;
        const safeTest = t === 'tests' && differences.every(k => k === 'created_by') && original.created_by == null;
        if (differences.length && !safeQuestion && !safeTest) throw Error('Unresolved row conflict: ' + t + ' ' + key(row));
        reused[t]++;
        if (differences.length) special.push({ table:t, key:Object.fromEntries(d.keys.map(k => [k,row[k]])), preserve_main_fields:differences });
      } else additions[t].push({ original, row });
    }
  }
  // Extra content must have an explicit graph mapping design, never just matching raw IDs.
  const allowed = new Set(['User','user_stats','user_test_attempts','attempt_questions','user_answers',
    'learning_kc_mapping_versions','learning_events','learning_answer_revisions','learning_attempt_sync','learning_answer_observations']);
  for (const [t, rows] of Object.entries(additions)) if (rows.length && !allowed.has(t)) throw Error('Unexpected missing content/dependency: ' + t);
  return { maps, additions, reused, special, totals:Object.fromEntries(Object.entries(additions).map(([t,r]) => [t,r.length])) };
}
async function insert(c, t, row) {
  const columns = Object.keys(row);
  await c.query(`INSERT INTO ${quote(t)} (${columns.map(quote).join(',')}) SELECT ${columns.map(quote).join(',')}
    FROM jsonb_populate_record(NULL::${quote(t)},$1::jsonb)`, [JSON.stringify(row)]);
}
async function merge(dir, target, live = false) {
  dir = path.resolve(dir);
  if (!dir.startsWith(root + path.sep)) throw Error('Manifest must be inside the private consolidation backup directory');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  for (const name of [MAIN,DEV]) {
    const entry = manifest.databases[name];
    if (!entry?.verified || digest(fs.readFileSync(entry.file)) !== entry.sha256) throw Error('Verified backup required');
  }
  if (live ? target !== MAIN : target !== manifest.databases[MAIN].restored_database) throw Error('Unexpected destination');
  const main = JSON.parse(fs.readFileSync(path.join(dir,MAIN+'.before.json'))), dev = JSON.parse(fs.readFileSync(path.join(dir,DEV+'.before.json')));
  const plan = makePlan(main, dev);
  const migrationId = crypto.randomUUID();
  const c = await connect(target), source = await connect(DEV);
  let committed = false;
  try {
    await source.query('BEGIN');
    const sourceTables = Object.keys(dev.tables).map(quote).join(',');
    // Blocks concurrent writes without changing the dev database contents or permissions.
    await source.query('SET LOCAL lock_timeout=\'5s\'');
    await source.query('LOCK TABLE ' + sourceTables + ' IN SHARE MODE');
    if (JSON.stringify(compact(await snapshot(source))) !== JSON.stringify(compact(dev))) throw Error('Dev changed since backup; take new backups');
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query('LOCK TABLE ' + Object.keys(main.tables).map(quote).join(',') + ' IN ACCESS EXCLUSIVE MODE');
    if (JSON.stringify(compact(await snapshot(c))) !== JSON.stringify(compact(main))) throw Error('Destination changed since backup; take new backups');
    const migration = fs.readFileSync(path.join(__dirname,'../database/migrations/20261114_learning_events.sql'),'utf8')
      .replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
    await c.query(migration);
    await c.query(`CREATE TABLE database_consolidations (
      migration_id UUID PRIMARY KEY, migrated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      origin_database TEXT NOT NULL, backup_manifest_sha256 TEXT NOT NULL);
      CREATE TABLE database_consolidation_rows (
      migration_id UUID NOT NULL REFERENCES database_consolidations(migration_id),
      origin_database TEXT NOT NULL, table_name TEXT NOT NULL, source_key JSONB NOT NULL,
      target_key JSONB NOT NULL, source_row_sha256 TEXT NOT NULL, action TEXT NOT NULL,
      PRIMARY KEY(migration_id,origin_database,table_name,source_key));
      CREATE INDEX consolidation_attempt_origin ON database_consolidation_rows(table_name,origin_database);`);
    await c.query('INSERT INTO database_consolidations(migration_id,origin_database,backup_manifest_sha256) VALUES($1,$2,$3)',
      [migrationId,DEV,digest(fs.readFileSync(path.join(dir,'manifest.json')))]);
    // Import final answers BEFORE installing the revision capture trigger. There must be
    // no fabricated migration-time revisions; copy the exact original 62 revisions instead.
    await c.query('DROP TRIGGER learning_answer_revision_capture ON user_answers');
    const order = ['User','user_stats','user_test_attempts','attempt_questions','user_answers',
      'learning_kc_mapping_versions','learning_answer_revisions','learning_attempt_sync','learning_events','learning_answer_observations'];
    for (const t of order) for (const { row } of plan.additions[t] || []) await insert(c,t,row);
    await c.query(`CREATE TRIGGER learning_answer_revision_capture AFTER INSERT OR UPDATE OF user_answer ON user_answers
      FOR EACH ROW EXECUTE FUNCTION learning_capture_answer_revision()`);
    for (const [origin, state] of [[MAIN,main],[DEV,dev]]) for (const [t, table] of Object.entries(state.tables)) {
      for (const row of table.rows) {
        const sourceKey = Object.fromEntries(table.keys.map(k => [k,row[k]]));
        const targetKey = { ...sourceKey };
        if (origin === DEV && plan.maps[t]) targetKey[table.keys[0]] = plan.maps[t][row[table.keys[0]]];
        await c.query(`INSERT INTO database_consolidation_rows VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [migrationId,origin,t,sourceKey,targetKey,digest(row),origin===MAIN?'retained':
            (plan.additions[t]||[]).some(x => table.keys.every(k => x.original[k] === row[k]))?'copied':'reused_main_content']);
      }
    }
    const after = await snapshot(c);
    for (const [t, table] of Object.entries(main.tables)) {
      const byKey = new Map(after.tables[t].rows.map(r => [JSON.stringify(table.keys.map(k => r[k])),r]));
      for (const r of table.rows) if (digest(byKey.get(JSON.stringify(table.keys.map(k => r[k])))) !== digest(r)) throw Error('Existing main row changed: ' + t);
    }
    for (const [t, table] of Object.entries(dev.tables)) {
      if (after.tables[t].count !== (main.tables[t]?.count || 0) + plan.additions[t].length) throw Error('Count mismatch: ' + t);
      for (const { row } of plan.additions[t]) {
        const copied = after.tables[t].rows.find(r => table.keys.every(k => r[k] === row[k]));
        if (digest(copied) !== digest(row)) throw Error('Copied row mismatch: ' + t);
      }
    }
    const ownership = (await c.query(`SELECT
      (SELECT count(*) FROM learning_events e JOIN user_test_attempts a USING(attempt_id) WHERE e.user_id<>a.user_id)+
      (SELECT count(*) FROM learning_answer_revisions e JOIN user_test_attempts a USING(attempt_id) WHERE e.user_id<>a.user_id)+
      (SELECT count(*) FROM learning_answer_observations e JOIN user_test_attempts a USING(attempt_id) WHERE e.user_id<>a.user_id) AS mismatches`)).rows[0];
    if (Number(ownership.mismatches)) throw Error('Learner ownership mismatch');
    if (after.constraints.some(x => x.contype==='f' && !x.convalidated)) throw Error('Unvalidated foreign key');
    // ALTER SEQUENCE RESTART is transactional, unlike setval(). Never lower an existing sequence.
    const serials = (await c.query(`SELECT table_name,column_name,pg_get_serial_sequence(format('%I.%I',table_schema,table_name),column_name) AS seq
      FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'`)).rows;
    for (const s of serials) {
      const last = (await c.query(`SELECT last_value,is_called FROM ${s.seq}`)).rows[0];
      const max = Number((await c.query(`SELECT coalesce(max(${quote(s.column_name)}),0) AS n FROM ${quote(s.table_name)}`)).rows[0].n);
      const next = Math.max(max+1, Number(last.last_value)+(last.is_called?1:0));
      if (!Number.isSafeInteger(next)) throw Error('Unsafe sequence');
      await c.query(`ALTER SEQUENCE ${s.seq} RESTART WITH ${next}`);
    }
    await c.query(`COMMENT ON DATABASE ${quote(target)} IS 'TOEIC_UNIFIED_DEVELOPMENT'`);
    await c.query('COMMIT'); committed = true;
    write(path.join(dir,live?'main.after.json':'staging.after.json'),after);
    const result = { migration_id:migrationId,target,committed,account_mapping:plan.maps.User,stats_mapping:plan.maps.user_stats,
      inserted:plan.totals,reused:plan.reused,kept_main_content:plan.special,ownership_mismatches:0,existing_main_rows_unchanged:true,
      all_imported_rows_match_source_after_explicit_id_mapping:true,all_foreign_keys_validated:true };
    write(path.join(dir,live?'migration.json':'staging.json'),result);
    console.log(JSON.stringify({ ...result, kept_main_content: result.kept_main_content.length })); return result;
  } catch(e) { if(!committed)await c.query('ROLLBACK'); throw e; }
  finally { await source.query('ROLLBACK'); await source.end(); await c.end(); }
}
module.exports = { MAIN, DEV, root, quote, digest, write, run, snapshot, readSnapshot, compact, backup, makePlan, merge };
if (require.main === module) {
  const action = process.argv[2], dir=process.argv[3];
  const work = action==='backup' ? backup() : ['stage','apply'].includes(action) ?
    merge(dir,action==='apply'?MAIN:JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))).databases[MAIN].restored_database,action==='apply') : Promise.reject(Error('Use backup, stage <directory>, or apply <directory>'));
  work.catch(e => { console.error(e.message); process.exitCode = 1; });
}
