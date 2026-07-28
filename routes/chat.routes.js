const crypto = require('crypto');
const express = require('express');
const { normalizeCoords } = require('../services/iot-status.service');
const { maskSensitiveText } = require('../services/privacy.service');
const { saveChatTrace } = require('../services/trace.service');
const {
  loadExchangeByMessageId,
  loadServerConversationHistory,
  normalizeModelMessages,
} = require('../services/conversation-history.service');
const {
  detectKnowledgeGap,
  stripKnowledgeGapMarker,
} = require('../services/knowledge-gap.util');
const {
  getClientSessionId,
  resolveWebSession,
} = require('../services/session.service');
const {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  shouldUseDeterministicStationReply,
} = require('../services/station-response.service');

const DEFAULT_WEB_CHAT_TIMEOUT_MS = 45 * 1000;
const MAX_WEB_CHAT_TIMEOUT_MS = 55 * 1000;
const FRIENDLY_AI_ERROR_REPLY = '抱歉，AI 客服暫時連線不穩。請稍後再試，或透過客服表單補充問題：https://ecoco.tw/kWqgW';

function getWebChatTimeoutMs(env = process.env) {
  const configured = Number(env.WEB_CHAT_TIMEOUT_MS || DEFAULT_WEB_CHAT_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_WEB_CHAT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(configured), 100), MAX_WEB_CHAT_TIMEOUT_MS);
}

async function createMessageWithTimeout(client, payload, timeoutMs = getWebChatTimeoutMs()) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`Web chat AI request timed out after ${timeoutMs}ms`);
      error.code = 'WEB_CHAT_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      client.messages.create(payload, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
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

// 從請求 body 取出座標。只接受數值且在台灣範圍內；
// 座標可推定使用者位置，僅在記憶體中用於本次查詢，不落地儲存。
function getRequestCoords(body = {}) {
  return normalizeCoords(body?.coords);
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

async function storeChatExchange({
  pool,
  sessionId,
  question,
  reply,
  messageId,
  gap = { isGap: false, reason: '' },
  classification = null,
}) {
  const ts = new Date().toISOString();
  const storedQuestion = maskSensitiveText(question);
  const storedReply = maskSensitiveText(reply);

  await pool.query(
    `INSERT INTO conversations (session_id, role, content, timestamp, message_id)
     VALUES ($1, $2, $3, $4, $7), ($1, $5, $6, $4, $7)`,
    [sessionId, 'user', storedQuestion, ts, 'assistant', storedReply, messageId]
  );

  if (gap.isGap || classification?.shouldEscalate) {
    const reason = gap.isGap
      ? gap.reason
      : `Question classified as ${classification.category}: ${classification.reason || 'requires manual handling'}`;
    await pool.query(
      'INSERT INTO unanswered_questions (session_id, question, reply, reason, timestamp) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, storedQuestion, storedReply, reason, ts]
    );
  }
}

async function persistChatArtifacts({ pool, trace, exchange }) {
  const [, exchangeStored] = await Promise.all([
    saveChatTrace(pool, trace),
    storeChatExchange(exchange)
      .then(() => true)
      .catch(dbErr => {
        console.error('DB conversation write error:', dbErr.message);
        return false;
      }),
  ]);
  return exchangeStored;
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
  classifyQuestion,
  retrieveLiveStationContext = null,
  webChatTimeoutMs = getWebChatTimeoutMs(),
  sessionEnv = process.env,
}) {
  const router = express.Router();

  router.post('/chat', chatLimiter, async (req, res) => {
    const sessionId = resolveWebSession(req, res, sessionEnv);
    const { message: userMsg, error } = getLatestUserMessage(req.body || {});
    if (error) return res.status(400).json({ error });
    const messageId = crypto.randomUUID();

    const traceStart = Date.now();
    let rag = { retrievalMode: 'none', chunks: [] };
    const classification = typeof classifyQuestion === 'function'
      ? classifyQuestion(userMsg.content)
      : null;
    try {
      let modelMessages = [userMsg];
      try {
        const storedHistory = await loadServerConversationHistory(pool, sessionId);
        modelMessages = normalizeModelMessages([...storedHistory, userMsg]);
      } catch (historyErr) {
        console.error('DB conversation history read error:', historyErr.message);
      }

      if (classification?.directReply && classification.shouldUseRag === false) {
        const reply = stripKnowledgeGapMarker(classification.directReply);
        const exchangeStored = await persistChatArtifacts({
          pool,
          trace: {
            sessionId,
            channel: 'web',
            question: userMsg.content,
            rag,
            latencyMs: Date.now() - traceStart,
            questionClassification: classification,
          },
          exchange: {
            pool,
            sessionId,
            question: userMsg.content,
            reply,
            messageId,
            classification,
          },
        });

        return res.json(exchangeStored ? { reply, messageId } : { reply });
      }

      rag = await retrieveKnowledgeForQuestion(userMsg.content, {
        classification,
        ragScope: classification?.ragScope || [],
      });
      rag = await attachLiveStationContext({
        rag,
        question: userMsg.content,
        classification,
        retrieveLiveStationContext,
        coords: getRequestCoords(req.body),
      });
      const stationStatusReply = shouldUseDeterministicStationReply(userMsg.content, classification, rag.liveStationContext)
        ? buildLiveStationStatusReply(rag.liveStationContext)
        : '';
      if (stationStatusReply) {
        const exchangeStored = await persistChatArtifacts({
          pool,
          trace: {
            sessionId,
            channel: 'web',
            question: userMsg.content,
            rag,
            latencyMs: Date.now() - traceStart,
            questionClassification: classification,
          },
          exchange: {
            pool,
            sessionId,
            question: userMsg.content,
            reply: stationStatusReply,
            messageId,
            classification,
          },
        });

        return res.json(exchangeStored
          ? { reply: stationStatusReply, messageId }
          : { reply: stationStatusReply });
      }
      const runtimeGuardrails = buildRuntimeGuardrails(userMsg.content, rag);
      const response = await createMessageWithTimeout(client, {
        model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
        max_tokens: 1024,
        system: buildSystemPromptBlocks
          ? buildSystemPromptBlocks(rag.context, runtimeGuardrails)
          : [{ type: 'text', text: buildSystemPrompt(rag.context, runtimeGuardrails) }],
        messages: modelMessages,
      }, webChatTimeoutMs);

      const rawReply = response.content.find(b => b.type === 'text')?.text
        ?? '目前無法產生回覆，請稍後再試或聯絡客服。';
      const gap = detectKnowledgeGap(rawReply, response.stop_reason);
      const reply = stripKnowledgeGapMarker(rawReply);

      if (response.stop_reason === 'max_tokens') {
        console.warn(`Claude reply reached max_tokens: session=${sessionId}`);
      }

      const exchangeStored = await persistChatArtifacts({
        pool,
        trace: {
          sessionId,
          channel: 'web',
          question: userMsg.content,
          rag,
          latencyMs: Date.now() - traceStart,
          response,
          questionClassification: classification,
        },
        exchange: {
          pool,
          sessionId,
          question: userMsg.content,
          reply,
          messageId,
          gap,
          classification,
        },
      });

      res.json(exchangeStored ? { reply, messageId } : { reply });
    } catch (err) {
      console.error('Claude API error:', err.message);
      await saveChatTrace(pool, {
        sessionId,
        channel: 'web',
        question: userMsg.content,
        rag,
        latencyMs: Date.now() - traceStart,
        error: err.message,
        questionClassification: classification,
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
      const sessionId = getClientSessionId(req.headers, sessionEnv);
      const exchange = await loadExchangeByMessageId(pool, sessionId, String(msgId).substring(0, 120));
      const storedQuestion = maskSensitiveText(exchange.question).substring(0, 300);
      const storedReply = maskSensitiveText(exchange.reply).substring(0, 300);

      if (!sessionId || !storedQuestion || !storedReply) {
        return res.status(404).json({ error: 'No matching conversation found for rating.' });
      }

      await pool.query(
        `INSERT INTO ratings (msg_id, type, timestamp, question, reply)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (msg_id) WHERE msg_id <> '' DO UPDATE SET
           type = EXCLUDED.type,
           timestamp = EXCLUDED.timestamp,
           question = EXCLUDED.question,
           reply = EXCLUDED.reply`,
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
  DEFAULT_WEB_CHAT_TIMEOUT_MS,
  MAX_WEB_CHAT_TIMEOUT_MS,
  createMessageWithTimeout,
  createChatRouter,
  FRIENDLY_AI_ERROR_REPLY,
  getLatestUserMessage,
  getRequestCoords,
  getWebChatTimeoutMs,
  persistChatArtifacts,
  storeChatExchange,
  validateHistory,
};
