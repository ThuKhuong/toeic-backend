// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\auth\authModel.js
const pool = require("../../../db");

async function getUserByEmail(email) {
  const r = await pool.query(
    `SELECT user_id, email, password_hash, full_name, avatar_url, role, is_active
     FROM "User" WHERE email = $1 LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

async function createUser({ email, password_hash, full_name, role }) {
  const r = await pool.query(
    `WITH new_user AS (
     INSERT INTO "User"(email, password_hash, full_name, role)
     VALUES ($1,$2,$3,COALESCE($4,'STUDENT'))
     RETURNING user_id, email, full_name, role, is_active
     ), new_stats AS (
       INSERT INTO user_stats(user_id) SELECT user_id FROM new_user
     ) SELECT * FROM new_user`,
    [email, password_hash, full_name || null, role || null]
  );
  const u = r.rows[0];
  return u;
}

module.exports = { getUserByEmail, createUser };
