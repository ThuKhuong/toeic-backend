const { Pool } = require('pg');
require('dotenv').config();
if (process.env.LEARNING_EVENTS_ENABLED === '1' && !process.env.LEARNING_VERSION_SECRET && process.env.LEARNING_VERSION_SECRET_FILE) {
  const path = require('node:path');
  process.env.LEARNING_VERSION_SECRET = require('node:fs').readFileSync(path.resolve(__dirname, process.env.LEARNING_VERSION_SECRET_FILE), 'utf8').trim();
  if (process.env.LEARNING_VERSION_SECRET.length < 32) throw Error('Invalid learning version secret file');
}

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'toeic',
  password: process.env.DB_PASS || '',
  port: process.env.DB_PORT || 5432,
});

pool.query('SELECT 1')
  .then(() => console.log("Connected to PostgreSQL"))
  .catch(err => console.error("Database connection error:", err));

module.exports = pool;
