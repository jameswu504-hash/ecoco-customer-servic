const crypto = require('crypto');

const { normalizeCoords } = require('./iot-status.service');
const { compareSecret } = require('./secret.service');

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const LINE_TEXT_LIMIT = 4900;
const LINE_MAX_INPUT_CHARS = 2000;
const LINE_FALLBACK_REPLY = '抱歉，AI 回覆暫時失敗，請稍後再試，或改由人工客服協助。';
const LINE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LINE_RATE_LIMIT_DEFAULT_MAX = 8;
const LINE_RATE_LIMIT_MAX_BUCKETS = 1000;
const LINE_RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000;
const LINE_RATE_LIMIT_REPLY = '訊息有點密集，請稍後再試一次。';
const LINE_INVALID_LOCATION_REPLY = '無法讀取這個位置，請重新傳送 LINE 位置資訊，或改用文字告訴我附近的縣市、路名或地標。';
const LINE_REPLY_TIMEOUT_DEFAULT_MS = 25_000;
const LINE_REPLY_TIMEOUT_MAX_MS = 25_000;
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
    const error = new Error(`LINE Reply API failed: ${response.status} ${body}`);
    error.status = response.status;
    error.responseBody = body;
    throw error;
  }
}

async function pushToLine({ to, text, channelAccessToken }) {
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: toLineText(text) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`LINE Push API failed: ${response.status} ${body}`);
    error.status = response.status;
    error.responseBody = body;
    throw error;
  }
}

function getLineMessageDestination(event = {}) {
  const source = event.source || {};
  return source.groupId || source.roomId || source.userId || '';
}

function isInvalidLineReplyTokenError(error) {
  const details = `${error?.message || ''} ${error?.responseBody || ''}`;
  return Number(error?.status) === 400 && /invalid reply token/i.test(details);
}

async function deliverLineMessage({
  event,
  text,
  channelAccessToken,
}, {
  replyFn = replyToLine,
  pushFn = pushToLine,
} = {}) {
  try {
    await replyFn({
      replyToken: event?.replyToken,
      text,
      channelAccessToken,
    });
    return { deliveryMode: 'reply' };
  } catch (replyError) {
    const to = getLineMessageDestination(event);
    if (!to || !isInvalidLineReplyTokenError(replyError)) throw replyError;
    await pushFn({ to, text, channelAccessToken });
    return { deliveryMode: 'push', replyError };
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

function createInFlightTaskTracker() {
  const activeTasks = new Set();

  function begin() {
    let finished = false;
    let resolveTask;
    const task = new Promise(resolve => {
      resolveTask = resolve;
    });
    activeTasks.add(task);

    return () => {
      if (finished) return;
      finished = true;
      activeTasks.delete(task);
      resolveTask();
    };
  }

  async function waitForIdle(timeoutMs = 30_000) {
    const pendingTasks = [...activeTasks];
    if (pendingTasks.length === 0) return true;

    let timer;
    const completed = Promise.allSettled(pendingTasks).then(() => true);
    const timedOut = new Promise(resolve => {
      timer = setTimeout(() => resolve(false), Math.max(1, Number(timeoutMs) || 30_000));
      timer.unref?.();
    });
    return Promise.race([completed, timedOut]).finally(() => clearTimeout(timer));
  }

  return {
    begin,
    size: () => activeTasks.size,
    waitForIdle,
  };
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

module.exports = {
  LINE_FALLBACK_REPLY,
  LINE_INVALID_LOCATION_REPLY,
  LINE_MAX_INPUT_CHARS,
  LINE_PUSH_ENDPOINT,
  LINE_RATE_LIMIT_CLEANUP_INTERVAL_MS,
  LINE_RATE_LIMIT_DEFAULT_MAX,
  LINE_RATE_LIMIT_MAX_BUCKETS,
  LINE_RATE_LIMIT_REPLY,
  LINE_RATE_LIMIT_WINDOW_MS,
  LINE_REPLY_TIMEOUT_DEFAULT_MS,
  LINE_REPLY_TIMEOUT_MAX_MS,
  LINE_REPLY_ENDPOINT,
  LINE_TEXT_LIMIT,
  LINE_TIMEOUT_REPLY,
  buildLineRateLimitKey,
  buildLineSessionId,
  claimLineWebhookEvent,
  cleanupLineRateBuckets,
  completeLineWebhookEvent,
  createInFlightTaskTracker,
  deliverLineMessage,
  getLineConfig,
  getLineMessageDestination,
  getLineRateLimitMax,
  getLineReplyTimeoutMs,
  getLineTimeoutReply,
  isLineRateLimited,
  isInvalidLineReplyTokenError,
  parseLineLocationMessage,
  pushToLine,
  replyToLine,
  resolveWithTimeout,
  safeCompare,
  toLineText,
  verifyLineSignature,
};
