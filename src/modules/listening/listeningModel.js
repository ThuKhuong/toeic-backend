const pool = require("../../../db");

class ListeningModel {
  static async getListeningMaterials(filters = {}) {
    const {
      page = 1,
      limit = 20,
      part_number,
      difficulty_level,
      topic,
      search,
    } = filters;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = "WHERE 1=1";
    const params = [];
    let paramCount = 1;

    if (part_number) {
      whereClause += ` AND lm.material_id IN (
        SELECT DISTINCT material_id FROM questions 
        WHERE part_number = $${paramCount} AND material_id IS NOT NULL
      )`;
      params.push(part_number);
      paramCount++;
    }

    if (difficulty_level) {
      whereClause += ` AND lm.difficulty_level = $${paramCount}`;
      params.push(difficulty_level);
      paramCount++;
    }

    if (topic) {
      whereClause += ` AND lm.topic ILIKE $${paramCount}`;
      params.push(`%${topic}%`);
      paramCount++;
    }

    if (search) {
      whereClause += ` AND (lm.title ILIKE $${paramCount} OR lm.transcript ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    const sql = `
      SELECT 
        lm.*,
        COUNT(q.question_id) as question_count,
        array_agg(DISTINCT q.part_number) as parts
      FROM listening_materials lm
      LEFT JOIN questions q ON lm.material_id = q.material_id
      ${whereClause}
      GROUP BY lm.material_id
      ORDER BY lm.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const countSql = `
      SELECT COUNT(DISTINCT lm.material_id) as total
      FROM listening_materials lm
      LEFT JOIN questions q ON lm.material_id = q.material_id
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(sql, [...params, Number(limit), offset]),
      pool.query(countSql, params),
    ]);

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: Number(page),
      limit: Number(limit),
    };
  }

  static async getListeningMaterialById(id) {
    const result = await pool.query(
      `SELECT * FROM listening_materials WHERE material_id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async createListeningMaterial(material) {
    const {
      title,
      audio_url,
      transcript,
      duration,
      difficulty_level,
      topic,
      speaker_count,
      accent,
    } = material;

    const result = await pool.query(
      `INSERT INTO listening_materials (title, audio_url, transcript, duration, difficulty_level, topic, speaker_count, accent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        title,
        audio_url,
        transcript,
        duration,
        difficulty_level,
        topic,
        speaker_count,
        accent,
      ]
    );

    return result.rows[0];
  }

  static async updateListeningMaterial(id, material) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const updatable = [
      "title",
      "audio_url",
      "transcript",
      "duration",
      "difficulty_level",
      "topic",
      "speaker_count",
      "accent",
    ];

    for (const key of updatable) {
      if (material[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(material[key]);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      throw new Error("No fields to update");
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE listening_materials SET ${fields.join(
        ", "
      )}, updated_at = CURRENT_TIMESTAMP
       WHERE material_id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async deleteListeningMaterial(id) {
    const result = await pool.query(
      `DELETE FROM listening_materials WHERE material_id = $1 RETURNING material_id`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async getQuestionsByMaterialId(materialId, partNumber = null) {
    let whereClause = "WHERE q.material_id = $1";
    const params = [materialId];

    if (partNumber) {
      whereClause += " AND q.part_number = $2";
      params.push(partNumber);
    }

    const result = await pool.query(
      `SELECT 
        q.*,
        json_agg(
          json_build_object(
            'choice_id', ac.choice_id,
            'choice_label', ac.choice_label,
            'choice_text', ac.choice_text,
            'is_correct', ac.is_correct
          ) ORDER BY ac.choice_label
        ) as choices
      FROM questions q
      LEFT JOIN answer_choices ac ON q.question_id = ac.question_id
      ${whereClause}
      GROUP BY q.question_id
      ORDER BY q.part_number, q.order_in_test, q.question_id`,
      params
    );

    return result.rows;
  }

  static async getListeningQuestionsByPart(partNumber, filters = {}) {
    const { page = 1, limit = 20, difficulty_level, topic } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    // Đảm bảo partNumber là số hợp lệ
    const part = Number(partNumber);
    if (![1, 2, 3, 4].includes(part)) {
      throw new Error(`Invalid part number: ${partNumber}`);
    }

    let whereClause = "WHERE q.part_number = $1 AND q.material_id IS NOT NULL";
    const params = [part];
    let paramCount = 2;

    if (difficulty_level) {
      whereClause += ` AND q.difficulty_level = $${paramCount}`;
      params.push(difficulty_level);
      paramCount++;
    }

    if (topic) {
      whereClause += ` AND lm.topic ILIKE $${paramCount}`;
      params.push(`%${topic}%`);
      paramCount++;
    }

    const sql = `
      SELECT 
        q.*,
        lm.title as material_title,
        lm.audio_url,
        lm.transcript,
        lm.duration,
        t.test_id,
        t.test_name,
        json_agg(
          json_build_object(
            'choice_id', ac.choice_id,
            'choice_label', ac.choice_label,
            'choice_text', ac.choice_text,
            'is_correct', ac.is_correct
          ) ORDER BY ac.choice_label
        ) FILTER (WHERE ac.choice_id IS NOT NULL) as choices
      FROM questions q
      LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
      LEFT JOIN answer_choices ac ON q.question_id = ac.question_id
      LEFT JOIN tests t ON q.test_id = t.test_id
      ${whereClause}
      GROUP BY q.question_id, lm.material_id, t.test_id, t.test_name
      ORDER BY q.order_in_test, q.question_id
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const countSql = `
      SELECT COUNT(DISTINCT q.question_id) as total
      FROM questions q
      LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(sql, [...params, Number(limit), offset]),
      pool.query(countSql, params),
    ]);

    // Kiểm tra part_number của các rows trả về
    if (result.rows.length > 0) {
      const wrongParts = result.rows.filter((row) => row.part_number !== part);
      if (wrongParts.length > 0) {
        console.error(
          `Part ${partNumber} query returned rows with wrong part_number:`,
          wrongParts.map((r) => ({
            question_id: r.question_id,
            part_number: r.part_number,
          }))
        );
      }
    }

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: Number(page),
      limit: Number(limit),
    };
  }

  static groupQuestionsByMaterial(questions) {
    const grouped = {};

    if (!Array.isArray(questions) || questions.length === 0) {
      return [];
    }

    questions.forEach((question) => {
      const materialId = question.material_id;

      // Bỏ qua câu hỏi không có material_id (không nên xảy ra với Part 3, 4)
      if (!materialId) {
        console.warn(`Question ${question.question_id} without material_id`);
        return;
      }

      if (!grouped[materialId]) {
        grouped[materialId] = {
          material_id: materialId,
          material_title: question.material_title || "Không có tiêu đề",
          audio_url: question.audio_url,
          transcript: question.transcript,
          duration: question.duration,
          questions: [],
        };
      }

      const {
        material_title,
        audio_url,
        transcript,
        duration,
        ...questionData
      } = question;
      grouped[materialId].questions.push(questionData);
    });

    return Object.values(grouped);
  }
}

module.exports = ListeningModel;
