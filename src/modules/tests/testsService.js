const TestsModel = require("./testsModel");
const pool = require("../../../db");
const { startAttempt, submitAnswer, finishAttempt, getAttemptResults } = require("./attemptService");

// Called only by the authenticated admin route; student access still requires ownership.
async function adminGetAttemptResults(attemptId) {
  const summary = await TestsModel.getAttemptSummary(attemptId);
  if (!summary) throw Object.assign(new Error('Attempt not found'), { status: 404 });
  const result = await getAttemptResults(attemptId, summary.user_id);
  return { ...result, attempt: { ...summary, ...result.attempt } };
}

// STUDENT SERVICES

async function listTests(part = null) {
  return await TestsModel.getAllTests(part);
}

async function getFullTestForStudent(test_id, includeAnswers = false) {
  const test = await TestsModel.getTestById(test_id);
  if (!test) return null;

  const questions = await TestsModel.getTestQuestions(test_id);

  const formatted = await Promise.all(
    questions.map(async (q) => {
      const choices = await TestsModel.getQuestionChoices(
        q.question_id,
        includeAnswers
      );

      // LƯU Ý: Luôn xóa correct_answer và explanation khi đang làm bài
      // Chỉ trả về correct_answer khi xem kết quả (trong getAttemptResults)
      // includeAnswers chỉ ảnh hưởng đến việc trả về is_correct trong choices
      const questionData = {
        ...q,
        choices,
      };

      // Chỉ ẩn đáp án khi không yêu cầu kèm đáp án
      if (!includeAnswers) {
        delete questionData.correct_answer;
        delete questionData.explanation;
        delete questionData.material_transcript;
      }

      return questionData;
    })
  );

  return { ...test, questions: formatted };
}

async function getUserAttempts(user_id) {
  return await TestsModel.getUserAttempts(user_id);
}

// ADMIN SERVICES

async function adminListTests(query) {
  return await TestsModel.getAllTests(null, { includeDrafts: true });
}

async function adminGetTestDetails(id) {
  const test = await TestsModel.getTestById(id, { includeDrafts: true });
  if (!test) return null;

  const questions = await TestsModel.getTestQuestions(id);

  const withChoices = await Promise.all(
    questions.map(async (q) => {
      return {
        ...q,
        choices: await TestsModel.getQuestionChoices(q.question_id, true),
      };
    })
  );

  return { ...test, questions: withChoices };
}

async function adminCreateTest(data) {
  return await TestsModel.createTest(data);
}

async function adminCreateTestWithQuestions(data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      test_name,
      test_type,
      description,
      time_limit,
      difficulty_level,
      parts,
      total_questions,
      part_number,
      created_by,
      reuse_assigned,
      is_active,
      publication_status,
    } = data;

    const newTest = await TestsModel.createTest({
      test_name,
      test_type,
      description,
      time_limit,
      difficulty_level,
      parts,
      created_by,
      is_active,
    });

    const count = Math.max(0, Number(total_questions) || 0);
    const pn = Number(part_number) || 5;

    let selectedIds = [];
    if (count > 0) {
      const params = [pn];

      // Part 1: 1 audio = 6 câu hỏi (chọn tất cả 6 câu cùng material_id)
      // Part 2: 1 audio = 25 câu hỏi (chọn tất cả 25 câu cùng material_id)
      let sql;
      if (pn === 1) {
        // Part 1: Tìm material_id đầu tiên có đủ 6 câu hỏi, lấy TẤT CẢ 6 câu
        // Chỉ lấy listening questions (question_type = 'listening' hoặc NULL với material_id)
        let whereClause = `WHERE part_number=$1 AND material_id IS NOT NULL 
          AND (
            question_type = 'listening' 
            OR (question_type IS NULL AND material_id IS NOT NULL)
          )`;
        

        if (!reuse_assigned) {
          whereClause += " AND test_id IS NULL";
        }
        

        let whereClause2 = `WHERE q.part_number=$1 
          AND (
            q.question_type = 'listening' 
            OR (q.question_type IS NULL AND q.material_id IS NOT NULL)
          )`;
        if (!reuse_assigned) {
          whereClause2 += " AND q.test_id IS NULL";
        }
        

        sql = `
          WITH selected_material AS (
            SELECT material_id
            FROM questions
            ${whereClause}
            GROUP BY material_id
            HAVING COUNT(*) >= 6
            ORDER BY material_id ASC
            LIMIT 1
          )
          SELECT q.question_id
          FROM questions q
          INNER JOIN selected_material sm ON q.material_id = sm.material_id
          ${whereClause2}
          ORDER BY q.question_id ASC
          LIMIT 6
        `;
        
      } else if (pn === 2) {
        // Part 2: Tìm material_id đầu tiên có đủ 25 câu hỏi, lấy TẤT CẢ 25 câu
        // Chỉ lấy listening questions (question_type = 'listening' hoặc NULL với material_id)
        let whereClause = `WHERE part_number=$1 AND material_id IS NOT NULL 
          AND (
            question_type = 'listening' 
            OR (question_type IS NULL AND material_id IS NOT NULL)
          )`;
        

        if (!reuse_assigned) {
          whereClause += " AND test_id IS NULL"; // chỉ chọn câu hỏi chưa được gán vào bài thi
        }
        

        let whereClause2 = `WHERE q.part_number=$1 
          AND (
            q.question_type = 'listening' 
            OR (q.question_type IS NULL AND q.material_id IS NOT NULL)
          )`;
        if (!reuse_assigned) {
          whereClause2 += " AND q.test_id IS NULL";
        }
        

        sql = `
          WITH selected_material AS (
            SELECT material_id
            FROM questions
            ${whereClause}
            GROUP BY material_id
            HAVING COUNT(*) >= 25
            ORDER BY material_id ASC
            LIMIT 1
          )
          SELECT q.question_id
          FROM questions q
          INNER JOIN selected_material sm ON q.material_id = sm.material_id
          ${whereClause2}
          ORDER BY q.question_id ASC
          LIMIT 25
        `;
        
      } else {
        // Part 3, 4, 5, 6, 7: Chọn theo thứ tự import (question_id ASC) để giữ thứ tự như khi nhập
        // Phân biệt listening (Part 3, 4) và reading (Part 5, 6, 7)
        if (pn >= 3 && pn <= 4) {
          // Part 3, 4: Chỉ lấy listening questions
          sql = `SELECT question_id FROM questions 
            WHERE part_number=$1 
            AND (
              question_type = 'listening' 
              OR (question_type IS NULL AND material_id IS NOT NULL)
            )`;
        } else if (pn >= 5 && pn <= 7) {
          // Part 5, 6, 7: Chỉ lấy reading questions
          sql = `SELECT question_id FROM questions 
            WHERE part_number=$1 
            AND (
              question_type = 'reading' 
              OR (question_type IS NULL AND passage_id IS NOT NULL)
            )`;
        } else {
          // Fallback: không filter theo question_type
          sql = `SELECT question_id FROM questions WHERE part_number=$1`;
        }

        if (!reuse_assigned) sql += ` AND test_id IS NULL`;
        
        params.push(count);
        sql += ` ORDER BY question_id ASC LIMIT $${params.length}`;
      }

      const r = await client.query(sql, params);
      selectedIds = r.rows.map((x) => x.question_id);

      // Kiểm tra và thông báo nếu không tìm thấy câu hỏi phù hợp
      if (selectedIds.length === 0) {
        let errorMsg = "";
        if (pn === 1) {
          errorMsg = `Không tìm thấy material_id nào có đủ 6 câu hỏi Part 1 chưa được gán`;
          
          errorMsg += `. Vui lòng kiểm tra lại dữ liệu hoặc bật "Cho phép tái sử dụng câu hỏi đã gán".`;
        } else if (pn === 2) {
          errorMsg = `Không tìm thấy material_id nào có đủ 25 câu hỏi Part 2 chưa được gán`;
          
          errorMsg += `. Vui lòng kiểm tra lại dữ liệu hoặc bật "Cho phép tái sử dụng câu hỏi đã gán".`;
        } else {
          errorMsg = `Không tìm thấy ${count} câu hỏi Part ${pn} chưa được gán`;
          
          errorMsg += `. Vui lòng kiểm tra lại dữ liệu.`;
        }
        // Không throw error, chỉ trả về assigned: 0 để frontend xử lý
      }

      for (let i = 0; i < selectedIds.length; i++) {
        await client.query(
          `UPDATE questions SET test_id=$1, order_in_test=$2 WHERE question_id=$3`,
          [newTest.test_id, i + 1, selectedIds[i]]
        );
      }
    }

    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS total FROM questions WHERE test_id=$1`,
      [newTest.test_id]
    );
    const total = totalRes.rows[0].total;
    await client.query(`UPDATE tests SET total_questions=$1 WHERE test_id=$2`, [
      total,
      newTest.test_id,
    ]);

    await client.query("COMMIT");

    const questions = await TestsModel.getTestQuestions(newTest.test_id);
    const assigned = selectedIds.length;
    return {
      test: { ...newTest, total_questions: total },
      assigned,
      questions,
      warning:
        assigned === 0 && count > 0
          ? pn === 1
            ? "Không tìm thấy material_id nào có đủ 6 câu hỏi Part 1. Vui lòng kiểm tra lại dữ liệu."
            : pn === 2
            ? "Không tìm thấy material_id nào có đủ 25 câu hỏi Part 2. Vui lòng kiểm tra lại dữ liệu."
            : `Không tìm thấy đủ ${count} câu hỏi Part ${pn}. Vui lòng kiểm tra lại dữ liệu.`
          : null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function adminAutoGenerateQuestions(data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { test_id, part_number, total_questions, reuse_assigned } = data;
    const test = await TestsModel.getTestById(Number(test_id), { includeDrafts: true });
    if (!test) throw new Error("TEST_NOT_FOUND");

    const pn = Number(part_number) || 5;
    const count = Math.max(0, Number(total_questions) || 0);

    const maxOrderRes = await client.query(
      `SELECT COALESCE(MAX(order_in_test),0) AS max_order FROM questions WHERE test_id=$1`,
      [test.test_id]
    );
    let startOrder = Number(maxOrderRes.rows[0].max_order) || 0;

    let selectedIds = [];
    if (count > 0) {
      const reuse = Boolean(reuse_assigned);
      const params = [pn];

      // Part 1: 1 audio = 6 câu hỏi (chọn tất cả 6 câu cùng material_id)
      // Part 2: 1 audio = 25 câu hỏi (chọn tất cả 25 câu cùng material_id)
      let sql;
      if (pn === 1) {
        // Part 1: Tìm material_id đầu tiên có đủ 6 câu hỏi, lấy TẤT CẢ 6 câu
        // Chỉ lấy listening questions (question_type = 'listening' hoặc NULL với material_id)
        let whereClause = `WHERE part_number=$1 AND material_id IS NOT NULL 
          AND (
            question_type = 'listening' 
            OR (question_type IS NULL AND material_id IS NOT NULL)
          )`;
        

        if (!reuse) {
          whereClause += " AND test_id IS NULL";
        }
        

        let whereClause2 = `WHERE q.part_number=$1 
          AND (
            q.question_type = 'listening' 
            OR (q.question_type IS NULL AND q.material_id IS NOT NULL)
          )`;
        if (!reuse) {
          whereClause2 += " AND q.test_id IS NULL";
        }
        

        sql = `
          WITH selected_material AS (
            SELECT material_id
            FROM questions
            ${whereClause}
            GROUP BY material_id
            HAVING COUNT(*) >= 6
            ORDER BY material_id ASC
            LIMIT 1
          )
          SELECT q.question_id
          FROM questions q
          INNER JOIN selected_material sm ON q.material_id = sm.material_id
          ${whereClause2}
          ORDER BY q.question_id ASC
          LIMIT 6
        `;
        
      } else if (pn === 2) {
        // Part 2: Tìm material_id đầu tiên có đủ 25 câu hỏi, lấy TẤT CẢ 25 câu
        // Chỉ lấy listening questions (question_type = 'listening' hoặc NULL với material_id)
        let whereClause = `WHERE part_number=$1 AND material_id IS NOT NULL 
          AND (
            question_type = 'listening' 
            OR (question_type IS NULL AND material_id IS NOT NULL)
          )`;
        

        if (!reuse) {
          whereClause += " AND test_id IS NULL";
        }
        

        let whereClause2 = `WHERE q.part_number=$1 
          AND (
            q.question_type = 'listening' 
            OR (q.question_type IS NULL AND q.material_id IS NOT NULL)
          )`;
        if (!reuse) {
          whereClause2 += " AND q.test_id IS NULL";
        }
        

        sql = `
          WITH selected_material AS (
            SELECT material_id
            FROM questions
            ${whereClause}
            GROUP BY material_id
            HAVING COUNT(*) >= 25
            ORDER BY material_id ASC
            LIMIT 1
          )
          SELECT q.question_id
          FROM questions q
          INNER JOIN selected_material sm ON q.material_id = sm.material_id
          ${whereClause2}
          ORDER BY q.question_id ASC
          LIMIT 25
        `;
        
      } else {
        // Part 3, 4, 5, 6, 7: Chọn theo thứ tự import (question_id ASC) để giữ thứ tự như khi nhập
        // Phân biệt listening (Part 3, 4) và reading (Part 5, 6, 7)
        if (pn >= 3 && pn <= 4) {
          // Part 3, 4: Chỉ lấy listening questions
          sql = `SELECT question_id FROM questions 
            WHERE part_number=$1 
            AND (
              question_type = 'listening' 
              OR (question_type IS NULL AND material_id IS NOT NULL)
            )`;
        } else if (pn >= 5 && pn <= 7) {
          // Part 5, 6, 7: Chỉ lấy reading questions
          sql = `SELECT question_id FROM questions 
            WHERE part_number=$1 
            AND (
              question_type = 'reading' 
              OR (question_type IS NULL AND passage_id IS NOT NULL)
            )`;
        } else {
          // Fallback: không filter theo question_type
          sql = `SELECT question_id FROM questions WHERE part_number=$1`;
        }

        if (!reuse) sql += ` AND test_id IS NULL`;
        
        params.push(count);
        sql += ` ORDER BY question_id ASC LIMIT $${params.length}`;
      }

      const r = await client.query(sql, params);
      selectedIds = r.rows.map((x) => x.question_id);

      // Kiểm tra và thông báo nếu không tìm thấy câu hỏi phù hợp
      if (selectedIds.length === 0) {
        let errorMsg = "";
        if (pn === 1) {
          errorMsg = `Không tìm thấy material_id nào có đủ 6 câu hỏi Part 1 chưa được gán`;
          
          errorMsg += `. Vui lòng kiểm tra lại dữ liệu hoặc bật "Cho phép tái sử dụng câu hỏi đã gán".`;
        } else if (pn === 2) {
          errorMsg = `Không tìm thấy material_id nào có đủ 25 câu hỏi Part 2 chưa được gán`;
          
          errorMsg += `. Vui lòng kiểm tra lại dữ liệu hoặc bật "Cho phép tái sử dụng câu hỏi đã gán".`;
        } else {
          errorMsg = `Không tìm thấy ${count} câu hỏi Part ${pn} chưa được gán`;
          
          errorMsg += `. Vui lòng kiểm tra lại dữ liệu.`;
        }
        // Không throw error, chỉ trả về assigned: 0 để frontend xử lý
      }

      for (let i = 0; i < selectedIds.length; i++) {
        await client.query(
          `UPDATE questions SET test_id=$1, order_in_test=$2 WHERE question_id=$3`,
          [test.test_id, startOrder + i + 1, selectedIds[i]]
        );
      }
    }

    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS total FROM questions WHERE test_id=$1`,
      [test.test_id]
    );
    const total = totalRes.rows[0].total;

    await client.query(`UPDATE tests SET total_questions=$1 WHERE test_id=$2`, [
      total,
      test.test_id,
    ]);

    await client.query("COMMIT");

    const questions = await TestsModel.getTestQuestions(test.test_id);
    return {
      test: { ...test, total_questions: total },
      assigned: selectedIds.length,
      questions,
      warning:
        selectedIds.length === 0 && count > 0
          ? pn === 1
            ? "Không tìm thấy material_id nào có đủ 6 câu hỏi Part 1. Vui lòng kiểm tra lại dữ liệu."
            : pn === 2
            ? "Không tìm thấy material_id nào có đủ 25 câu hỏi Part 2. Vui lòng kiểm tra lại dữ liệu."
            : `Không tìm thấy đủ ${count} câu hỏi Part ${pn}. Vui lòng kiểm tra lại dữ liệu.`
          : null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function adminUpdateTest(id, data) {
  if (Object.keys(data).length === 1 && data.publication_status !== undefined) {
    if (!['draft','published','unpublished'].includes(data.publication_status)) throw Object.assign(new Error('Trạng thái không hợp lệ'),{status:400});
    const result=await pool.query('UPDATE tests SET publication_status=$2, updated_at=CURRENT_TIMESTAMP WHERE test_id=$1 RETURNING *',[id,data.publication_status]);
    return result.rows[0];
  }
  // Ràng buộc: Không cho sửa nếu đã có người làm bài
  // Kiểm tra xem có người đã làm bài test này chưa
  const attemptsCheck = await pool.query(
    `SELECT COUNT(*) as count FROM user_test_attempts WHERE test_id=$1`,
    [id]
  );
  const attemptsCount = parseInt(attemptsCheck.rows[0].count || 0);

  if (attemptsCount > 0) {
    const testCheck = await pool.query(
      `SELECT test_name FROM tests WHERE test_id=$1`,
      [id]
    );
    const testName = testCheck.rows[0]?.test_name || "N/A";
    throw new Error(
      `Không thể sửa bài test "${testName}" (ID: ${id}): Đã có ${attemptsCount} lượt làm bài. Bạn có thể ngừng xuất bản đề hoặc tạo đề mới.`
    );
  }

  return await TestsModel.updateTest(id, data);
}

async function adminDeleteTest(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if test exists
    const testCheck = await client.query(
      `SELECT test_id, test_name FROM tests WHERE test_id=$1 FOR UPDATE`,
      [id]
    );
    if (testCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const test = testCheck.rows[0];

    const used=await client.query('SELECT 1 FROM user_test_attempts WHERE test_id=$1 LIMIT 1',[id]);
    if(used.rows.length) throw Object.assign(new Error('Đề đã có lượt làm bài. Hãy ngừng xuất bản thay vì xóa.'),{status:409});

    // 3. Gỡ câu hỏi khỏi bài thi (giữ lại câu hỏi để sử dụng lại)
    const unlinkQuestions = await client.query(
      `UPDATE questions SET test_id=NULL, order_in_test=NULL WHERE test_id=$1`,
      [id]
    );

    // 4. Xóa bài thi
    const deleteTest = await client.query(
      `DELETE FROM tests WHERE test_id=$1 RETURNING *`,
      [id]
    );
    await client.query("COMMIT");
    return deleteTest.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(" Error deleting test:", e);
    throw e;
  } finally {
    client.release();
  }
}

async function adminGetStatistics(id) {
  return await TestsModel.getTestStatistics(id);
}

async function adminGetAvailability({ part_number }) {
  const pn = Number(part_number);
  const params = [pn];
  let sql = `SELECT COUNT(*)::int AS available FROM questions WHERE test_id IS NULL AND part_number=$1`;
  
  const r = await pool.query(sql, params);
  return { available: r.rows[0]?.available ?? 0 };
}

// Lấy danh sách câu hỏi chưa gán theo part và difficulty
async function adminGetUnassignedQuestions({
  part_number,
  difficulty_level,
  page = 1,
  limit = 50,
}) {
  try {
    const pn = Number(part_number);
    const offset = (Number(page) - 1) * Number(limit);

    if (!pn || isNaN(pn)) {
      return {
        questions: [],
        total: 0,
        page: Number(page),
        limit: Number(limit),
        totalPages: 0,
      };
    }

    const params = [pn];
    // Filter: test_id IS NULL, part_number = $1
    // Với Part 1-4 (listening), chỉ lấy câu hỏi có question_type = 'listening' hoặc NULL (câu hỏi cũ)
    // và phải có material_id (đảm bảo là listening question)
    let whereClause = "WHERE q.test_id IS NULL AND q.part_number = $1";

    // Với Part 1-4, chỉ lấy listening questions
    if (pn >= 1 && pn <= 4) {
      whereClause += ` AND (
        q.question_type = 'listening' 
        OR (q.question_type IS NULL AND q.material_id IS NOT NULL)
      )`;
    } else {
      // Với Part 5-7 (reading), chỉ lấy reading questions
      whereClause += ` AND (
        q.question_type = 'reading' 
        OR (q.question_type IS NULL AND q.passage_id IS NOT NULL)
      )`;
    }

    

    // Query để lấy câu hỏi với choices
    const sql = `
      SELECT 
        q.question_id,
        q.question_text,
        q.part_number,
        q.difficulty_level,
        q.correct_answer,
        q.material_id,
        q.passage_id,
        json_agg(
          json_build_object(
            'choice_id', ac.choice_id,
            'choice_label', ac.choice_label,
            'choice_text', ac.choice_text
          ) ORDER BY ac.choice_label
        ) FILTER (WHERE ac.choice_id IS NOT NULL) as choices
      FROM questions q
      LEFT JOIN answer_choices ac ON q.question_id = ac.question_id
      ${whereClause}
      GROUP BY q.question_id
      ORDER BY q.question_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM questions q
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(sql, [...params, Number(limit), offset]),
      pool.query(countSql, params),
    ]);

    return {
      questions: result.rows,
      total: countResult.rows[0]?.total ?? 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil((countResult.rows[0]?.total ?? 0) / Number(limit)),
    };
  } catch (error) {
    console.error("Error in adminGetUnassignedQuestions:", error);
    throw error;
  }
}

// Gán câu hỏi vào test (manual assignment)
async function adminAssignQuestionsToTest({ test_id, question_ids }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const testId = Number(test_id);
    const questionIds = Array.isArray(question_ids)
      ? question_ids.map((id) => Number(id))
      : [];

    if (!testId || questionIds.length === 0) {
      throw new Error("Invalid test_id or question_ids");
    }

    // Kiểm tra test tồn tại
    const test = await TestsModel.getTestById(testId, { includeDrafts: true });
    if (!test) {
      throw new Error("TEST_NOT_FOUND");
    }

    // Lấy thứ tự hiện tại trong test
    const maxOrderRes = await client.query(
      `SELECT COALESCE(MAX(order_in_test), 0) AS max_order FROM questions WHERE test_id = $1`,
      [testId]
    );
    let startOrder = Number(maxOrderRes.rows[0].max_order) || 0;

    // Kiểm tra các câu hỏi có tồn tại và chưa được gán
    const checkSql = `
      SELECT question_id, test_id 
      FROM questions 
      WHERE question_id = ANY($1)
    `;
    const checkResult = await client.query(checkSql, [questionIds]);

    const assignedIds = [];
    const alreadyAssigned = [];
    const notFound = [];

    for (const q of checkResult.rows) {
      if (!questionIds.includes(q.question_id)) {
        notFound.push(q.question_id);
      } else if (q.test_id && q.test_id !== testId) {
        alreadyAssigned.push(q.question_id);
      } else {
        assignedIds.push(q.question_id);
      }
    }

    // Gán các câu hỏi hợp lệ
    for (let i = 0; i < assignedIds.length; i++) {
      await client.query(
        `UPDATE questions SET test_id = $1, order_in_test = $2 WHERE question_id = $3`,
        [testId, startOrder + i + 1, assignedIds[i]]
      );
    }

    // Cập nhật total_questions
    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS total FROM questions WHERE test_id = $1`,
      [testId]
    );
    const total = totalRes.rows[0].total;
    await client.query(
      `UPDATE tests SET total_questions = $1 WHERE test_id = $2`,
      [total, testId]
    );

    await client.query("COMMIT");

    return {
      assigned: assignedIds.length,
      alreadyAssigned: alreadyAssigned.length,
      notFound: notFound.length,
      totalQuestions: total,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// =====================
// ADMIN: Test Attempts Management
// =====================
async function adminGetAllAttempts({
  page = 1,
  limit = 20,
  test_id,
  user_id,
  date_from,
  date_to,
}) {
  const offset = (page - 1) * limit;

  let whereConditions = ["uta.is_completed = true"];
  let params = [];
  let paramCount = 0;

  // Only add test_id filter if it's a valid number
  if (test_id !== undefined && test_id !== null && test_id !== "") {
    const testIdNum = parseInt(test_id, 10);
    if (!isNaN(testIdNum)) {
      paramCount++;
      whereConditions.push(`uta.test_id = $${paramCount}`);
      params.push(testIdNum);
    }
  }

  // Only add user_id filter if it's a valid number
  if (user_id !== undefined && user_id !== null && user_id !== "") {
    const userIdNum = parseInt(user_id, 10);
    if (!isNaN(userIdNum)) {
      paramCount++;
      whereConditions.push(`uta.user_id = $${paramCount}`);
      params.push(userIdNum);
    }
  }

  if (date_from) {
    paramCount++;
    whereConditions.push(`uta.start_time >= $${paramCount}`);
    params.push(date_from);
  }

  if (date_to) {
    paramCount++;
    whereConditions.push(`uta.start_time <= $${paramCount}`);
    params.push(date_to);
  }

  const whereClause =
    whereConditions.length > 0 ? "WHERE " + whereConditions.join(" AND ") : "";

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM user_test_attempts uta
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].total);

  // Get paginated data
  params.push(limit, offset);
  const dataQuery = `
    SELECT 
      uta.attempt_id,
      uta.user_id,
      u.full_name,
      u.email,
      uta.test_id,
      t.test_name,
      uta.start_time,
      uta.end_time,
      uta.total_correct,
      uta.total_questions,
      uta.score,
      uta.time_spent,
      uta.is_completed
    FROM user_test_attempts uta
    JOIN "User" u ON uta.user_id = u.user_id
    JOIN tests t ON uta.test_id = t.test_id
    ${whereClause}
    ORDER BY uta.start_time DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `;

  const dataResult = await pool.query(dataQuery, params);

  return {
    attempts: dataResult.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = {
  // Student
  listTests,
  getFullTestForStudent,
  startAttempt,
  submitAnswer,
  finishAttempt,
  getAttemptResults,
  getUserAttempts,

  // Admin
  adminListTests,
  adminGetTestDetails,
  adminCreateTest,
  adminCreateTestWithQuestions,
  adminAutoGenerateQuestions,
  adminUpdateTest,
  adminDeleteTest,
  adminGetStatistics,
  adminGetAvailability,
  adminGetAllAttempts,
  adminGetAttemptResults,
  adminGetUnassignedQuestions,
  adminAssignQuestionsToTest,
};
