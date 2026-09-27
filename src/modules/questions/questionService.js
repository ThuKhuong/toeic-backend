const QuestionModel = require("./questionModel");
const pool = require("../../../db");

async function getQuestions(filters = {}) {
  const { page = 1, limit = 20 } = filters;
  const { whereClause, params, paramCount } =
    QuestionModel.buildWhereClause(filters);
  const offset = (Number(page) - 1) * Number(limit);
  const result = await QuestionModel.getQuestions(
    whereClause,
    params,
    Number(limit),
    offset
  );
  return result.rows;
}

async function getQuestionById(id, includeCorrect = true) {
  const base = await QuestionModel.getQuestionById(id);
  if (base.rows.length === 0) return null;
  const question = base.rows[0];
  const choices = await QuestionModel.getAnswerChoices(id, includeCorrect);
  return { ...question, choices: choices.rows };
}

async function getQuestionsForStudent(filters = {}) {
  const rows = await getQuestions(filters);
  return rows.map((q) => {
    const { correct_answer, explanation, ...rest } = q;
    return rest;
  });
}

async function getRandomQuestions(count = 10, filters = {}) {
  const { whereClause, params, paramCount } =
    QuestionModel.buildWhereClause(filters);
  const sql = `
    SELECT q.* FROM questions q
    ${whereClause}
    ORDER BY RANDOM() LIMIT ${paramCount + 1}
  `;
  const result = await pool.query(sql, [...params, Number(count)]);
  return result.rows.map((q) => {
    const { correct_answer, explanation, ...rest } = q;
    return rest;
  });
}

async function createQuestion(payload) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      part_number,
      question_type = "reading",
      test_id = null,
      difficulty_level = 1,
      order_in_test = null,
      passage,
      questions,
      question_text,
      correct_answer,
      choices = [],
      explanation = null,
    } = payload;

    if (part_number === 5) {
      const qRes = await client.query(
        `INSERT INTO questions (test_id, question_text, question_type, part_number, correct_answer, explanation, difficulty_level, order_in_test)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING question_id`,
        [
          test_id,
          question_text,
          question_type,
          5,
          correct_answer,
          explanation,
          difficulty_level,
          order_in_test,
        ]
      );
      const qid = qRes.rows[0].question_id;
      for (const c of choices) {
        await client.query(
          `INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct)
           VALUES ($1,$2,$3,$4)`,
          [qid, c.text, c.label, c.label === correct_answer]
        );
      }
      await client.query("COMMIT");
      return await getQuestionById(qid, true);
    }

    if (part_number === 6 || part_number === 7) {
      const pRes = await client.query(
        `INSERT INTO reading_passages (title, content, difficulty_level, image_url)
         VALUES ($1,$2,$3,$4)
         RETURNING passage_id`,
        [
          passage?.title || null,
          passage?.content || "",
          passage?.difficulty_level || difficulty_level,
          passage?.image_url || null,
        ]
      );
      const pid = pRes.rows[0].passage_id;
      const created = [];
      let orderCounter = order_in_test;
      for (const sub of questions || []) {
        const qRes = await client.query(
          `INSERT INTO questions (test_id, question_text, question_type, part_number, passage_id, correct_answer, explanation, difficulty_level, order_in_test)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING question_id`,
          [
            test_id,
            sub.question_text,
            "reading",
            part_number,
            pid,
            sub.correct_answer,
            sub.explanation || null,
            sub.difficulty_level || difficulty_level,
            sub.order_in_test ?? orderCounter,
          ]
        );
        const qid = qRes.rows[0].question_id;
        for (const c of sub.choices || []) {
          await client.query(
            `INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct)
             VALUES ($1,$2,$3,$4)`,
            [qid, c.text, c.label, c.label === sub.correct_answer]
          );
        }
        created.push(qid);
        if (orderCounter != null) orderCounter++;
      }
      await client.query("COMMIT");
      const details = await Promise.all(
        created.map((id) => getQuestionById(id, true))
      );
      return { passage_id: pid, questions: details };
    }

    throw new Error("Unsupported part_number");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function updateQuestion(id, payload, transactionClient = null) {
  const client = transactionClient || (await pool.connect());
  const shouldRelease = !transactionClient;
  try {
    if (!transactionClient) {
      await client.query("BEGIN");
    }

    // Kiểm tra xem câu hỏi có nằm trong bài thi không (chỉ khi không trong transaction)
    if (!transactionClient) {
      const questionCheck = await client.query(
        `SELECT question_id, test_id FROM questions WHERE question_id=$1`,
        [id]
      );
      if (questionCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const testId = questionCheck.rows[0].test_id;
      if (testId) {
        const testCheck = await client.query(
          `SELECT test_id, test_name FROM tests WHERE test_id=$1`,
          [testId]
        );
        if (testCheck.rows.length > 0) {
          const test = testCheck.rows[0];
          await client.query("ROLLBACK");
          throw new Error(
            `Không thể sửa câu hỏi: Câu hỏi này đang được sử dụng trong đề thi "${test.test_name}" (ID: ${test.test_id}). Vui lòng xóa câu hỏi khỏi đề thi trước.`
          );
        }
      }
    }
    const fields = [];
    const values = [];
    let paramIndex = 1;
    const updatable = [
      "test_id",
      "question_text",
      "correct_answer",
      "explanation",
      "difficulty_level",
      "order_in_test",
      "passage_id",
      "material_id",
      "audio_url",
      "image_url",
    ];
    for (const k of updatable) {
      if (payload[k] !== undefined) {
        fields.push(`${k}=$${paramIndex}`);
        values.push(payload[k]);
        paramIndex++;
      }
    }

    // Only update if there are fields to update
    if (fields.length > 0) {
      // Add id as the last parameter
      values.push(id);
      await client.query(
        `UPDATE questions SET ${fields.join(
          ", "
        )} WHERE question_id=$${paramIndex}`,
        values
      );
    }

    // Update choices if provided
    if (Array.isArray(payload.choices)) {
      await client.query(`DELETE FROM answer_choices WHERE question_id=$1`, [
        id,
      ]);
      for (const c of payload.choices) {
        await client.query(
          `INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct)
           VALUES ($1,$2,$3,$4)`,
          [id, c.text, c.label, c.label === payload.correct_answer]
        );
      }
    }

    if (!transactionClient) {
      await client.query("COMMIT");
      return await getQuestionById(id, true);
    } else {
      // If in transaction, return basic question data without calling getQuestionById
      // (getQuestionById uses pool, not transaction client)
      const questionResult = await client.query(
        `SELECT * FROM questions WHERE question_id=$1`,
        [id]
      );
      if (questionResult.rows.length === 0) {
        return null;
      }
      const question = questionResult.rows[0];

      // Get choices using transaction client
      const choicesResult = await client.query(
        `SELECT * FROM answer_choices WHERE question_id=$1 ORDER BY choice_label`,
        [id]
      );
      return { ...question, choices: choicesResult.rows };
    }
  } catch (e) {
    if (!transactionClient) {
      await client.query("ROLLBACK");
    }
    throw e;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

async function deleteQuestion(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 1) Check question exists and whether it belongs to a test
    const qRes = await client.query(
      `SELECT question_id, test_id FROM questions WHERE question_id=$1`,
      [id]
    );
    if (qRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    // Kiem tra xem cau hoi co nam trong bai thi nao khong
    const testId = qRes.rows[0].test_id;
    if (testId) {
      await client.query("ROLLBACK");
      throw new Error("Không thể xóa: câu hỏi đã nằm trong bài thi");
    }

    const uaRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM user_answers WHERE question_id=$1`,
      [id]
    );
    const answeredCount = parseInt(uaRes.rows[0].cnt);
    // Kiem tra xem cau hoi co duoc ai lam khong
    if (answeredCount > 0) {
      await client.query("ROLLBACK");
      throw new Error("Không thể xóa: đã có người làm câu hỏi này");
    }

    // 3) Safe delete: remove choices then question
    await client.query(`DELETE FROM answer_choices WHERE question_id=$1`, [id]);
    const r = await client.query(
      `DELETE FROM questions WHERE question_id=$1 RETURNING question_id`,
      [id]
    );
    await client.query("COMMIT");
    return r.rows[0] || null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function deletePassageGroup(passageId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const questions = (await client.query('SELECT question_id,group_id,test_id FROM questions WHERE passage_id=$1 FOR UPDATE', [passageId])).rows;
    if (!questions.length) throw new Error('Không tìm thấy nhóm câu hỏi.');
    if (questions.some(q => q.test_id)) throw new Error('Không thể xóa nhóm đang thuộc đề thi.');
    const ids = questions.map(q=>q.question_id);
    if ((await client.query('SELECT 1 FROM attempt_questions WHERE question_id=ANY($1::integer[]) LIMIT 1',[ids])).rowCount) throw new Error('Không thể xóa câu hỏi đã có lượt làm bài.');
    const groups = [...new Set(questions.map(q=>q.group_id).filter(Boolean))];
    const passageIds = (await client.query('SELECT passage_id FROM question_group_passages WHERE group_id=ANY($1::integer[])',[groups])).rows.map(p=>p.passage_id);
    await client.query('DELETE FROM questions WHERE question_id=ANY($1::integer[])',[ids]);
    await client.query('DELETE FROM question_groups g WHERE group_id=ANY($1::integer[]) AND NOT EXISTS(SELECT 1 FROM questions q WHERE q.group_id=g.group_id)',[groups]);
    await client.query('DELETE FROM reading_passages p WHERE passage_id=ANY($1::integer[]) AND NOT EXISTS(SELECT 1 FROM questions q WHERE q.passage_id=p.passage_id) AND NOT EXISTS(SELECT 1 FROM question_group_passages gp WHERE gp.passage_id=p.passage_id)',[[Number(passageId),...passageIds]]);
    await client.query('COMMIT');
    return {passage_id:Number(passageId),deleted_questions:ids.length,question_ids:ids};
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
async function updatePassageGroup(passageId, payload) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { title, content, difficulty_level, questions } = payload;

    // 1. Update passage
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updateFields.push(`title = $${paramIndex++}`);
      updateValues.push(title);
    }
    if (content !== undefined) {
      updateFields.push(`content = $${paramIndex++}`);
      updateValues.push(content);
    }
    if (difficulty_level !== undefined) {
      updateFields.push(`difficulty_level = $${paramIndex++}`);
      updateValues.push(difficulty_level);
    }
    if (payload.image_url !== undefined) {
      updateFields.push(`image_url = $${paramIndex++}`);
      updateValues.push(payload.image_url);
    }

    if (updateFields.length > 0) {
      updateValues.push(passageId);
      await client.query(
        `UPDATE reading_passages SET ${updateFields.join(
          ", "
        )} WHERE passage_id = $${paramIndex}`,
        updateValues
      );
    }

    // 2. Update questions if provided
    if (Array.isArray(questions)) {
      // Get existing question IDs
      const existingQuestions = await client.query(
        `SELECT question_id,group_id,part_number FROM questions WHERE passage_id=$1 ORDER BY question_id`,
        [passageId]
      );
      const existingIds = existingQuestions.rows.map((r) => r.question_id);

      // Update or create questions
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (q.question_id && existingIds.includes(q.question_id)) {
          // Update existing question - pass client để dùng chung transaction
          await updateQuestion(
            q.question_id,
            {
              question_text: q.question_text,
              correct_answer: q.correct_answer,
              choices: q.choices,
              explanation: q.explanation,
              difficulty_level: q.difficulty_level,
            },
            client
          );
        } else {
          // Create new question for existing passage
          const qRes = await client.query(
            `INSERT INTO questions (test_id, question_text, question_type, part_number, passage_id, correct_answer, explanation, difficulty_level, order_in_test)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING question_id`,
            [
              null, // test_id
              q.question_text,
              "reading",
              existingQuestions.rows[0]?.part_number || 6,
              passageId,
              q.correct_answer,
              q.explanation || null,
              q.difficulty_level || 1,
              null, // order_in_test
            ]
          );
          const newQid = qRes.rows[0].question_id;
          await client.query('UPDATE questions SET group_id=$1 WHERE question_id=$2', [existingQuestions.rows[0]?.group_id || null, newQid]);
          // Insert choices
          for (const c of q.choices || []) {
            await client.query(
              `INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct)
               VALUES ($1,$2,$3,$4)`,
              [newQid, c.text, c.label, c.label === q.correct_answer]
            );
          }
        }
      }

      // Delete questions that are no longer in the list
      const newQuestionIds = questions
        .map((q) => q.question_id)
        .filter((id) => id && existingIds.includes(id));
      const toDelete = existingIds.filter((id) => !newQuestionIds.includes(id));

      if (toDelete.length > 0) {
        await client.query(
          `DELETE FROM answer_choices WHERE question_id = ANY($1::int[])`,
          [toDelete]
        );
        await client.query(
          `DELETE FROM questions WHERE question_id = ANY($1::int[])`,
          [toDelete]
        );
      }
    }

    await client.query("COMMIT");

    // Return updated passage with questions
    const updatedPassage = await pool.query(
      `SELECT passage_id, title, content, difficulty_level, image_url 
       FROM reading_passages WHERE passage_id=$1`,
      [passageId]
    );

    const updatedQuestions = await pool.query(
      `SELECT q.*, 
       rp.title as passage_title, rp.content as passage_content, rp.image_url as passage_image_url
       FROM questions q
       LEFT JOIN reading_passages rp ON q.passage_id = rp.passage_id
       WHERE q.passage_id=$1
       ORDER BY q.question_id`,
      [passageId]
    );

    const questionsWithChoices = await Promise.all(
      updatedQuestions.rows.map(async (row) => {
        const choices = await QuestionModel.getAnswerChoices(
          row.question_id,
          true
        );
        return {
          ...row,
          choices: choices.rows,
        };
      })
    );

    return {
      passage: updatedPassage.rows[0],
      questions: questionsWithChoices,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function importQuestions(items) {
  return require('../imports/importController').importJson(items, 'reading');
}

async function getStatistics() {
  const r = await pool.query(
    `SELECT part_number, COUNT(*) as count
     FROM questions
     GROUP BY part_number
     ORDER BY part_number`
  );
  const d = await pool.query(
    `SELECT difficulty_level, COUNT(*) as count
     FROM questions
     GROUP BY difficulty_level
     ORDER BY difficulty_level`
  );
  return { by_part: r.rows, by_difficulty: d.rows };
}

module.exports = {
  getQuestions,
  getQuestionById,
  getQuestionsForStudent,
  getRandomQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  deletePassageGroup,
  updatePassageGroup,
  importQuestions,
  getStatistics,
};


