// src/modules/admin/admin.service.js
const AdminModel = require("./adminModel");

exports.getDashboardStats = async () => {
  const [
    students,
    vocabulary,
    tests,
    questions,
    recentRaw,
    quickRaw,
  ] = await Promise.all([
    AdminModel.countStudents(),
    AdminModel.countVocabulary(),
    AdminModel.countTests(),
    AdminModel.countQuestions(),
    AdminModel.getRecentActivity(),
    AdminModel.getQuickStats(),
  ]);

  const quick = quickRaw.rows[0];

  return {
    stats: {
      students: parseInt(students.rows[0].count),
      vocabulary: parseInt(vocabulary.rows[0].count),
      tests: parseInt(tests.rows[0].count),
      questions: parseInt(questions.rows[0].count),
    },
    recentActivity: recentRaw.rows.map((row, i) => ({
      key: (i + 1).toString(),
      action: row.action,
      user: row.user,
      time: row.time,
      type: "info",
    })),
    quickStats: {
      activeToday: parseInt(quick.active_today),
      testsCompletedToday: parseInt(quick.tests_completed_today),
    },
  };
};

exports.getUsers = async (page, limit, role, search) => {
  const offset = (page - 1) * limit;

  let query =
    `SELECT user_id, email, full_name, role, is_active, created_at 
     FROM "User" WHERE 1=1`;

  const params = [];
  let i = 1;

  if (role) {
    query += ` AND role = $${i}`;
    params.push(role);
    i++;
  }

  if (search) {
    query += ` AND (full_name ILIKE $${i} OR email ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const countQuery = query.replace(
    "SELECT user_id, email, full_name, role, is_active, created_at",
    "SELECT COUNT(*)"
  );

  const totalResult = await AdminModel.queryUsers(countQuery, params);
  const total = parseInt(totalResult.rows[0].count);

  query += ` ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
  params.push(limit, offset);

  const usersResult = await AdminModel.queryUsers(query, params);

  return {
    users: usersResult.rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

exports.getDashboardTrends = async (granularity = 'day', span = 14) => {
  const res = await AdminModel.getTrends(granularity, span);
  return res.rows;
};
