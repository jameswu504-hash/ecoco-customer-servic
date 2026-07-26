const crypto = require('crypto');
const express = require('express');
const {
  KNOWLEDGE_GAP_MACHINE_MARKER,
  attachLiveStationContext,
  buildLiveStationStatusReply,
  shouldUseDeterministicStationReply,
  detectKnowledgeGap,
  loadServerConversationHistory,
  normalizeModelMessages,
  stripKnowledgeGapMarker,
} = require('./chat.routes');
const { maskSensitiveText } = require('../services/privacy.service');
const { compareSecret } = require('../services/secret.service');
const { saveChatTrace } = require('../services/trace.service');

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const LINE_TEXT_LIMIT = 4900;
const LINE_MAX_INPUT_CHARS = 2000;
const LINE_FALLBACK_REPLY = '抱歉，AI 回覆暫時失敗，請稍後再試，或改由人工客服協助。';
const LINE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LINE_RATE_LIMIT_DEFAULT_MAX = 8;
const LINE_RATE_LIMIT_MAX_BUCKETS = 1000;
const LINE_RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000;
const LINE_RATE_LIMIT_REPLY = '訊息有點密集，請稍後再試一次。';
const LINE_REPLY_TIMEOUT_DEFAULT_MS = 45_000;
const LINE_REPLY_TIMEOUT_MAX_MS = 55_000;
const LINE_TIMEOUT_REPLY = '目前正在查詢資料，若問題需要人工確認，客服會再協助處理。';
// Single Render instance is fine with an in-memory bucket; move this to Redis/PostgreSQL before horizontal scaling.
const lineRateBuckets = new Map();
let lastLineRateCleanupAt = 0;

function getLineConfig(env = process.env) {
  return {
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
  };
}

function safeCompare(a, b) {
  return compareSecret(a, b);
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
  const source = event.source || {};
  const sourceId = source.type === 'group'
    ? source.groupId
    : source.type === 'room'
      ? source.roomId
      : source.userId;
  return `line_${crypto.createHash('sha256').update(sourceId || 'unknown').digest('hex').slice(0, 32)}`;
}

function getLineRateLimitMax(env = process.env) {
  const maxEvents = Number(env.LINE_RATE_LIMIT_MAX_EVENTS || LINE_RATE_LIMIT_DEFAULT_MAX);
  if (!Number.isFinite(maxEvents)) return LINE_RATE_LIMIT_DEFAULT_MAX;
  return Math.floor(maxEvents);
}

function getLineReplyTimeoutMs(env = process.env) {
  const timeoutMs = Number(env.LINE_REPLY_TIMEOUT_MS || LINE_REPLY_TIMEOUT_DEFAULT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return LINE_REPLY_TIMEOUT_DEFAULT_MS;
  return Math.min(Math.floor(timeoutMs), LINE_REPLY_TIMEOUT_MAX_MS);
}

function getLineTimeoutReply(env = process.env) {
  return String(env.LINE_TIMEOUT_REPLY || '').trim() || LINE_TIMEOUT_REPLY;
}

function cleanupLineRateBuckets(now = Date.now(), force = false) {
  if (!force && now - lastLineRateCleanupAt < LINE_RATE_LIMIT_CLEANUP_INTERVAL_MS && lineRateBuckets.size <= LINE_RATE_LIMIT_MAX_BUCKETS) {
    return lineRateBuckets.size;
  }

  lastLineRateCleanupAt = now;
  for (const [bucketKey, bucket] of lineRateBuckets.entries()) {
    if (now - bucket.windowStart >= LINE_RATE_LIMIT_WINDOW_MS) {
      lineRateBuckets.delete(bucketKey);
    }
  }

  while (lineRateBuckets.size > LINE_RATE_LIMIT_MAX_BUCKETS) {
    const oldestKey = lineRateBuckets.keys().next().value;
    if (!oldestKey) break;
    lineRateBuckets.delete(oldestKey);
  }

  return lineRateBuckets.size;
}

function resolveWithTimeout(promise, timeoutMs, timeoutValue, onTimeout = null) {
  let timer;
  return Promise.race([
    promise.then(value => ({ timedOut: false, value })),
    new Promise(resolve => {
      timer = setTimeout(() => {
        if (typeof onTimeout === 'function') {
          try {
            onTimeout();
          } catch (err) {
            console.warn('resolveWithTimeout onTimeout hook failed:', err.message);
          }
        }
        resolve({ timedOut: true, value: timeoutValue });
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isLineRateLimited(sessionId, now = Date.now(), env = process.env) {
  const maxEvents = getLineRateLimitMax(env);
  if (!maxEvents || maxEvents < 1) return false;

  cleanupLineRateBuckets(now);

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
  signal = undefined,
  classification = null,
  retrieveLiveStationContext = null,
}) {
  const question = String(text || '').trim().slice(0, LINE_MAX_INPUT_CHARS);
  const traceStart = Date.now();
  let rag = await retrieveKnowledgeForQuestion(question, {
    classification,
    ragScope: classification?.ragScope || [],
  });
  rag = await attachLiveStationContext({
    rag,
    question,
    classification,
    retrieveLiveStationContext,
  });
  const stationStatusReply = shouldUseDeterministicStationReply(question, classification, rag.liveStationContext)
    ? buildLiveStationStatusReply(rag.liveStationContext)
    : '';
  if (stationStatusReply) {
    await saveChatTrace(pool, {
      sessionId,
      channel: 'line',
      question,
      rag,
      latencyMs: Date.now() - traceStart,
      questionClassification: classification,
    });
    return stationStatusReply;
  }
  const runtimeGuardrails = buildRuntimeGuardrails(question, rag);
  const modelMessages = await buildLineModelMessages({ pool, sessionId, text: question });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
    max_tokens: 1024,
    system: buildSystemPromptBlocks
      ? buildSystemPromptBlocks(rag.context, runtimeGuardrails)
      : [{ type: 'text', text: buildSystemPrompt(rag.context, runtimeGuardrails) }],
    messages: modelMessages,
  }, signal ? { signal } : undefined);

  if (response.stop_reason === 'max_tokens') {
    console.warn(`LINE Claude reply reached max_tokens: session=${sessionId}`);
  }

  await saveChatTrace(pool, {
    sessionId,
    channel: 'line',
    question,
    rag,
    latencyMs: Date.now() - traceStart,
    response,
    questionClassification: classification,
  });

  const replyText = response.content.find(block => block.type === 'text')?.text || LINE_FALLBACK_REPLY;
  if (response.stop_reason === 'max_tokens') {
    return `${replyText}\n${KNOWLEDGE_GAP_MACHINE_MARKER}`;
  }
  return replyText;
}

function getLineWebhookEventId(event = {}) {
  return String(event.webhookEventId || '').trim().slice(0, 180);
}

async function claimLineWebhookEvent(pool, event = {}) {
  const eventId = getLineWebhookEventId(event);
  if (!eventId) return { claimed: true, eventId: '' };

  const { rows } = await pool.query(
    `INSERT INTO line_webhook_events
       (event_id, status, attempts, is_redelivery, last_error, created_at, updated_at)
     VALUES ($1, 'processing', 1, $2, '', NOW(), NOW())
     ON CONFLICT (event_id) DO UPDATE SET
       status = 'processing',
       attempts = line_webhook_events.attempts + 1,
       is_redelivery = line_webhook_events.is_redelivery OR EXCLUDED.is_redelivery,
       last_error = '',
       updated_at = NOW()
     WHERE line_webhook_events.status = 'failed'
        OR line_webhook_events.updated_at < NOW() - INTERVAL '5 minutes'
     RETURNING event_id`,
    [eventId, Boolean(event.deliveryContext?.isRedelivery)]
  );

  return { claimed: rows.length > 0, eventId };
}

async function completeLineWebhookEvent(pool, eventId, error = null) {
  if (!eventId) return;
  await pool.query(
    `UPDATE line_webhook_events
     SET status = $2,
         last_error = $3,
         updated_at = NOW()
     WHERE event_id = $1`,
    [
      eventId,
      error ? 'failed' : 'completed',
      error ? String(error.message || error).slice(0, 500) : '',
    ]
  );
}

async function storeLineConversation({
  pool,
  sessionId,
  question,
  reply,
  classification = null,
  messageId = '',
}) {
  const ts = new Date().toISOString();
  const gap = detectKnowledgeGap(reply);
  const storedQuestion = maskSensitiveText(question);
  const storedReply = maskSensitiveText(stripKnowledgeGapMarker(reply));

  await pool.query(
    `INSERT INTO conversations (session_id, role, content, timestamp, message_id)
     VALUES ($1, $2, $3, $4, $7), ($1, $5, $6, $4, $7)
     ON CONFLICT (session_id, role, message_id) WHERE message_id <> '' DO NOTHING`,
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

function createLineRouter({
  pool,
  client,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
  classifyQuestion,
  retrieveLiveStationContext = null,
  partnerService = null,
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

      let webhookClaim;
      try {
        webhookClaim = await claimLineWebhookEvent(pool, event);
      } catch (err) {
        console.error('LINE webhook event claim error:', err.message);
        continue;
      }
      if (!webhookClaim.claimed) continue;

      const sessionId = buildLineSessionId(event);
      let reply = LINE_FALLBACK_REPLY;
      let shouldStoreConversation = true;
      let webhookProcessingError = null;
      const isPartnerGroup = event.source?.type === 'group' && partnerService;
      const classification = !isPartnerGroup && typeof classifyQuestion === 'function'
        ? classifyQuestion(userText)
        : null;
      if (isLineRateLimited(sessionId)) {
        reply = LINE_RATE_LIMIT_REPLY;
        shouldStoreConversation = false;
        await saveChatTrace(pool, {
          sessionId,
          channel: 'line',
          question: userText,
          rag: { retrievalMode: 'line_rate_limited', chunks: [] },
          latencyMs: 0,
          questionClassification: classification,
        });
      } else if (isPartnerGroup) {
        shouldStoreConversation = false;
        try {
          const partnerRoute = await partnerService.routeLineGroupMessage({
            groupId: event.source.groupId,
            text: userText,
          });
          if (partnerRoute.type !== 'partner') {
            reply = partnerRoute.reply;
            await saveChatTrace(pool, {
              sessionId,
              channel: 'line_b2b',
              question: userText,
              rag: {
                retrievalMode: partnerRoute.type === 'binding'
                  ? 'partner_binding'
                  : 'partner_unbound',
                chunks: [],
              },
              latencyMs: 0,
            });
          } else {
            const timeoutMs = getLineReplyTimeoutMs();
            const timeoutReply = getLineTimeoutReply();
            const abortController = new AbortController();
            const partnerReplyPromise = partnerService.answerPartnerQuestion({
              company: partnerRoute.company,
              lineGroupId: partnerRoute.lineGroupId,
              sessionId,
              question: userText,
              channel: 'line_b2b',
              signal: abortController.signal,
            });
            const result = await resolveWithTimeout(
              partnerReplyPromise,
              timeoutMs,
              timeoutReply,
              () => abortController.abort()
            );
            reply = result.value?.reply || result.value || LINE_FALLBACK_REPLY;
            if (result.timedOut) {
              await saveChatTrace(pool, {
                sessionId,
                channel: 'line_b2b',
                question: userText,
                rag: { retrievalMode: 'partner_timeout', chunks: [] },
                latencyMs: timeoutMs,
                error: `LINE B2B reply timed out after ${timeoutMs}ms`,
              });
              partnerReplyPromise.catch(err => {
                console.warn('Late LINE B2B reply failed after timeout:', err.message);
              });
            }
          }
        } catch (err) {
          console.error('LINE B2B reply error:', err.message);
          reply = LINE_FALLBACK_REPLY;
          await saveChatTrace(pool, {
            sessionId,
            channel: 'line_b2b',
            question: userText,
            rag: { retrievalMode: 'partner_error', chunks: [] },
            error: err.message,
          });
        }
      } else if (classification?.directReply && classification.shouldUseRag === false) {
        reply = classification.directReply;
        await saveChatTrace(pool, {
          sessionId,
          channel: 'line',
          question: userText,
          rag: { retrievalMode: 'none', chunks: [] },
          latencyMs: 0,
          questionClassification: classification,
        });
      } else {
        const timeoutMs = getLineReplyTimeoutMs();
        const timeoutReply = getLineTimeoutReply();
        const abortController = new AbortController();
        const aiReplyPromise = buildAiReply({
          pool,
          sessionId,
          client,
          text: userText,
          retrieveKnowledgeForQuestion,
          buildRuntimeGuardrails,
          buildSystemPrompt,
          buildSystemPromptBlocks,
          defaultAnthropicModel,
          signal: abortController.signal,
          classification,
          retrieveLiveStationContext,
        });

        try {
          const result = await resolveWithTimeout(
            aiReplyPromise,
            timeoutMs,
            timeoutReply,
            () => abortController.abort()
          );
          reply = result.value;
          if (result.timedOut) {
            console.warn(`LINE AI reply timed out after ${timeoutMs}ms: session=${sessionId}`);
            shouldStoreConversation = false;
            await saveChatTrace(pool, {
              sessionId,
              channel: 'line',
              question: userText,
              rag: { retrievalMode: 'line_timeout', chunks: [] },
              latencyMs: timeoutMs,
              error: `LINE AI reply timed out after ${timeoutMs}ms`,
              questionClassification: classification,
            });
            aiReplyPromise.catch(err => {
              console.warn('Late LINE AI reply failed after timeout:', err.message);
            });
          }
        } catch (err) {
          console.error('LINE AI reply error:', err.message);
          await saveChatTrace(pool, {
            sessionId,
            channel: 'line',
            question: userText,
            rag: { retrievalMode: 'none', chunks: [] },
            error: err.message,
            questionClassification: classification,
          });
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
        webhookProcessingError = err;
      }

      if (shouldStoreConversation) {
        try {
          await storeLineConversation({
            pool,
            sessionId,
            question: userText,
            reply,
            classification,
            messageId: webhookClaim.eventId,
          });
        } catch (err) {
          console.error('LINE conversation write error:', err.message);
          webhookProcessingError ||= err;
        }
      }

      try {
        await completeLineWebhookEvent(pool, webhookClaim.eventId, webhookProcessingError);
      } catch (err) {
        console.error('LINE webhook event completion error:', err.message);
      }
    }
  });

  return router;
}

module.exports = {
  LINE_FALLBACK_REPLY,
  LINE_MAX_INPUT_CHARS,
  LINE_RATE_LIMIT_CLEANUP_INTERVAL_MS,
  LINE_RATE_LIMIT_DEFAULT_MAX,
  LINE_RATE_LIMIT_MAX_BUCKETS,
  LINE_RATE_LIMIT_REPLY,
  LINE_RATE_LIMIT_WINDOW_MS,
  LINE_REPLY_TIMEOUT_DEFAULT_MS,
  LINE_REPLY_TIMEOUT_MAX_MS,
  LINE_TEXT_LIMIT,
  LINE_TIMEOUT_REPLY,
  buildAiReply,
  buildLineModelMessages,
  buildLineSessionId,
  claimLineWebhookEvent,
  cleanupLineRateBuckets,
  completeLineWebhookEvent,
  createLineRouter,
  getLineConfig,
  getLineWebhookEventId,
  getLineRateLimitMax,
  getLineReplyTimeoutMs,
  getLineTimeoutReply,
  isLineRateLimited,
  replyToLine,
  resolveWithTimeout,
  safeCompare,
  storeLineConversation,
  toLineText,
  verifyLineSignature,
};
