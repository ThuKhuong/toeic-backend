// src/modules/admin/admin.model.js
const pool = require("../../../db");

exports.countStudents = () =>
  pool.query(
    `SELECT COUNT(*) as count FROM "User" WHERE role = $1 AND is_active = true`,
    ["STUDENT"]
  );

exports.countVocabulary = () =>
  pool.query(`SELECT COUNT(*) as count FROM vocabulary`);

exports.countTests = () =>
  pool.query(`SELECT COUNT(*) as count FROM tests WHERE is_active = true`);

exports.countQuestions = () =>
  pool.query(`SELECT COUNT(*) as count FROM questions`);


exports.getRecentActivity = () =>
  pool.query(`
    SELECT 
      'Hoàn thành bài test' as action,
      u.full_name as user,
      CASE 
        WHEN EXTRACT(EPOCH FROM (NOW() - uta.end_time)) < 60 THEN 
          ROUND(EXTRACT(EPOCH FROM (NOW() - uta.end_time))) || ' giây trước'
        WHEN EXTRACT(EPOCH FROM (NOW() - uta.end_time)) < 3600 THEN 
          ROUND(EXTRACT(EPOCH FROM (NOW() - uta.end_time)) / 60) || ' phút trước'
        WHEN EXTRACT(EPOCH FROM (NOW() - uta.end_time)) < 86400 THEN 
          ROUND(EXTRACT(EPOCH FROM (NOW() - uta.end_time)) / 3600) || ' giờ trước'
        ELSE 
          ROUND(EXTRACT(EPOCH FROM (NOW() - uta.end_time)) / 86400) || ' ngày trước'
      END as time,
      uta.end_time 
    FROM user_test_attempts uta
    JOIN "User" u ON uta.user_id = u.user_id
    WHERE uta.is_completed = true AND uta.end_time IS NOT NULL
    ORDER BY uta.end_time DESC
    LIMIT 3
  `);

exports.getQuickStats = () =>
  pool.query(`
    SELECT 
      (SELECT COUNT(DISTINCT user_id) FROM user_test_attempts WHERE DATE(start_time)=CURRENT_DATE OR DATE(end_time)=CURRENT_DATE) as active_today,
      (SELECT COUNT(*) FROM user_test_attempts WHERE is_completed=true AND DATE(end_time)=CURRENT_DATE) as tests_completed_today
  `);

exports.queryUsers = (query, params) => pool.query(query, params);

exports.getTrends = (granularity = 'day', span = 14) => {
  const unit = granularity === 'week' ? 'week' : 'day';
  const count = Math.min(366, Math.max(1, Number.parseInt(span, 10) || 14));
  return pool.query(`WITH series AS (
    SELECT generate_series(date_trunc($1, CURRENT_DATE)-($2::integer-1)*('1 '||$1)::interval,
      date_trunc($1,CURRENT_DATE),('1 '||$1)::interval) AS bucket
  ), activity AS (
    SELECT user_id,start_time AS ts FROM user_test_attempts
    UNION ALL SELECT user_id,end_time FROM user_test_attempts WHERE is_completed=true
  ) SELECT to_char(s.bucket, CASE WHEN $1='week' THEN 'IW-IYYY' ELSE 'DD/MM' END) AS label,
    (SELECT COUNT(DISTINCT a.user_id) FROM activity a
      WHERE date_trunc($1,a.ts)=s.bucket) AS active_users,
    (SELECT COUNT(*) FROM user_test_attempts a WHERE a.is_completed=true
      AND date_trunc($1,a.end_time)=s.bucket) AS tests_completed
    FROM series s ORDER BY s.bucket`, [unit,count]);
};
