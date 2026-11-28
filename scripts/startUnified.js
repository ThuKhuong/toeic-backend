// One runtime: existing models + API 3000 + the verified canonical database.
const path = require('node:path');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const { connect } = require('./learningDevEnvironment');
(async()=>{
  if (process.env.DB_NAME !== 'toeic_learning_system' || String(process.env.PORT || '3000') !== '3000') throw Error('Unified runtime requires toeic_learning_system on API 3000');
  const c = await connect('toeic_learning_system');
  try {
    const row = (await c.query(`SELECT to_regclass('public.learning_events') IS NOT NULL AS events,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`)).rows[0];
    if (!row.events || row.marker !== 'TOEIC_UNIFIED_DEVELOPMENT') throw Error('Canonical database migration has not been verified');
  } finally { await c.end(); }
  if (process.env.LEARNING_EVENTS_ENABLED !== '1' || process.env.LEARNING_DATA_ENV !== 'unified_development') throw Error('Learning Events configuration missing');
  process.env.PORT='3000';
  process.env.AI_SERVICE_URL=process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
  require('./startWithAI').run();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
