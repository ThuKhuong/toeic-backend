// Content integration fixtures may write only to a unique schema in the marked
// local TEST database. This module never imports or connects through ../db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client, Pool } = require('pg');

async function isolatedContentTest(label) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  assert.match(label, /^[a-z][a-z0-9_]{0,20}$/);
  const database = 'toeic_learning_events_test';
  assert.notEqual(database, process.env.DB_NAME, 'Refusing configured application database');
  const host = process.env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Local isolated TEST database required');
  const marker = 'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT';
  const base = { host, port: process.env.DB_PORT || 5432, user: process.env.DB_USER || 'postgres', password: process.env.DB_PASS || '', database };
  const schema = `content_${label}_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client(base);
  const pool = new Pool({ ...base, max: 1, options: `-c search_path=${schema} -c timezone=Asia/Ho_Chi_Minh` });
  const dbPath = require.resolve('../../db');
  const previousDb = require.cache[dbPath];
  const originalConnect = pool.connect, originalQuery = pool.query;
  let created = false, connected = false, client, outerOpen = false, cached = false;
  const nested = [];
  let nextSavepoint = 0;

  async function cleanup() {
    pool.connect = originalConnect; pool.query = originalQuery;
    try {
      if (client) {
        try { if (outerOpen) await client.query('ROLLBACK'); }
        finally { outerOpen = false; client.release(); client = null; }
      }
    } finally {
      try { await pool.end(); }
      finally {
        if (cached) {
          if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
          cached = false;
        }
        try {
          if (created) {
            assert.match(schema, /^content_[a-z][a-z0-9_]{0,20}_[a-f0-9]{32}$/);
            const context = (await admin.query(`SELECT current_database() AS database,
              shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
            assert.equal(context.database, database); assert.equal(context.marker, marker);
            await admin.query(`DROP SCHEMA "${schema}" CASCADE`); created = false;
          }
        } finally { if (connected) { connected = false; await admin.end(); } }
      }
    }
  }

  try {
    await admin.connect(); connected = true;
    const context = (await admin.query(`SELECT current_database() AS database,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
    assert.equal(context.database, database); assert.equal(context.marker, marker, 'Marked isolated TEST database required before any write');
    assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    for (const file of ['database/toeic_learning_system.sql', 'database/migrations/20261026_question_source.sql',
      'database/migrations/20261027_source_question_number.sql']) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
      assert.equal(/SET\s+search_path|CREATE\s+DATABASE|public\./i.test(sql), false, 'Fixture DDL must stay inside its own schema');
      await pool.query(sql);
    }
    client = await pool.connect();
    await client.query('BEGIN'); outerOpen = true;
    const fixtureClient = { async query(sql, args) {
      const command = typeof sql === 'string' ? sql.trim().replace(/;$/, '') : '';
      if (/^BEGIN(?:\s|$)/i.test(command)) {
        const name = `fixture_${++nextSavepoint}`; nested.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (/^COMMIT$/i.test(command)) {
        assert.ok(nested.length, 'Cannot commit the outer fixture transaction');
        return client.query(`RELEASE SAVEPOINT ${nested.pop()}`);
      }
      if (/^ROLLBACK$/i.test(command)) {
        assert.ok(nested.length, 'Cannot rollback the outer transaction from an application module');
        const name = nested.pop();
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      return client.query(sql, args);
    }, release() {} };
    pool.connect = async () => fixtureClient;
    pool.query = (sql, args) => fixtureClient.query(sql, args);
    // Cache BEFORE any application module imports; default-main db.js is never evaluated.
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool }; cached = true;
    process.env.LEARNING_EVENTS_ENABLED = '0'; process.env.AI_QUESTION_SHADOW_ENABLED = '0';
    return { pool, client, schema, database, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
module.exports = { isolatedContentTest };
