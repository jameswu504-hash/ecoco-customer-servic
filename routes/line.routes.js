const crypto = require('crypto');
const express = require('express');
const {
  detectKnowledgeGap,
  loadServerConversationHistory,
  normalizeModelMessages,
  stripKnowledgeGapMarker,
} = require('./chat.routes');
const { maskSensitiveText } = require('../services/privacy.service');

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const LINE_TEXT_LIMIT = 4900;
const LINE_MAX_INPUT_CHARS = 2000;
const LINE_FALLBACK_REPLY = '抱歉，AI 回覆暫時失敗，請稍後再試，或改由人工客服協助。';
const LINE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LINE_RATE_LIMIT_DEFAULT_MAX = 8;
const LINE_RATE_LIMIT_MAX_BUCKETS = 5000;
const LINE_RATE_LIMIT_REPLY = '訊息有點密集，請稍後再試一次。';
const lineRateBuckets = new Map();

function getLineConfig(env = process.env) {
  return {
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
  };
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyLineSignature({ body, signature, channelSecret }) {
  if (!body || !signature || !channelSecret) return false;
  const digest = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  return safeCompare(signature, digest);
}

function toLineText(text) {
  const cleaned = String(text || '')
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 $2')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) return LINE_FALLBACK_REPLY;
  if (cleaned.length <= LINE_TEXT_LIMIT) return cleaned;
  return `${cleaned.slice(0, LINE_TEXT_LIMIT)}\n\n（回覆較長，已截斷）`;
}

async function replyToLine({ replyToken, text, channelAccessToken }) {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: toLineText(text) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE Reply API failed: ${response.status} ${body}`);
  }
}

function buildLineSessionId(event = {}) {
  const userId = event.source?.userId || event.source?.groupId || event.source?.roomId || 'unknown';
  return `line_${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32)}`;
}

function getLineRateLimitMax(env = process.env) {
  const maxEvents = Number(env.LINE_RATE_LIMIT_MAX_EVENTS || LINE_RATE_LIMIT_DEFAULT_MAX);
  if (!Number.isFinite(maxEvents)) return LINE_RATE_LIMIT_DEFAULT_MAX;
  return Math.floor(maxEvents);
}

function isLineRateLimited(sessionId, now = Date.now(), env = process.env) {
  const maxEvents = getLineRateLimitMax(env);
  if (!maxEvents || maxEvents < 1) return false;

  if (lineRateBuckets.size > LINE_RATE_LIMIT_MAX_BUCKETS) {
    for (const [bucketKey, bucket] of lineRateBuckets.entries()) {
      if (now - bucket.windowStart >= LINE_RATE_LIMIT_WINDOW_MS) {
        lineRateBuckets.delete(bucketKey);
      }
    }
  }

  const key = String(sessionId || 'unknown');
  const current = lineRateBuckets.get(key);
  if (!current || now - current.windowStart >= LINE_RATE_LIMIT_WINDOW_MS) {
    lineRateBuckets.set(key, { windowStart: now, count: 1 });
    return false;
  }

  if (current.count >= maxEvents) return true;
  current.count += 1;
  return false;
}

async function buildLineModelMessages({ pool, sessionId, text }) {
  const userMessage = {
    role: 'user',
    content: String(text || '').trim().slice(0, LINE_MAX_INPUT_CHARS),
  };

  if (!pool || !sessionId) return [userMessage];

  try {
    const storedHistory = await loadServerConversationHistory(pool, sessionId);
    return normalizeModelMessages([...storedHistory, userMessage]);
  } catch (err) {
    console.error('LINE conversation history read error:', err.message);
    return [userMessage];
  }
}

async function buildAiReply({
  pool,
  sessionId,
  client,
  text,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
}) {
  const question = String(text || '').trim().slice(0, LINE_MAX_INPUT_CHARS);
  const rag = await retrieveKnowledgeForQuestion(question);
  const runtimeGuardrails = buildRuntimeGuardrails(question, rag);
  const modelMessages = await buildLineModelMessages({ pool, sessionId, text: question });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
    max_tokens: 1024,
    system: buildSystemPromptBlocks
      ? buildSystemPromptBlocks(rag.context, runtimeGuardrails)
      : [{ type: 'text', text: buildSystemPrompt(rag.context, runtimeGuardrails) }],
    messages: modelMessages,
  });

  return response.content.find(block => block.type === 'text')?.text || LINE_FALLBACK_REPLY;
}

async function storeLineConversation({ pool, sessionId, question, reply }) {
  const ts = new Date().toISOString();
  const gap = detectKnowledgeGap(reply);
  const storedQuestion = maskSensitiveText(question);
  const storedReply = maskSensitiveText(stripKnowledgeGapMarker(reply));

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
}

function createLineRouter({
  pool,
  client,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
}) {
  const router = express.Router();

  router.post('/line/webhook', async (req, res) => {
    const config = getLineConfig();
    if (!config.channelSecret || !config.channelAccessToken) {
      return res.status(503).json({ error: 'LINE integration is not configured.' });
    }

    const isValid = verifyLineSignature({
      body: req.rawBody,
      signature: req.headers['x-line-signature'],
      channelSecret: config.channelSecret,
    });
    if (!isValid) return res.status(401).json({ error: 'Invalid LINE signature.' });

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    res.status(200).json({ ok: true });

    for (const event of events) {
      if (event.type !== 'message' || event.message?.type !== 'text' || !event.replyToken) continue;

      const userText = String(event.message.text || '').trim().slice(0, LINE_MAX_INPUT_CHARS);
      if (!userText) continue;

      const sessionId = buildLineSessionId(event);
      let reply = LINE_FALLBACK_REPLY;
      if (isLineRateLimited(sessionId)) {
        reply = LINE_RATE_LIMIT_REPLY;
      } else {
        try {
          reply = await buildAiReply({
            pool,
            sessionId,
            client,
            text: userText,
            retrieveKnowledgeForQuestion,
            buildRuntimeGuardrails,
            buildSystemPrompt,
            buildSystemPromptBlocks,
            defaultAnthropicModel,
          });
        } catch (err) {
          console.error('LINE AI reply error:', err.message);
        }
      }

      try {
        await replyToLine({
          replyToken: event.replyToken,
          text: stripKnowledgeGapMarker(reply),
          channelAccessToken: config.channelAccessToken,
        });
      } catch (err) {
        console.error('LINE Reply API error:', err.message);
      }

      try {
        await storeLineConversation({ pool, sessionId, question: userText, reply });
      } catch (err) {
        console.error('LINE conversation write error:', err.message);
      }
    }
  });

  return router;
}

module.exports = {
  LINE_FALLBACK_REPLY,
  LINE_MAX_INPUT_CHARS,
  LINE_RATE_LIMIT_DEFAULT_MAX,
  LINE_RATE_LIMIT_REPLY,
  LINE_RATE_LIMIT_WINDOW_MS,
  LINE_TEXT_LIMIT,
  buildAiReply,
  buildLineModelMessages,
  buildLineSessionId,
  createLineRouter,
  getLineConfig,
  getLineRateLimitMax,
  isLineRateLimited,
  replyToLine,
  storeLineConversation,
  toLineText,
  verifyLineSignature,
};
