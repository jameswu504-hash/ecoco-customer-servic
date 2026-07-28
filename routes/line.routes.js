const crypto = require('crypto');
const express = require('express');
const {
  loadServerConversationHistory,
  normalizeModelMessages,
} = require('../services/conversation-history.service');
const {
  detectKnowledgeGap,
  KNOWLEDGE_GAP_MACHINE_MARKER,
  stripKnowledgeGapMarker,
} = require('../services/knowledge-gap.util');
const { normalizeCoords } = require('../services/iot-status.service');
const { maskSensitiveText } = require('../services/privacy.service');
const { compareSecret } = require('../services/secret.service');
const {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  shouldUseDeterministicStationReply,
} = require('../services/station-response.service');
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
const LINE_INVALID_LOCATION_REPLY = '無法讀取這個位置，請重新傳送 LINE 位置資訊，或改用文字告訴我附近的縣市、路名或地標。';
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

function parseLineLocationMessage(message = {}) {
  const coords = normalizeCoords({
    lat: message.latitude,
    lng: message.longitude,
    label: message.title || message.address || '',
  });
  if (!coords) {
    return {
      coords: null,
      text: 'LINE 位置資訊無效',
      errorReply: LINE_INVALID_LOCATION_REPLY,
    };
  }
  return {
    coords,
    text: coords.label
      ? `查詢「${coords.label}」附近的 ECOCO 站點`
      : '查詢我附近的 ECOCO 站點',
    errorReply: '',
  };
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

function buildLineRateLimitKey(event = {}) {
  const source = event.source || {};
  const sourceId = source.userId
    || source.groupId
    || source.roomId
    || 'unknown';
  return `line_rate_${crypto.createHash('sha256').update(String(sourceId)).digest('hex').slice(0, 32)}`;
}

function isLineBotMentioned(message = {}) {
  const mentionees = Array.isArray(message.mention?.mentionees)
    ? message.mention.mentionees
    : [];
  return mentionees.some(mentionee => (
    mentionee?.type === 'user' && mentionee.isSelf === true
  ));
}

function stripLineBotMentions(message = {}) {
  let text = String(message.text || '');
  const ranges = (Array.isArray(message.mention?.mentionees)
    ? message.mention.mentionees
    : [])
    .filter(mentionee => (
      mentionee?.type === 'user'
      && mentionee.isSelf === true
      && Number.isInteger(mentionee.index)
      && Number.isInteger(mentionee.length)
      && mentionee.index >= 0
      && mentionee.length > 0
    ))
    .sort((a, b) => b.index - a.index);

  for (const range of ranges) {
    text = `${text.slice(0, range.index)}${text.slice(range.index + range.length)}`;
  }
  return text.replace(/\s+/g, ' ').trim();
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
  coords = null,
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
    coords,
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
        OR (line_webhook_events.status = 'processing'
            AND line_webhook_events.updated_at < NOW() - INTERVAL '5 minutes')
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
      const isTextMessage = event.message?.type === 'text';
      const isLocationMessage = event.message?.type === 'location';
      if (event.type !== 'message' || (!isTextMessage && !isLocationMessage) || !event.replyToken) continue;

      // LINE 位置訊息：使用者按「＋ → 位置資訊」送出，內含精確經緯度。
      // 座標只在本次請求記憶體中使用，對話紀錄僅落地 label。
      let userCoords = null;
      let userText = '';
      let locationErrorReply = '';
      if (isLocationMessage) {
        const locationInput = parseLineLocationMessage(event.message);
        userCoords = locationInput.coords;
        userText = locationInput.text;
        locationErrorReply = locationInput.errorReply;
      } else {
        userText = String(event.message.text || '').trim().slice(0, LINE_MAX_INPUT_CHARS);
      }
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
      const rateLimitKey = buildLineRateLimitKey(event);
      let reply = LINE_FALLBACK_REPLY;
      let shouldStoreConversation = true;
      let webhookProcessingError = null;
      const isPartnerGroup = event.source?.type === 'group' && partnerService;
      let partnerRoute = null;
      if (isPartnerGroup) {
        try {
          partnerRoute = await partnerService.routeLineGroupMessage({
            groupId: event.source.groupId,
            text: userText,
          });
        } catch (err) {
          console.error('LINE B2B routing error:', err.message);
        }

        const isBindingMessage = partnerRoute?.type === 'binding';
        const shouldReply = isBindingMessage || isLineBotMentioned(event.message);
        if (!shouldReply) {
          if (partnerRoute?.type === 'partner') {
            try {
              await partnerService.storePartnerMessage({
                companyId: partnerRoute.company.id,
                lineGroupId: partnerRoute.lineGroupId,
                sessionId,
                role: 'user',
                content: userText,
              });
            } catch (err) {
              console.error('LINE B2B passive conversation write error:', err.message);
              webhookProcessingError = err;
            }
          }
          try {
            await completeLineWebhookEvent(pool, webhookClaim.eventId, webhookProcessingError);
          } catch (err) {
            console.error('LINE webhook event completion error:', err.message);
          }
          continue;
        }

        if (partnerRoute?.type === 'partner' && isTextMessage) {
          userText = stripLineBotMentions(event.message) || '你好';
        }
      }
      const classification = !isPartnerGroup && typeof classifyQuestion === 'function'
        ? classifyQuestion(userText)
        : null;
      if (isLineRateLimited(rateLimitKey)) {
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
      } else if (locationErrorReply) {
        reply = locationErrorReply;
        shouldStoreConversation = false;
        await saveChatTrace(pool, {
          sessionId,
          channel: isPartnerGroup ? 'line_b2b' : 'line',
          question: userText,
          rag: { retrievalMode: 'line_invalid_location', chunks: [] },
          latencyMs: 0,
          questionClassification: classification,
        });
      } else if (isPartnerGroup) {
        shouldStoreConversation = false;
        try {
          partnerRoute ||= await partnerService.routeLineGroupMessage({
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
              coords: userCoords,
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
          coords: userCoords,
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
  LINE_INVALID_LOCATION_REPLY,
  LINE_RATE_LIMIT_WINDOW_MS,
  LINE_REPLY_TIMEOUT_DEFAULT_MS,
  LINE_REPLY_TIMEOUT_MAX_MS,
  LINE_TEXT_LIMIT,
  LINE_TIMEOUT_REPLY,
  buildAiReply,
  buildLineModelMessages,
  buildLineSessionId,
  buildLineRateLimitKey,
  claimLineWebhookEvent,
  cleanupLineRateBuckets,
  completeLineWebhookEvent,
  createLineRouter,
  getLineConfig,
  getLineWebhookEventId,
  getLineRateLimitMax,
  getLineReplyTimeoutMs,
  getLineTimeoutReply,
  isLineBotMentioned,
  isLineRateLimited,
  parseLineLocationMessage,
  replyToLine,
  resolveWithTimeout,
  safeCompare,
  storeLineConversation,
  stripLineBotMentions,
  toLineText,
  verifyLineSignature,
};
