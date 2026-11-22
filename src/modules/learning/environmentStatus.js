// Connection identity only: no learner records, inference, migrations or writes.
async function environmentStatus(pool, env = process.env) {
  const { rows } = await pool.query(`SELECT current_database() AS database,
    to_regclass('public.learning_events') IS NOT NULL AS events,
    to_regclass('public.learning_answer_revisions') IS NOT NULL AS revisions,
    to_regclass('public.learning_answer_observations') IS NOT NULL AS observations,
    to_regclass('public.learning_attempt_sync') IS NOT NULL AS progress_sync,
    shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`);
  const state = rows[0];
  const enabled = env.LEARNING_EVENTS_ENABLED === '1';
  const isolated = state.database === 'toeic_learning_events_dev' &&
    state.marker === 'TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT';
  const unified = state.database === 'toeic_learning_system' &&
    state.marker === 'TOEIC_UNIFIED_DEVELOPMENT' && env.LEARNING_DATA_ENV === 'unified_development';
  return { enabled, environment: env.LEARNING_DATA_ENV || 'not_configured',
    database: state.database, contract_version: 'learning_events_v1',
    storage_ready: !!(state.events && state.revisions && state.observations && state.progress_sync),
    pilot_ready: !!(enabled && (isolated || unified) && state.events && state.revisions && state.observations && state.progress_sync),
    checked_at: new Date().toISOString() };
}
module.exports = { environmentStatus };
