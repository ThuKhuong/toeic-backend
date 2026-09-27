// d:\hoctaphk1nam4\DOANCHUYENNGANH\TOEIC\toeic_be\src\modules\users\usersModel.js
const pool = require("../../../db");

function buildListQuery({ q, role, active, limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (q) {
    where.push(`(LOWER(email) LIKE $${i} OR LOWER(full_name) LIKE $${i})`);
    params.push(`%${String(q).toLowerCase()}%`);
    i++;
  }
  if (role) {
    where.push(`role = $${i}`);
    params.push(role);
    i++;
  }
  if (active !== undefined) {
    where.push(`is_active = $${i}`);
    params.push(active === "true" || active === true);
    i++;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT user_id, email, full_name, avatar_url, role,
           is_active, created_at, updated_at
    FROM "User"
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;
  params.push(Number(limit), Number(offset));
  return { sql, params };
}

async function list(params) {
  const { sql, params: bindParams } = buildListQuery(params || {});
  const r = await pool.query(sql, bindParams);
  return r.rows;
}

async function getById(id) {
  const r = await pool.query(
    `SELECT user_id, email, full_name, avatar_url, role,
            is_active, created_at, updated_at
     FROM "User" WHERE user_id=$1`,
    [id]
  );
  return r.rows[0] || null;
}

async function update(id, data) {
  const allowed = [
    "full_name",
    "avatar_url",
    "role",
    "is_active",
  ];
  const keys = allowed.filter((k) => data[k] !== undefined);
  if (!keys.length) return getById(id);
  const sets = keys.map((k, idx) => `${k}=$${idx + 1}`);
  const params = keys.map((k) => data[k]);
  params.push(id);
  const r = await pool.query(
    `UPDATE "User" SET ${sets.join(", ")}, updated_at=CURRENT_TIMESTAMP
     WHERE user_id=$${params.length}
     RETURNING user_id, email, full_name, avatar_url, role,
               is_active, created_at, updated_at`,
    params
  );
  return r.rows[0];
}

async function setActive(id, active) {
  const r = await pool.query(
    `UPDATE "User" SET is_active=$1, updated_at=CURRENT_TIMESTAMP
     WHERE user_id=$2
     RETURNING user_id, email, full_name, avatar_url, role,
               is_active, created_at, updated_at`,
    [!!active, id]
  );
  return r.rows[0];
}

async function deleteUser(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Set created_by to NULL for tests created by this user
    await client.query(
      `UPDATE tests SET created_by = NULL WHERE created_by = $1`,
      [id]
    );

    // Delete the user (CASCADE will handle related records)
    const r = await client.query(
      `DELETE FROM "User" WHERE user_id=$1 RETURNING user_id, email, full_name`,
      [id]
    );

    await client.query("COMMIT");
    return r.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { list, getById, update, setActive, deleteUser };
