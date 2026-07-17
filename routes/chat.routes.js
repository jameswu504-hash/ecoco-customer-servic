const crypto = require('crypto');
const express = require('express');
const { maskSensitiveText } = require('../services/privacy.service');
const { saveChatTrace } = require('../services/trace.service');

const KNOWLEDGE_GAP_MACHINE_MARKER = '[KNOWLEDGE_GAP]';
const KNOWLEDGE_GAP_META_PATTERN = /<meta>\s*({[\s\S]*?})\s*<\/meta>/i;
const KNOWLEDGE_GAP_META_STRIP_PATTERN = /<meta>\s*{[\s\S]*?}\s*<\/meta>/gi;
const KNOWLEDGE_GAP_META_INCOMPLETE_PATTERN = /<meta>(?![\s\S]*<\/meta>)[\s\S]*$/i;
const FRIENDLY_AI_ERROR_REPLY = '抱歉，AI 客服暫時連線不穩。請稍後再試，或透過客服表單補充問題：https://ecoco.tw/kWqgW';
const KNOWLEDGE_GAP_MARKERS = [
  '沒有確切資料',
  '目前沒有足夠資料',
  '建議您透過客服表單',
  '需要人工補充或確認',
];

function parseKnowledgeGapMeta(reply) {
  if (typeof reply !== 'string') return null;
  const match = reply.match(KNOWLEDGE_GAP_META_PATTERN);
  if (!match) return null;

  try {
    const meta = JSON.parse(match[1]);
    return {
      gap: Boolean(meta.gap),
      confidence: String(meta.confidence || '').trim().toLowerCase(),
      reason: String(meta.reason || '').trim(),
      raw: meta,
    };
  } catch (err) {
    return {
      gap: false,
      confidence: '',
      reason: `Invalid knowledge gap meta: ${err.message}`,
      raw: null,
    };
  }
}

function detectKnowledgeGap(reply, stopReason = '') {
  if (typeof reply !== 'string') {
    return { isGap: false, reason: '' };
  }

  if (String(stopReason || '') === 'max_tokens') {
    return {
      isGap: true,
      reason: 'AI reply truncated at max_tokens; gap meta may be missing, flagged for manual review.',
    };
  }

  const meta = parseKnowledgeGapMeta(reply);
  if (meta && meta.gap) {
    return {
      isGap: true,
      reason: `AI reply included structured knowledge gap meta: confidence=${meta.confidence || 'unknown'}${meta.reason ? `; ${meta.reason}` : ''}`,
      confidence: meta.confidence || 'unknown',
    };
  }

  if (reply.includes(KNOWLEDGE_GAP_MACHINE_MARKER)) {
    return {
      isGap: true,
      reason: `AI reply included knowledge gap marker: ${KNOWLEDGE_GAP_MACHINE_MARKER}`,
    };
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

function stripKnowledgeGapMarker(reply) {
  return String(reply || '')
    .replaceAll(KNOWLEDGE_GAP_MACHINE_MARKER, '')
    .replace(KNOWLEDGE_GAP_META_STRIP_PATTERN, '')
    .replace(KNOWLEDGE_GAP_META_INCOMPLETE_PATTERN, '')
    .trim();
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

function getLatestUserMessage(body = {}) {
  const MAX_MSG_LEN = 2000;

  if (typeof body.message === 'string') {
    const content = body.message.trim();
    if (!content) return { error: 'Missing user message.' };
    if (content.length > MAX_MSG_LEN) {
      return { error: `Message content must be under ${MAX_MSG_LEN} characters.` };
    }
    return { message: { role: 'user', content } };
  }

  const history = body.history;
  const validationError = validateHistory(history);
  if (validationError) return { error: validationError };

  const latest = history[history.length - 1];
  const content = latest.content.trim();
  if (!content) return { error: 'Missing user message.' };

  return {
    message: {
      role: 'user',
      content,
    },
  };
}

function normalizeModelMessages(messages = []) {
  const normalized = [];
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    const content = String(message.content || '').trim();
    if (!content) continue;

    const previous = normalized[normalized.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      normalized.push({ role: message.role, content });
    }
  }
  return normalized;
}

async function loadServerConversationHistory(pool, sessionId, limit = 12) {
  const { rows } = await pool.query(
    `SELECT role, content
     FROM conversations
     WHERE session_id = $1
     ORDER BY timestamp DESC, id DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return normalizeModelMessages(rows.reverse());
}

function getSafeSessionId(headers = {}) {
  const raw = String(headers['x-session-id'] || '').trim();
  if (/^session_[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw;
  return `server_${crypto.randomUUID()}`;
}

function getClientSessionId(headers = {}) {
  const raw = String(headers['x-session-id'] || '').trim();
  if (/^session_[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw;
  return null;
}

async function loadLatestExchangeForSession(pool, sessionId) {
  if (!pool || !sessionId) return { question: '', reply: '' };

  const { rows } = await pool.query(
    `SELECT role, content
     FROM conversations
     WHERE session_id = $1
     ORDER BY timestamp DESC, id DESC
     LIMIT $2`,
    [sessionId, 6]
  );

  let question = '';
  let reply = '';
  for (const row of rows) {
    if (!reply && row.role === 'assistant') {
      reply = String(row.content || '');
    } else if (reply && !question && row.role === 'user') {
      question = String(row.content || '');
      break;
    }
  }

  return { question, reply };
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
  buildSystemPromptBlocks,
  defaultAnthropicModel,
}) {
  const router = express.Router();

  router.post('/chat', chatLimiter, async (req, res) => {
    const sessionId = getSafeSessionId(req.headers);
    const { message: userMsg, error } = getLatestUserMessage(req.body || {});
    if (error) return res.status(400).json({ error });

    const traceStart = Date.now();
    let rag = { retrievalMode: 'none', chunks: [] };
    try {
      let modelMessages = [userMsg];
      try {
        const storedHistory = await loadServerConversationHistory(pool, sessionId);
        modelMessages = normalizeModelMessages([...storedHistory, userMsg]);
      } catch (historyErr) {
        console.error('DB conversation history read error:', historyErr.message);
      }

      rag = await retrieveKnowledgeForQuestion(userMsg.content);
      const runtimeGuardrails = buildRuntimeGuardrails(userMsg.content, rag);
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
        max_tokens: 1024,
        system: buildSystemPromptBlocks
          ? buildSystemPromptBlocks(rag.context, runtimeGuardrails)
          : [{ type: 'text', text: buildSystemPrompt(rag.context, runtimeGuardrails) }],
        messages: modelMessages,
      });

      const rawReply = response.content.find(b => b.type === 'text')?.text
        ?? '目前無法產生回覆，請稍後再試或聯絡客服。';
      const gap = detectKnowledgeGap(rawReply, response.stop_reason);
      const reply = stripKnowledgeGapMarker(rawReply);

      if (response.stop_reason === 'max_tokens') {
        console.warn(`Claude reply reached max_tokens: session=${sessionId}`);
      }

      await saveChatTrace(pool, {
        sessionId,
        channel: 'web',
        question: userMsg.content,
        rag,
        latencyMs: Date.now() - traceStart,
        response,
      });

      try {
        const ts = new Date().toISOString();
        const storedQuestion = maskSensitiveText(userMsg.content);
        const storedReply = maskSensitiveText(reply);
        await pool.query(
          `INSERT INTO conversations (session_id, role, content, timestamp)
           VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)`,
          [sessionId, 'user', storedQuestion, ts, 'assistant', storedReply]
        );

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
      await saveChatTrace(pool, {
        sessionId,
        channel: 'web',
        question: userMsg.content,
        rag,
        latencyMs: Date.now() - traceStart,
        error: err.message,
      });
      res.status(503).json({ error: FRIENDLY_AI_ERROR_REPLY, reply: FRIENDLY_AI_ERROR_REPLY });
    }
  });

  router.post('/rating', ratingLimiter, async (req, res) => {
    const { msgId, type } = req.body || {};
    if (!msgId || !type) return res.status(400).json({ error: 'Missing rating fields.' });
    if (!['positive', 'negative'].includes(type)) return res.status(400).json({ error: 'Invalid rating type.' });

    try {
      const ts = new Date().toISOString();
      const sessionId = getClientSessionId(req.headers);
      const latestExchange = await loadLatestExchangeForSession(pool, sessionId);
      const storedQuestion = maskSensitiveText(latestExchange.question).substring(0, 300);
      const storedReply = maskSensitiveText(latestExchange.reply).substring(0, 300);

      if (!sessionId || !storedQuestion || !storedReply) {
        return res.status(404).json({ error: 'No matching conversation found for rating.' });
      }

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
            sessionId,
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
  KNOWLEDGE_GAP_MACHINE_MARKER,
  KNOWLEDGE_GAP_MARKERS,
  createChatRouter,
  detectKnowledgeGap,
  FRIENDLY_AI_ERROR_REPLY,
  getClientSessionId,
  getLatestUserMessage,
  getSafeSessionId,
  loadLatestExchangeForSession,
  loadServerConversationHistory,
  normalizeModelMessages,
  parseKnowledgeGapMeta,
  stripKnowledgeGapMarker,
  validateHistory,
};
