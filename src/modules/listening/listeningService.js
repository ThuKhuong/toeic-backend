const ListeningModel = require("./listeningModel");
const pool = require("../../../db");
const fs = require("fs");
const path = require("path");
const { importsDir } = require("../../middlewares/upload");

class ListeningService {
  static async getListeningMaterials(filters = {}) {
    return await ListeningModel.getListeningMaterials(filters);
  }

  static async getListeningMaterialById(id) {
    const material = await ListeningModel.getListeningMaterialById(id);
    if (!material) {
      throw new Error("Listening material not found");
    }
    return material;
  }

  static async createListeningMaterial(material) {
    const required = ["title", "audio_url"];
    for (const field of required) {
      if (!material[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return await ListeningModel.createListeningMaterial(material);
  }

  static async updateListeningMaterial(id, material) {
    const updated = await ListeningModel.updateListeningMaterial(id, material);
    if (!updated) {
      throw new Error("Listening material not found");
    }
    return updated;
  }

  static async deleteListeningMaterial(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Lấy thông tin material trước khi xóa (để lấy audio_url)
      const materialResult = await client.query(
        `SELECT material_id, audio_url, title 
         FROM listening_materials 
         WHERE material_id = $1`,
        [id]
      );

      if (materialResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return null; // Material không tồn tại
      }

      const material = materialResult.rows[0];

      // 2. Kiểm tra xem có questions nào dùng material này VÀ đã có trong bài thi không
      const checkInTest = await client.query(
        `SELECT COUNT(*) as count 
         FROM questions 
         WHERE material_id = $1 AND test_id IS NOT NULL`,
        [id]
      );

      const inTestCount = parseInt(checkInTest.rows[0].count);

      // 3. Nếu đã có trong bài thi, không cho xóa
      if (inTestCount > 0) {
        await client.query("ROLLBACK");
        throw new Error(
          `Không thể xóa material: Material này đang được sử dụng trong ${inTestCount} câu hỏi thuộc bài thi. Vui lòng xóa câu hỏi khỏi bài thi trước.`
        );
      }

      // 4. Lấy audio_url để xóa file
      const audioUrl = material.audio_url;

      // 5. Xóa record trong database (ON DELETE CASCADE sẽ tự động xóa questions)
      // Sử dụng client.query thay vì pool.query để đảm bảo nằm trong transaction
      const deleteResult = await client.query(
        `DELETE FROM listening_materials WHERE material_id = $1 RETURNING material_id`,
        [id]
      );

      const deleted = deleteResult.rows[0] || null;

      if (!deleted) {
        await client.query("ROLLBACK");
        return null; // Material không tồn tại
      }

      await client.query("COMMIT");

      // 6. Xóa file audio từ filesystem (nếu có và là file local)
      if (audioUrl && audioUrl.startsWith("/uploads/")) {
        // Chuyển từ URL sang đường dẫn thực tế
        const relativePath = audioUrl.replace(/^\/uploads\//, "");
        const filePath = path.join(importsDir, relativePath);

        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Đã xóa file audio: ${filePath}`);
          }
        } catch (fileError) {
          console.error(`Không thể xóa file audio: ${filePath}`, fileError);
          // Không throw error vì database đã xóa thành công
        }
      }

      return deleted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async getQuestionsByMaterialId(materialId, partNumber = null) {
    return await ListeningModel.getQuestionsByMaterialId(
      materialId,
      partNumber
    );
  }

  static async getListeningQuestionsByPart(partNumber, filters = {}) {
    if (![1, 2, 3, 4].includes(Number(partNumber))) {
      throw new Error("Invalid part number. Must be 1, 2, 3, or 4");
    }
    return await ListeningModel.getListeningQuestionsByPart(
      partNumber,
      filters
    );
  }

  static async getListeningQuestionsGrouped(partNumber, filters = {}) {
    const result = await this.getListeningQuestionsByPart(partNumber, filters);

    // For Parts 3 & 4, group questions by material
    if ([3, 4].includes(Number(partNumber))) {
      const grouped = ListeningModel.groupQuestionsByMaterial(result.data);
      return {
        ...result,
        data: grouped,
      };
    }

    return result;
  }

  static async createListeningQuestion(partNumber, payload) {
    if (![1, 2, 3, 4].includes(Number(partNumber))) {
      throw new Error("Invalid part number. Must be 1, 2, 3, or 4");
    }

    // Part 1 không cần question_text (chỉ cần hình ảnh và audio với 4 lựa chọn)
    // Part 2, 3, 4 cần question_text
    if (partNumber === 1) {
      // Part 1: chỉ cần correct_answer và choices
      if (!payload.correct_answer || !payload.choices) {
        throw new Error("Missing required field: correct_answer or choices");
      }
    } else {
      // Part 2, 3, 4: cần question_text, correct_answer và choices
      const required = ["question_text", "correct_answer", "choices"];
      for (const field of required) {
        if (!payload[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
    }

    // Validate correct_answer: Part 2 chỉ được A, B, C; Part 1, 3, 4 được A, B, C, D
    if (partNumber === 2) {
      if (!["A", "B", "C"].includes(payload.correct_answer)) {
        throw new Error("Part 2 correct answer must be A, B, or C (not D)");
      }
    } else {
      if (!["A", "B", "C", "D"].includes(payload.correct_answer)) {
        throw new Error("Correct answer must be A, B, C, or D");
      }
    }

    // Validate choices: Part 2 chỉ cần 3 choices, Part 1, 3, 4 cần 4 choices
    if (partNumber === 2) {
      if (!Array.isArray(payload.choices) || payload.choices.length !== 3) {
        throw new Error("Part 2 must provide exactly 3 choices (A, B, C)");
      }
    } else {
      if (!Array.isArray(payload.choices) || payload.choices.length !== 4) {
        throw new Error("Must provide exactly 4 choices");
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let materialId = null;

      // Create or reuse listening material if provided
      if (payload.material) {
        // Kiểm tra xem đã có listening_material với cùng audio_url và title chưa
        // Để reuse material_id cho nhiều câu hỏi cùng audio (Part 1: 6 câu, Part 2: 25 câu)
        const existingMaterial = await client.query(
          `SELECT material_id FROM listening_materials 
           WHERE audio_url = $1 AND title = $2 
           LIMIT 1`,
          [payload.material.audio_url, payload.material.title]
        );

        if (existingMaterial.rows.length > 0) {
          // Reuse material_id đã có
          materialId = existingMaterial.rows[0].material_id;
        } else {
          // Tạo listening_material mới nếu chưa có
          const materialResult = await client.query(
            `INSERT INTO listening_materials (title, audio_url, transcript, duration, difficulty_level, topic, speaker_count, accent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING material_id`,
            [
              payload.material.title,
              payload.material.audio_url,
              payload.material.transcript,
              payload.material.duration,
              payload.material.difficulty_level || 1,
              payload.material.topic,
              payload.material.speaker_count || 1,
              payload.material.accent,
            ]
          );
          materialId = materialResult.rows[0].material_id;
        }
      }

      // Create question
      // Part 1 không cần question_text (có thể null hoặc empty)
      const questionText =
        payload.question_text && payload.question_text.trim()
          ? payload.question_text.trim()
          : null;

      const questionResult = await client.query(
        `INSERT INTO questions (question_text, question_type, part_number, material_id, image_url, correct_answer, explanation, difficulty_level, order_in_test)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING question_id`,
        [
          questionText,
          "listening",
          partNumber,
          materialId,
          payload.image_url || null,
          payload.correct_answer,
          payload.explanation,
          payload.difficulty_level || 1,
          payload.order_in_test,
        ]
      );

      const questionId = questionResult.rows[0].question_id;

      // Tạo answer choices
      for (const choice of payload.choices) {
        await client.query(
          `INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct)
           VALUES ($1, $2, $3, $4)`,
          [
            questionId,
            choice.text,
            choice.label,
            choice.label === payload.correct_answer,
          ]
        );
      }

      await client.query("COMMIT");

      return await this.getQuestionById(questionId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async deleteListeningQuestion(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Kiểm tra xem câu hỏi có tồn tại không
      // Kiểm tra cả câu hỏi có question_type = 'listening' hoặc NULL (câu hỏi cũ)
      // và phải là Part 1-4 (listening parts) và có material_id
      const checkQuestion = await client.query(
        `SELECT question_id, question_type, test_id, part_number, material_id
         FROM questions 
         WHERE question_id = $1 
         AND (
           question_type = 'listening' 
           OR (question_type IS NULL AND part_number BETWEEN 1 AND 4 AND material_id IS NOT NULL)
         )`,
        [id]
      );

      if (checkQuestion.rows.length === 0) {
        await client.query("ROLLBACK");
        return null; // Câu hỏi không tồn tại hoặc không phải listening question
      }

      // 2. Kiểm tra xem có người đã làm câu hỏi này chưa
      const checkUsage = await client.query(
        `SELECT COUNT(*) as count 
         FROM user_answers 
         WHERE question_id = $1`,
        [id]
      );

      const usageCount = parseInt(checkUsage.rows[0].count);
      if (usageCount > 0) {
        await client.query("ROLLBACK");
        throw new Error(
          `Không thể xóa câu hỏi: Câu hỏi này đã được ${usageCount} người dùng làm bài. Vui lòng xóa câu hỏi khỏi đề thi trước hoặc liên hệ quản trị viên.`
        );
      }

      // 3. Kiểm tra xem câu hỏi có trong đề thi nào không
      const question = checkQuestion.rows[0];
      const testId = question.test_id;

      // Kiểm tra test_id có giá trị hợp lệ (không null, không undefined, không 0)
      // test_id là INTEGER nên nếu có giá trị thì phải > 0
      if (testId != null && testId !== undefined && testId !== 0) {
        // Kiểm tra xem test có tồn tại không
        const checkTest = await client.query(
          `SELECT test_id, test_name, is_active 
           FROM tests 
           WHERE test_id = $1`,
          [testId]
        );
        // Kiểm tra xem test có tồn tại không
        if (checkTest.rows.length > 0) {
          const test = checkTest.rows[0];
          await client.query("ROLLBACK");
          throw new Error(
            `Không thể xóa câu hỏi: Câu hỏi này đang được sử dụng trong đề thi "${test.test_name}" (ID: ${test.test_id}). Vui lòng xóa câu hỏi khỏi đề thi trước.`
          );
        }
      }

      // 4. Nếu không có ràng buộc, tiến hành xóa
      // Xóa cả câu hỏi có question_type = 'listening' hoặc NULL (câu hỏi cũ)
      const result = await client.query(
        `DELETE FROM questions 
         WHERE question_id = $1 
         AND (
           question_type = 'listening' 
           OR (question_type IS NULL AND part_number BETWEEN 1 AND 4 AND material_id IS NOT NULL)
         )
         RETURNING question_id`,
        [id]
      );

      await client.query("COMMIT");
      return result.rows[0] || null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e; // Re-throw để controller xử lý
    } finally {
      client.release();
    }
  }

  static async getQuestionById(id) {
    const result = await pool.query(
      `SELECT 
        q.*,
        lm.title as material_title,
        lm.audio_url,
        lm.transcript,
        lm.duration,
        json_agg(
          json_build_object(
            'choice_id', ac.choice_id,
            'choice_label', ac.choice_label,
            'choice_text', ac.choice_text,
            'is_correct', ac.is_correct
          ) ORDER BY ac.choice_label
        ) as choices
      FROM questions q
      LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
      LEFT JOIN answer_choices ac ON q.question_id = ac.question_id
      WHERE q.question_id = $1
      GROUP BY q.question_id, lm.material_id`,
      [id]
    );

    return result.rows[0] || null;
  }

  static async importListeningQuestions(items) {
    return require('../imports/importController').importJson(items, 'listening');
  }

  static async getListeningStatistics() {
    const result = await pool.query(`
      SELECT 
        q.part_number,
        COUNT(*) as question_count,
        COUNT(DISTINCT q.material_id) as material_count,
        AVG(q.difficulty_level) as avg_difficulty
      FROM questions q
      WHERE q.question_type = 'listening' AND q.part_number IN (1,2,3,4)
      GROUP BY q.part_number
      ORDER BY q.part_number
    `);

    const totalResult = await pool.query(`
      SELECT 
        COUNT(*) as total_questions,
        COUNT(DISTINCT material_id) as total_materials
      FROM questions 
      WHERE question_type = 'listening'
    `);

    return {
      by_part: result.rows,
      total: totalResult.rows[0],
    };
  }
}

module.exports = ListeningService;

