const crypto = require('crypto');
const express = require('express');
const { maskSensitiveText } = require('../services/privacy.service');

const KNOWLEDGE_GAP_MARKERS = [
  '沒有確切資料',
  '目前沒有足夠資料',
  '建議您透過客服表單',
  '需要人工補充或確認',
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
  const MAX_TOTAL_CHARS = 8000;

  if (!Array.isArray(history) || history.length === 0) {
    return 'Missing conversation history.';
  }
  if (history.length > MAX_HISTORY) {
    return `Conversation history must be at most ${MAX_HISTORY} messages.`;
  }
  if (!history.every(m => m && typeof m === 'object' && !Array.isArray(m))) {
    return 'Invalid message format.';
  }
  if (!history.every(m => ['user', 'assistant'].includes(m.role))) {
    return 'Conversation role must be user or assistant.';
  }
  if (history[history.length - 1].role !== 'user') {
    return 'The last conversation message must be from user.';
  }
  if (history.some(m => typeof m.content !== 'string' || m.content.length > MAX_MSG_LEN)) {
    return `Each message content must be a string under ${MAX_MSG_LEN} characters.`;
  }
  const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return `Conversation history must be under ${MAX_TOTAL_CHARS} total characters.`;
  }
  return '';
}

function getSafeSessionId(headers = {}) {
  const raw = String(headers['x-session-id'] || '').trim();
  if (/^session_[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw;
  return `server_${crypto.randomUUID()}`;
}

function createChatRouter({
  pool,
  client,
  chatLimiter,
  ratingLimiter,
  requireAdminKey,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  defaultAnthropicModel,
}) {
  const router = express.Router();

  router.post('/chat', chatLimiter, async (req, res) => {
    const { history } = req.body || {};
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
        ?? '目前無法產生回覆，請稍後再試或聯絡客服。';

      try {
        const sessionId = getSafeSessionId(req.headers);
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

      res.json({ reply });
    } catch (err) {
      console.error('Claude API error:', err.message);
      res.status(500).json({ error: 'AI response failed. Please try again later.' });
    }
  });

  router.post('/rating', ratingLimiter, async (req, res) => {
    const { msgId, type, question, reply } = req.body || {};
    if (!msgId || !type) return res.status(400).json({ error: 'Missing rating fields.' });
    if (!['positive', 'negative'].includes(type)) return res.status(400).json({ error: 'Invalid rating type.' });

    try {
      const ts = new Date().toISOString();
      const storedQuestion = maskSensitiveText(question).substring(0, 300);
      const storedReply = maskSensitiveText(reply).substring(0, 300);

      await pool.query(
        'INSERT INTO ratings (msg_id, type, timestamp, question, reply) VALUES ($1, $2, $3, $4, $5)',
        [
          String(msgId).substring(0, 120),
          type,
          ts,
          storedQuestion,
          storedReply,
        ]
      );

      if (type === 'negative' && storedQuestion) {
        await pool.query(
          'INSERT INTO unanswered_questions (session_id, question, reply, reason, timestamp) VALUES ($1, $2, $3, $4, $5)',
          [
            getSafeSessionId(req.headers),
            storedQuestion,
            storedReply,
            '使用者點選「需改善」，請客服確認是否需要補充或修正知識庫。',
            ts,
          ]
        );
      }

      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB rating insert error:', dbErr.message);
      res.status(500).json({ error: 'Failed to save rating.' });
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
      res.status(500).json({ error: 'Failed to load ratings.' });
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
      res.status(500).json({ error: 'Failed to load stats.' });
    }
  });

  return router;
}

module.exports = {
  KNOWLEDGE_GAP_MARKERS,
  createChatRouter,
  detectKnowledgeGap,
  getSafeSessionId,
  validateHistory,
};
