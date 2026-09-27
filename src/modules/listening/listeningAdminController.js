const ListeningService = require("./listeningService");


const path = require("path");
const fs = require("fs");
const { importsDir } = require("../../middlewares/upload");

exports.requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "ADMIN") return next();
  return res.status(403).json({ error: "Access denied" });
};

// Listening Materials Management
exports.getListeningMaterials = async (req, res) => {
  try {
    const data = await ListeningService.getListeningMaterials(req.query);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch listening materials" });
  }
};

exports.getListeningMaterialById = async (req, res) => {
  try {
    const data = await ListeningService.getListeningMaterialById(req.params.id);
    if (!data)
      return res.status(404).json({ error: "Listening material not found" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch listening material" });
  }
};

exports.createListeningMaterial = async (req, res) => {
  try {
    const material = await ListeningService.createListeningMaterial(req.body);
    res.status(201).json(material);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e.message || "Failed to create listening material" });
  }
};

exports.updateListeningMaterial = async (req, res) => {
  try {
    const updated = await ListeningService.updateListeningMaterial(
      req.params.id,
      req.body
    );
    if (!updated)
      return res.status(404).json({ error: "Listening material not found" });
    res.json(updated);
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to update listening material" });
  }
};

exports.deleteListeningMaterial = async (req, res) => {
  try {
    const deleted = await ListeningService.deleteListeningMaterial(
      req.params.id
    );
    if (!deleted)
      return res.status(404).json({ error: "Listening material not found" });
    res.json({
      message: "Listening material và file audio đã được xóa thành công",
    });
  } catch (e) {
    const errorMessage = e.message || "Failed to delete listening material";
    // Nếu là lỗi do đang trong bài thi, trả về 400
    if (errorMessage.includes("đang được sử dụng trong")) {
      return res.status(400).json({ error: errorMessage });
    }
    res.status(500).json({ error: errorMessage });
  }
};

// Questions Management
exports.getListeningQuestionsByPart = async (req, res) => {
  try {
    const partNumber = parseInt(req.params.part);
    const data = await ListeningService.getListeningQuestionsByPart(
      partNumber,
      req.query
    );
    res.json(data);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e.message || "Failed to fetch listening questions" });
  }
};

exports.getListeningQuestionsGrouped = async (req, res) => {
  try {
    const partNumber = parseInt(req.params.part);
    const data = await ListeningService.getListeningQuestionsGrouped(
      partNumber,
      req.query
    );
    res.json(data);
  } catch (e) {
    console.error(
      `Error fetching Part ${req.params.part} grouped questions:`,
      e
    );
    res.status(500).json({
      error: e.message || "Failed to fetch grouped listening questions",
    });
  }
};

exports.getQuestionsByMaterialId = async (req, res) => {
  try {
    const materialId = req.params.materialId;
    const partNumber = req.query.part ? parseInt(req.query.part) : null;
    const data = await ListeningService.getQuestionsByMaterialId(
      materialId,
      partNumber
    );
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch questions by material" });
  }
};

exports.createListeningQuestion = async (req, res) => {
  try {
    const partNumber = parseInt(req.params.part);
    const question = await ListeningService.createListeningQuestion(
      partNumber,
      req.body
    );
    res.status(201).json(question);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e.message || "Failed to create listening question" });
  }
};

exports.deleteListeningQuestion = async (req, res) => {
  try {
    const deleted = await ListeningService.deleteListeningQuestion(
      req.params.id
    );
    if (!deleted) {
      return res.status(404).json({ error: "Câu hỏi không tồn tại" });
    }
    res.json({ message: "Xóa câu hỏi thành công" });
  } catch (e) {
    // Hiển thị error message từ service (đã có thông báo chi tiết)
    const errorMessage = e.message || "Không thể xóa câu hỏi";
    res.status(400).json({ error: errorMessage });
  }
};
// Import listening tu file zip
exports.importListeningQuestionsZip = require('../imports/importController').zip();
exports.importListeningQuestions = require('../imports/importController').json('listening');

// Statistics
exports.getListeningStatistics = async (req, res) => {
  try {
    const stats = await ListeningService.getListeningStatistics();
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch listening statistics" });
  }
};

exports.fixMediaUrls = async (req, res) => {
  try {
    const pool = require("../../../db");
    const { importsDir } = require("../../middlewares/upload");
    const path = require("path");
    const fs = require("fs");
    const toPublic = (abs) => {
      const rel = path
        .relative(importsDir.replace(/\\$/, ""), abs)
        .replace(/\\/g, "/");
      return `/uploads/imports/${rel}`;
    };
    const findPath = (relPath) => {
      const rootDirs = fs.existsSync(importsDir)
        ? fs.readdirSync(importsDir)
        : [];
      const target = String(relPath).replace(/\\/g, "/");
      for (const dirName of rootDirs) {
        const baseDir = path.join(importsDir, dirName);
        if (!fs.statSync(baseDir).isDirectory()) continue;
        const stack = [baseDir];
        while (stack.length) {
          const d = stack.pop();
          const entries = fs.readdirSync(d, { withFileTypes: true });
          for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) stack.push(p);
            else {
              const pn = p.replace(/\\/g, "/");
              const bn = path.basename(pn).toLowerCase();
              const tb = path.basename(target).toLowerCase();
              if (pn.endsWith(target) || bn === tb) return toPublic(p);
            }
          }
        }
      }
      return null;
    };
    const extractZipNameFromPublic = (url) => {
      const m = String(url || "").match(/^\/uploads\/imports\/([^/]+)\//);
      return m ? m[1] : null;
    };
    const findInExtract = (zipName, relPath) => {
      if (!zipName) return null;
      const baseDir = path.join(importsDir, zipName);
      if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory())
        return null;
      const target = String(relPath).replace(/\\/g, "/");
      const stack = [baseDir];
      while (stack.length) {
        const d = stack.pop();
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) stack.push(p);
          else {
            const pn = p.replace(/\\/g, "/");
            const bn = path.basename(pn).toLowerCase();
            const tb = path.basename(target).toLowerCase();
            if (pn.endsWith(target) || bn === tb) return toPublic(p);
          }
        }
      }
      return null;
    };
    const client = await pool.connect();
    try {
      const qres = await client.query(
        `SELECT q.question_id, q.image_url, q.material_id, lm.audio_url
         FROM questions q
         LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
         WHERE q.question_type='listening' AND q.image_url IS NOT NULL AND q.image_url NOT LIKE '/uploads/%'`
      );
      const mres = await client.query(
        `SELECT material_id, audio_url FROM listening_materials WHERE audio_url IS NOT NULL AND audio_url NOT LIKE '/uploads/%'`
      );
      await client.query("BEGIN");
      let uq = 0,
        um = 0;
      for (const row of qres.rows) {
        const zipName = extractZipNameFromPublic(row.audio_url);
        // Try to build directly from audio base
        let resolved = null;
        if (row.audio_url && zipName) {
          const audioUrlNorm = String(row.audio_url).replace(/\\/g, "/");
          const base = audioUrlNorm.split("/audio/")[0];
          const candidate = `${base}/${String(row.image_url).replace(
            /^[\\/]+/,
            ""
          )}`;
          const absCandidate = path.join(
            importsDir,
            candidate.replace(/^\/uploads\/imports\//, "")
          );
          if (fs.existsSync(absCandidate)) resolved = candidate;
        }
        if (!resolved) {
          resolved = findInExtract(zipName, row.image_url);
        }
        if (!resolved) {
          resolved = findPath(row.image_url);
        }
        if (resolved) {
          await client.query(
            `UPDATE questions SET image_url=$1 WHERE question_id=$2`,
            [resolved, row.question_id]
          );
          uq++;
        }
      }
      for (const row of mres.rows) {
        const resolved = findPath(row.audio_url);
        if (resolved) {
          await client.query(
            `UPDATE listening_materials SET audio_url=$1 WHERE material_id=$2`,
            [resolved, row.material_id]
          );
          um++;
        }
      }
      await client.query("COMMIT");
      res.json({ updated_questions: uq, updated_materials: um });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to fix media URLs" });
  }
};

exports.debugImages = async (req, res) => {
  try {
    const pool = require("../../../db");
    const result = await pool.query(
      `SELECT q.question_id, q.image_url, q.material_id, lm.audio_url
       FROM questions q
       LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
       WHERE q.question_type='listening' AND q.image_url IS NOT NULL AND q.image_url NOT LIKE '/uploads/%'
       ORDER BY q.question_id LIMIT 50`
    );
    res.json({ count: result.rows.length, rows: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message || "debug failed" });
  }
};

exports.fixImagesFast = async (req, res) => {
  try {
    const pool = require("../../../db");
    const result = await pool.query(
      `UPDATE questions q
       SET image_url = split_part(lm.audio_url, '/audio/', 1) || '/' || q.image_url
       FROM listening_materials lm
       WHERE q.material_id = lm.material_id
         AND q.question_type = 'listening'
         AND q.image_url IS NOT NULL
         AND q.image_url NOT LIKE '/uploads/%'
       RETURNING q.question_id, q.image_url`
    );
    res.json({ updated: result.rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "fix images failed" });
  }
};

exports.updateQuestionImage = async (req, res) => {
  try {
    const pool = require("../../../db");
    const id = req.params.id;
    const qres = await pool.query(
      `SELECT q.question_id, q.image_url, lm.audio_url
       FROM questions q LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
       WHERE q.question_id = $1`,
      [id]
    );
    const row = qres.rows[0];
    if (!row) return res.status(404).json({ error: "Question not found" });
    const base = String(row.audio_url || "").split("/audio/")[0];
    if (!base)
      return res
        .status(400)
        .json({ error: "No audio base to build image URL" });
    const newUrl = `${base}/${String(row.image_url).replace(/^[\\/]+/, "")}`;
    await pool.query(`UPDATE questions SET image_url=$1 WHERE question_id=$2`, [
      newUrl,
      id,
    ]);
    const updated = await pool.query(
      `SELECT question_id, image_url FROM questions WHERE question_id=$1`,
      [id]
    );
    res.json(updated.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message || "update image failed" });
  }
};

exports.convertImagesToPng = async (req, res) => {
  try {
    const pool = require("../../../db");
    const { importsDir } = require("../../middlewares/upload");
    const path = require("path");
    const fs = require("fs");
    const toAbs = (u) =>
      path.join(importsDir, String(u).replace(/^\/uploads\/imports\//, ""));
    const rowsRes = await pool.query(
      `SELECT q.question_id, q.image_url, lm.audio_url
       FROM questions q
       LEFT JOIN listening_materials lm ON q.material_id = lm.material_id
       WHERE q.question_type='listening' AND q.image_url IS NOT NULL`
    );
    let updated = 0;
    for (const row of rowsRes.rows) {
      const base = row.audio_url
        ? String(row.audio_url).replace(/\\/g, "/").split("/audio/")[0]
        : "";
      let cur = String(row.image_url).replace(/\\/g, "/");
      let url = cur.startsWith("/uploads/")
        ? cur
        : base
        ? `${base}/${cur.replace(/^\//, "")}`
        : cur;
      const absJpg = toAbs(url);
      const absPng = absJpg.replace(/\.jpe?g$/i, ".png");
      let next = url;
      if (/\.jpe?g$/i.test(url) && fs.existsSync(absPng)) {
        next = url.replace(/\.jpe?g$/i, ".png");
      }
      if (next !== cur) {
        await pool.query(
          `UPDATE questions SET image_url=$1 WHERE question_id=$2`,
          [next, row.question_id]
        );
        updated++;
      }
    }
    res.json({ updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "convert failed" });
  }
};

