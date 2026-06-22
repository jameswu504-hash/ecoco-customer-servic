const express = require('express');

function createDashboardRouter({ pool, requireAdminKey }) {
  const router = express.Router();

  router.use(requireAdminKey);

  router.get('/sessions', async (req, res) => {
    try {
      const { rows: sessions } = await pool.query(`
        SELECT session_id,
               COUNT(*)       AS message_count,
               MIN(timestamp) AS started_at,
               MAX(timestamp) AS last_at
        FROM conversations
        GROUP BY session_id
        ORDER BY started_at DESC
      `);
      const result = [];
      for (const s of sessions) {
        const { rows: messages } = await pool.query(
          'SELECT role, content, timestamp FROM conversations WHERE session_id = $1 ORDER BY timestamp ASC',
          [s.session_id]
        );
        result.push({ ...s, message_count: Number(s.message_count), messages });
      }
      res.json(result);
    } catch (dbErr) {
      console.error('DB sessions query error:', dbErr.message);
      res.status(500).json({ error: '讀取對話紀錄失敗' });
    }
  });

  router.get('/top-questions', async (req, res) => {
    try {
      const { rows: userMessages } = await pool.query("SELECT content FROM conversations WHERE role = 'user'");
      const keywordList = [
        '點數',
        '兌換',
        '寶特瓶',
        '電池',
        '全聯',
        '全家',
        '康達盛通',
        '站點',
        'App',
        '帳號',
        '密碼',
        '壓扁',
        '期限',
        '合作',
      ];
      const keywords = {};
      userMessages.forEach(({ content }) => {
        keywordList.forEach(kw => {
          if (content.includes(kw)) keywords[kw] = (keywords[kw] || 0) + 1;
        });
      });
      res.json(
        Object.entries(keywords)
          .sort((a, b) => b[1] - a[1])
          .map(([keyword, count]) => ({ keyword, count }))
      );
    } catch (dbErr) {
      console.error('DB top questions query error:', dbErr.message);
      res.status(500).json({ error: '讀取熱門問題失敗' });
    }
  });

  router.get('/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: '請輸入至少 2 個字' });

    try {
      const { rows: sessions } = await pool.query(`
        SELECT session_id, MIN(timestamp) AS started_at, COUNT(*) AS message_count
        FROM conversations WHERE content LIKE $1 GROUP BY session_id ORDER BY started_at DESC LIMIT 30
      `, [`%${q}%`]);
      const result = [];
      for (const s of sessions) {
        const { rows: messages } = await pool.query(
          'SELECT role, content, timestamp FROM conversations WHERE session_id = $1 ORDER BY timestamp ASC',
          [s.session_id]
        );
        result.push({ ...s, message_count: Number(s.message_count), messages });
      }
      res.json(result);
    } catch (dbErr) {
      console.error('DB search error:', dbErr.message);
      res.status(500).json({ error: '搜尋失敗' });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
