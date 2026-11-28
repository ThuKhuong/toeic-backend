const express = require('express');
const router = express.Router();
const pool = require('../../../db');
const { authMiddleware, adminMiddleware } = require('../../middlewares/auth');
const { wordInput } = require('./vocabularyPersonalService');

router.use(authMiddleware, adminMiddleware);

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

function id(value) {
  if (
    !['number', 'string'].includes(typeof value) ||
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 2147483647
  ) {
    fail(400, 'ID không hợp lệ.');
  }
  return Number(value);
}

function text(value, name, limit, required = false) {
  if (value != null && typeof value !== 'string') {
    fail(400, `${name} không hợp lệ.`);
  }
  const result = (value ?? '').trim();
  if ((required && !result) || result.length > limit) {
    fail(400, `${name}${required ? ' bắt buộc,' : ''} tối đa ${limit} ký tự.`);
  }
  return result || null;
}

const handle = (work) => async (req, res, next) => {
  try {
    res.json(await work(req));
  } catch (error) {
    next(error);
  }
};

router.get(
  '/',
  handle(async (req) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const topicId =
      req.query.topic_id != null && String(req.query.topic_id).trim() !== ''
        ? id(req.query.topic_id)
        : null;
    const pattern = q ? `%${q}%` : null;
    const { rows } = await pool.query(
      `SELECT v.vocab_id, v.word, v.meaning_vi, v.meaning_en, v.pronunciation,
              v.part_of_speech, v.example_sentence, v.example_translation,
              v.topic_id, t.name AS topic_name, v.created_at, v.updated_at
       FROM vocabulary v
       LEFT JOIN vocabulary_topics t ON t.topic_id = v.topic_id AND t.owner_user_id IS NULL
       WHERE v.owner_user_id IS NULL
         AND ($1::text IS NULL OR v.word ILIKE $1 OR v.meaning_vi ILIKE $1 OR COALESCE(t.name, '') ILIKE $1)
         AND ($2::integer IS NULL OR v.topic_id = $2)
       ORDER BY lower(v.word), v.vocab_id`,
      [pattern, topicId],
    );
    return { success: true, data: rows };
  }),
);

router.get(
  '/topics',
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT t.topic_id, t.name AS topic_name, t.description,
              COUNT(v.vocab_id)::integer AS word_count
       FROM vocabulary_topics t
       LEFT JOIN vocabulary v ON v.topic_id = t.topic_id AND v.owner_user_id IS NULL
       WHERE t.owner_user_id IS NULL
       GROUP BY t.topic_id
       ORDER BY lower(t.name), t.topic_id`,
    );
    return { success: true, data: rows };
  }),
);

router.post(
  '/',
  handle(async (req) => {
    const data = wordInput(req.body ?? {});
    if (data.topic_id != null) {
      const check = await pool.query(
        'SELECT topic_id FROM vocabulary_topics WHERE topic_id = $1 AND owner_user_id IS NULL',
        [data.topic_id],
      );
      if (!check.rows.length) fail(404, 'Chủ đề hệ thống không tồn tại.');
    }
    const fields = Object.keys(data);
    const { rows } = await pool.query(
      `INSERT INTO vocabulary (owner_user_id, ${fields.join(',')})
       VALUES (NULL, ${fields.map((_, i) => '$' + (i + 1)).join(',')})
       RETURNING *`,
      Object.values(data),
    );
    return rows[0];
  }),
);

router.post(
  '/import',
  handle(async (req) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || !items.length) {
      fail(400, 'Danh sách từ vựng import không được để trống.');
    }
    if (items.length > 2000) {
      fail(400, 'Mỗi lần import tối đa 2000 từ vựng.');
    }
    const defaultTopicId =
      req.body?.default_topic_id != null &&
      String(req.body.default_topic_id).trim() !== ''
        ? id(req.body.default_topic_id)
        : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const topicsRes = await client.query(
        'SELECT topic_id, name FROM vocabulary_topics WHERE owner_user_id IS NULL',
      );
      const topicByName = new Map();
      const topicIds = new Set();
      for (const row of topicsRes.rows) {
        topicByName.set(row.name.trim().toLowerCase(), row.topic_id);
        topicIds.add(Number(row.topic_id));
      }

      if (defaultTopicId != null && !topicIds.has(defaultTopicId)) {
        fail(404, 'Chủ đề mặc định không tồn tại.');
      }

      let created = 0;
      let updated = 0;

      for (let idx = 0; idx < items.length; idx++) {
        const raw = items[idx] ?? {};
        const rowLabel = `Dòng ${idx + 1}`;
        let resolvedTopicId =
          raw.topic_id != null && String(raw.topic_id).trim() !== ''
            ? id(raw.topic_id)
            : defaultTopicId;

        const rawTopicName =
          typeof raw.topic_name === 'string'
            ? raw.topic_name.trim().replace(/\s+/g, ' ')
            : '';
        if (rawTopicName) {
          if (rawTopicName.length > 100) {
            fail(400, `${rowLabel}: Tên chủ đề tối đa 100 ký tự.`);
          }
          const key = rawTopicName.toLowerCase();
          if (topicByName.has(key)) {
            resolvedTopicId = topicByName.get(key);
          } else {
            const newTopic = await client.query(
              `INSERT INTO vocabulary_topics (name, description, owner_user_id)
               VALUES ($1, NULL, NULL)
               RETURNING topic_id, name`,
              [rawTopicName],
            );
            resolvedTopicId = newTopic.rows[0].topic_id;
            topicByName.set(key, resolvedTopicId);
            topicIds.add(Number(resolvedTopicId));
          }
        } else if (resolvedTopicId != null && !topicIds.has(resolvedTopicId)) {
          fail(404, `${rowLabel}: Chủ đề hệ thống không tồn tại.`);
        }

        let data;
        try {
          data = wordInput({
            ...raw,
            topic_id: resolvedTopicId,
          });
        } catch (err) {
          fail(err.status || 400, `${rowLabel}: ${err.message}`);
        }

        const existing = await client.query(
          `SELECT vocab_id FROM vocabulary
           WHERE owner_user_id IS NULL
             AND lower(word) = lower($1)
             AND COALESCE(topic_id, 0) = COALESCE($2::integer, 0)
           LIMIT 1`,
          [data.word, data.topic_id],
        );

        if (existing.rows.length) {
          await client.query(
            `UPDATE vocabulary
             SET meaning_vi = $2,
                 pronunciation = COALESCE($3, pronunciation),
                 part_of_speech = COALESCE($4, part_of_speech),
                 meaning_en = COALESCE($5, meaning_en),
                 example_sentence = COALESCE($6, example_sentence),
                 example_translation = COALESCE($7, example_translation),
                 topic_id = $8,
                 updated_at = NOW()
             WHERE vocab_id = $1 AND owner_user_id IS NULL`,
            [
              existing.rows[0].vocab_id,
              data.meaning_vi,
              data.pronunciation,
              data.part_of_speech,
              data.meaning_en,
              data.example_sentence,
              data.example_translation,
              data.topic_id,
            ],
          );
          updated++;
        } else {
          const fields = Object.keys(data);
          await client.query(
            `INSERT INTO vocabulary (owner_user_id, ${fields.join(',')})
             VALUES (NULL, ${fields.map((_, i) => '$' + (i + 1)).join(',')})`,
            Object.values(data),
          );
          created++;
        }
      }

      await client.query('COMMIT');
      return {
        success: true,
        created,
        updated,
        total: created + updated,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }),
);

router.put(
  '/:id',
  handle(async (req) => {
    const vocabId = id(req.params.id);
    const data = wordInput(req.body ?? {});
    if (data.topic_id != null) {
      const check = await pool.query(
        'SELECT topic_id FROM vocabulary_topics WHERE topic_id = $1 AND owner_user_id IS NULL',
        [data.topic_id],
      );
      if (!check.rows.length) fail(404, 'Chủ đề hệ thống không tồn tại.');
    }
    const fields = Object.keys(data);
    const { rows } = await pool.query(
      `UPDATE vocabulary
       SET ${fields.map((f, i) => `${f}=$${i + 2}`).join(',')}, updated_at=NOW()
       WHERE vocab_id=$1 AND owner_user_id IS NULL
       RETURNING *`,
      [vocabId, ...Object.values(data)],
    );
    if (!rows.length) fail(404, 'Không tìm thấy từ vựng hệ thống.');
    return rows[0];
  }),
);

router.delete(
  '/:id',
  handle(async (req) => {
    const vocabId = id(req.params.id);
    const { rows } = await pool.query(
      'DELETE FROM vocabulary WHERE vocab_id=$1 AND owner_user_id IS NULL RETURNING vocab_id',
      [vocabId],
    );
    if (!rows.length) fail(404, 'Không tìm thấy từ vựng hệ thống.');
    return { deleted: true };
  }),
);

router.post(
  '/topics',
  handle(async (req) => {
    const name = text(req.body?.name, 'Tên chủ đề', 100, true).replace(
      /\s+/g,
      ' ',
    );
    const description = text(req.body?.description, 'Mô tả', 500, false);
    try {
      const { rows } = await pool.query(
        `INSERT INTO vocabulary_topics (name, description, owner_user_id)
         VALUES ($1, $2, NULL)
         RETURNING topic_id, name AS topic_name, description`,
        [name, description],
      );
      return rows[0];
    } catch (e) {
      if (e.code === '23505') fail(409, 'Chủ đề hệ thống này đã tồn tại.');
      throw e;
    }
  }),
);

router.put(
  '/topics/:id',
  handle(async (req) => {
    const topicId = id(req.params.id);
    const name = text(req.body?.name, 'Tên chủ đề', 100, true).replace(
      /\s+/g,
      ' ',
    );
    const description = text(req.body?.description, 'Mô tả', 500, false);
    try {
      const { rows } = await pool.query(
        `UPDATE vocabulary_topics
         SET name=$1, description=$2
         WHERE topic_id=$3 AND owner_user_id IS NULL
         RETURNING topic_id, name AS topic_name, description`,
        [name, description, topicId],
      );
      if (!rows.length) fail(404, 'Không tìm thấy chủ đề hệ thống.');
      return rows[0];
    } catch (e) {
      if (e.code === '23505') fail(409, 'Chủ đề hệ thống này đã tồn tại.');
      throw e;
    }
  }),
);

router.delete(
  '/topics/:id',
  handle(async (req) => {
    const topicId = id(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await client.query(
        'SELECT topic_id FROM vocabulary_topics WHERE topic_id=$1 AND owner_user_id IS NULL FOR UPDATE',
        [topicId],
      );
      if (!check.rows.length) fail(404, 'Không tìm thấy chủ đề hệ thống.');
      await client.query(
        'UPDATE vocabulary SET topic_id=NULL WHERE topic_id=$1 AND owner_user_id IS NULL',
        [topicId],
      );
      await client.query(
        'DELETE FROM vocabulary_topics WHERE topic_id=$1 AND owner_user_id IS NULL',
        [topicId],
      );
      await client.query('COMMIT');
      return { deleted: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
