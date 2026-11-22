// Isolated development launcher. No .env edits and no automatic migration.
const {randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const dev=require('./learningDevEnvironment');
(async()=>{
  const canonical = await dev.connect('toeic_learning_system');
  try {
    const state = (await canonical.query(`SELECT to_regclass('public.database_consolidations') IS NOT NULL AS unified`)).rows[0];
    if (state.unified) throw Error('Project already consolidated. Use npm start: API 3000 / toeic_learning_system. The old dev database is retained for comparison only.');
  } finally { await canonical.end(); }
  const c=await dev.connect('toeic_learning_events_dev');
  try {
    const state=(await c.query(`SELECT current_database() AS db,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker,
      to_regclass('public.learning_events') AS events`)).rows[0];
    if(state.marker!=='TOEIC_LEARNING_EVENTS_ISOLATED_DEVELOPMENT'||!state.events)throw Error('Prepare the isolated dev database with the guarded migration runner first');
  }finally{await c.end();}
  process.env.DB_NAME='toeic_learning_events_dev';
  process.env.NODE_ENV='development';
  process.env.PORT=process.env.LEARNING_DEV_PORT||'3001';
  process.env.LEARNING_EVENTS_ENABLED='1';
  process.env.AI_SERVICE_URL='http://127.0.0.1:8000';
  process.env.LEARNING_DATA_ENV='isolated_development';
  const keyDir=path.join(__dirname,'../private/learning-dev');
  fs.mkdirSync(keyDir,{recursive:true});
  const keyFile=path.join(keyDir,'version.key');
  if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
  process.env.LEARNING_VERSION_SECRET=fs.readFileSync(keyFile,'utf8').trim();
  process.env.JWT_SECRET=process.env.LEARNING_DEV_JWT_SECRET||randomBytes(32).toString('hex');
  console.log(`Isolated learning development: database toeic_learning_events_dev, API port ${process.env.PORT}; no production migration/configuration`);
  require('./startWithAI').run();
})().catch(error=>{console.error(error.message);process.exitCode=1;});
