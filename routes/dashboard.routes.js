const express = require('express');

function getLimit(value, fallback, max) {
  const limit = Number(value || fallback);
  if (!Number.isInteger(limit) || limit <= 0) return fallback;
  return Math.min(limit, max);
}

function escapeIlikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

function createDashboardRouter({ pool, requireAdminKey }) {
  const router = express.Router();

  router.use(requireAdminKey);

  async function attachMessagesToSessions(sessions) {
    if (sessions.length === 0) return [];
    const ids = sessions.map(session => session.session_id);
    const { rows: messages } = await pool.query(
      `SELECT session_id, role, content, timestamp
       FROM conversations
       WHERE session_id = ANY($1::text[])
       ORDER BY session_id ASC, timestamp ASC, id ASC`,
      [ids]
    );

    const bySession = new Map(ids.map(id => [id, []]));
    for (const message of messages) {
      bySession.get(message.session_id)?.push({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      });
    }

    return sessions.map(session => ({
      ...session,
      message_count: Number(session.message_count),
      messages: bySession.get(session.session_id) || [],
    }));
  }

  router.get('/sessions', async (req, res) => {
    const limit = getLimit(req.query.limit, 10, 200);
    const offsetRaw = Number(req.query.offset || 0);
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    try {
      const { rows: countRows } = await pool.query(
        'SELECT COUNT(DISTINCT session_id) AS total FROM conversations'
      );
      const total = Number(countRows[0]?.total || 0);
      const { rows: sessions } = await pool.query(`
        WITH session_rows AS (
          SELECT session_id,
                 COUNT(*)       AS message_count,
                 MIN(timestamp) AS started_at,
                 MAX(timestamp) AS last_at
          FROM conversations
          GROUP BY session_id
          ORDER BY started_at DESC
          LIMIT $1 OFFSET $2
        ),
        latest_trace AS (
          SELECT DISTINCT ON (session_id)
                 session_id,
                 question_category_label,
                 question_category_confidence
          FROM chat_traces
          WHERE session_id IN (SELECT session_id FROM session_rows)
          ORDER BY session_id, timestamp DESC, id DESC
        )
        SELECT session_rows.*,
               COALESCE(latest_trace.question_category_label, '') AS question_category_label,
               COALESCE(latest_trace.question_category_confidence, '') AS question_category_confidence
        FROM session_rows
        LEFT JOIN latest_trace USING (session_id)
        ORDER BY session_rows.started_at DESC
      `, [limit, offset]);
      res.json({
        total,
        limit,
        offset,
        sessions: sessions.map(session => ({
          ...session,
          message_count: Number(session.message_count),
        })),
      });
    } catch (dbErr) {
      console.error('DB sessions query error:', dbErr.message);
      res.status(500).json({ error: '讀取對話紀錄失敗' });
    }
  });

  router.get('/session-messages', async (req, res) => {
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId || sessionId.length > 200) {
      return res.status(400).json({ error: 'session_id 格式錯誤' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT role, content, timestamp
         FROM conversations
         WHERE session_id = $1
         ORDER BY timestamp ASC, id ASC
         LIMIT 500`,
        [sessionId]
      );
      return res.json(rows);
    } catch (dbErr) {
      console.error('DB session messages query error:', dbErr.message);
      return res.status(500).json({ error: '讀取對話內容失敗' });
    }
  });

  router.get('/top-questions', async (req, res) => {
    const limit = getLimit(req.query.limit, 1000, 5000);
    try {
      const { rows: userMessages } = await pool.query(
        "SELECT content FROM conversations WHERE role = 'user' ORDER BY timestamp DESC LIMIT $1",
        [limit]
      );
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
    const limit = getLimit(req.query.limit, 30, 100);
    const pattern = `%${escapeIlikePattern(q)}%`;

    try {
      const { rows: sessions } = await pool.query(`
        SELECT session_id, MIN(timestamp) AS started_at, COUNT(*) AS message_count
        FROM conversations
        WHERE content ILIKE $1 ESCAPE '\\'
        GROUP BY session_id
        ORDER BY started_at DESC
        LIMIT $2
      `, [pattern, limit]);
      res.json(await attachMessagesToSessions(sessions));
    } catch (dbErr) {
      console.error('DB search error:', dbErr.message);
      res.status(500).json({ error: '搜尋失敗' });
    }
  });

  return router;
}

module.exports = { createDashboardRouter, escapeIlikePattern, getLimit };
