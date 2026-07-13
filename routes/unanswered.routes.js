const express = require('express');

const MAX_ADMIN_NOTE_CHARS = 1000;

function normalizeAdminNote(value) {
  return String(value || '').trim().slice(0, MAX_ADMIN_NOTE_CHARS);
}

function createUnansweredRouter({ pool, requireAdminKey }) {
  const router = express.Router();

  router.use(requireAdminKey);

  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, session_id, question, reply, reason, timestamp,
                COALESCE(status, 'pending') AS status,
                COALESCE(note, '') AS note,
                COALESCE(updated_at, '') AS updated_at
         FROM unanswered_questions
         ORDER BY timestamp DESC LIMIT 100`
      );
      res.json(rows);
    } catch (dbErr) {
      console.error('DB unanswered query error:', dbErr.message);
      res.status(500).json({ error: '讀取知識缺口失敗' });
    }
  });

  router.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const allowedStatuses = new Set(['pending', 'resolved', 'ignored', 'manual']);
    const status = String(req.body.status || '').trim();
    const note = normalizeAdminNote(req.body.note);

    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 格式錯誤' });
    if (!allowedStatuses.has(status)) return res.status(400).json({ error: '不支援的處理狀態' });

    try {
      const result = await pool.query(
        'UPDATE unanswered_questions SET status = $1, note = $2, updated_at = $3 WHERE id = $4',
        [status, note, new Date().toISOString(), id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: '找不到這筆知識缺口' });
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB unanswered update error:', dbErr.message);
      res.status(500).json({ error: '更新知識缺口失敗' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 格式錯誤' });

    try {
      const result = await pool.query('DELETE FROM unanswered_questions WHERE id = $1', [id]);
      if (result.rowCount === 0) return res.status(404).json({ error: '找不到這筆知識缺口' });
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB unanswered delete error:', dbErr.message);
      res.status(500).json({ error: '刪除知識缺口失敗' });
    }
  });

  return router;
}

module.exports = {
  MAX_ADMIN_NOTE_CHARS,
  createUnansweredRouter,
  normalizeAdminNote,
};
