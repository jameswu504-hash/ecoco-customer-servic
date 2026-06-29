const express = require('express');
const { maskSensitiveText } = require('../services/privacy.service');

const KNOWLEDGE_GAP_MARKERS = [
  '目前沒有足夠資料',
  '沒有足夠資料可確認',
  '建議您填寫客服表單',
  '需要由客服協助確認',
];

function detectKnowledgeGap(reply) {
  if (typeof reply !== 'string') {
    return { isGap: false, reason: '' };
  }

  const marker = KNOWLEDGE_GAP_MARKERS.find(text => reply.includes(text));
  if (!marker) {
    return { isGap: false, reason: '' };
  }

  return {
    isGap: true,
    reason: `AI 回覆包含知識缺口標記：「${marker}」`,
  };
}

function validateHistory(history) {
  const MAX_HISTORY = 20;
  const MAX_MSG_LEN = 2000;

  if (!Array.isArray(history) || history.length === 0) {
    return '缺少對話紀錄';
  }
  if (history.length > MAX_HISTORY) {
    return `對話紀錄最多 ${MAX_HISTORY} 則`;
  }
  if (!history.every(m => ['user', 'assistant'].includes(m.role))) {
    return '訊息角色格式錯誤';
  }
  if (history.some(m => typeof m.content !== 'string' || m.content.length > MAX_MSG_LEN)) {
    return `單則訊息最多 ${MAX_MSG_LEN} 字`;
  }
  return '';
}

function createChatRouter({
  pool,
  client,
  chatLimiter,
  requireAdminKey,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  defaultAnthropicModel,
}) {
  const router = express.Router();

  router.post('/chat', chatLimiter, async (req, res) => {
    const { history } = req.body;
    const validationError = validateHistory(history);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const userMsg = history[history.length - 1];
      const rag = await retrieveKnowledgeForQuestion(userMsg.content);
      const runtimeGuardrails = buildRuntimeGuardrails(userMsg.content, rag);
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
        max_tokens: 1024,
        system: [{ type: 'text', text: buildSystemPrompt(rag.context, runtimeGuardrails), cache_control: { type: 'ephemeral' } }],
        messages: history,
      });

      const reply = response.content.find(b => b.type === 'text')?.text
        ?? '不好意思，我剛剛沒有產生完整回覆，請再試一次。';

      try {
        const sessionId = req.headers['x-session-id'] || 'unknown';
        const ts = new Date().toISOString();
        const storedQuestion = maskSensitiveText(userMsg.content);
        const storedReply = maskSensitiveText(reply);
        await pool.query(
          'INSERT INTO conversations (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)',
          [sessionId, 'user', storedQuestion, ts]
        );
        await pool.query(
          'INSERT INTO conversations (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)',
          [sessionId, 'assistant', storedReply, ts]
        );

        const gap = detectKnowledgeGap(reply);
        if (gap.isGap) {
          await pool.query(
            'INSERT INTO unanswered_questions (session_id, question, reply, reason, timestamp) VALUES ($1, $2, $3, $4, $5)',
            [sessionId, storedQuestion, storedReply, gap.reason, ts]
          );
        }
      } catch (dbErr) {
        console.error('DB conversation write error:', dbErr.message);
      }

      res.json({
        reply,
        ragSources: rag.chunks.map(chunk => ({
          category: chunk.category,
          title: chunk.title,
          score: chunk.score,
        })),
      });
    } catch (err) {
      console.error('Claude API error:', err.message);
      res.status(500).json({ error: '客服系統暫時忙碌，請稍後再試。' });
    }
  });

  router.post('/rating', async (req, res) => {
    const { msgId, type, question, reply } = req.body;
    if (!msgId || !type) return res.status(400).json({ error: '缺少評分參數' });
    try {
      await pool.query(
        'INSERT INTO ratings (msg_id, type, timestamp, question, reply) VALUES ($1, $2, $3, $4, $5)',
        [String(msgId), type, new Date().toISOString(), maskSensitiveText(question).substring(0, 300), maskSensitiveText(reply).substring(0, 300)]
      );
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB rating insert error:', dbErr.message);
      res.status(500).json({ error: '評分儲存失敗，請稍後再試。' });
    }
  });

  router.get('/ratings', requireAdminKey, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT type, question, reply, timestamp FROM ratings WHERE question <> '' ORDER BY timestamp DESC LIMIT 50"
      );
      res.json(rows);
    } catch (dbErr) {
      console.error('DB ratings query error:', dbErr.message);
      res.status(500).json({ error: '讀取評分資料失敗' });
    }
  });

  router.get('/stats', requireAdminKey, async (req, res) => {
    try {
      const [s, m, p, n, u] = await Promise.all([
        pool.query('SELECT COUNT(DISTINCT session_id) AS count FROM conversations'),
        pool.query('SELECT COUNT(*) AS count FROM conversations'),
        pool.query("SELECT COUNT(*) AS count FROM ratings WHERE type = 'positive'"),
        pool.query("SELECT COUNT(*) AS count FROM ratings WHERE type = 'negative'"),
        pool.query('SELECT COUNT(*) AS count FROM unanswered_questions'),
      ]);
      res.json({
        totalSessions: Number(s.rows[0].count),
        totalMessages: Number(m.rows[0].count),
        positiveRatings: Number(p.rows[0].count),
        negativeRatings: Number(n.rows[0].count),
        unansweredCount: Number(u.rows[0].count),
      });
    } catch (dbErr) {
      console.error('DB stats query error:', dbErr.message);
      res.status(500).json({ error: '讀取統計資料失敗' });
    }
  });

  return router;
}

module.exports = {
  KNOWLEDGE_GAP_MARKERS,
  createChatRouter,
  detectKnowledgeGap,
  validateHistory,
};
