const crypto = require('crypto');
const express = require('express');
const { maskSensitiveText } = require('../services/privacy.service');
const { saveChatTrace } = require('../services/trace.service');

const KNOWLEDGE_GAP_MACHINE_MARKER = '[KNOWLEDGE_GAP]';
const KNOWLEDGE_GAP_META_PATTERN = /<meta>\s*({[\s\S]*?})\s*<\/meta>/i;
const KNOWLEDGE_GAP_META_STRIP_PATTERN = /<meta>\s*{[\s\S]*?}\s*<\/meta>/gi;
const KNOWLEDGE_GAP_META_INCOMPLETE_PATTERN = /<meta>(?![\s\S]*<\/meta>)[\s\S]*$/i;
const DEFAULT_WEB_CHAT_TIMEOUT_MS = 45 * 1000;
const MAX_WEB_CHAT_TIMEOUT_MS = 55 * 1000;
const WEB_SESSION_COOKIE_NAME = 'ecoco_session';
const WEB_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('base64url');
const FRIENDLY_AI_ERROR_REPLY = '抱歉，AI 客服暫時連線不穩。請稍後再試，或透過客服表單補充問題：https://ecoco.tw/kWqgW';
const KNOWLEDGE_GAP_MARKERS = [
  '沒有確切資料',
  '目前沒有足夠資料',
  '建議您透過客服表單',
  '需要人工補充或確認',
];

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

function getSessionSecret(env = process.env) {
  return String(env.SESSION_SECRET || env.ADMIN_KEY || EPHEMERAL_SESSION_SECRET);
}

function signSessionId(sessionId, env = process.env) {
  return crypto
    .createHmac('sha256', getSessionSecret(env))
    .update(sessionId)
    .digest('base64url');
}

function createSignedSessionCookieValue(sessionId, env = process.env) {
  return `${sessionId}.${signSessionId(sessionId, env)}`;
}

function getCookieValue(headers = {}, name = WEB_SESSION_COOKIE_NAME) {
  const rawCookie = String(headers.cookie || '');
  for (const part of rawCookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function getClientSessionId(headers = {}, env = process.env) {
  const token = getCookieValue(headers);
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;

  const sessionId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^session_[A-Za-z0-9_-]{8,80}$/.test(sessionId)) return null;

  const expected = signSessionId(sessionId, env);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  return sessionId;
}

function getSafeSessionId(headers = {}, env = process.env) {
  return getClientSessionId(headers, env)
    || `session_${crypto.randomUUID().replaceAll('-', '')}`;
}

function setWebSessionCookie(res, sessionId, headers = {}, env = process.env) {
  const secure = env.NODE_ENV === 'production'
    || String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
  const parts = [
    `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(createSignedSessionCookieValue(sessionId, env))}`,
    'Path=/',
    `Max-Age=${WEB_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function resolveWebSession(req, res, env = process.env) {
  const existing = getClientSessionId(req.headers, env);
  if (existing) return existing;

  const sessionId = getSafeSessionId({}, env);
  setWebSessionCookie(res, sessionId, req.headers, env);
  return sessionId;
}

async function loadExchangeByMessageId(pool, sessionId, messageId) {
  if (!pool || !sessionId || !messageId) return { question: '', reply: '' };

  const { rows } = await pool.query(
    `SELECT role, content
     FROM conversations
     WHERE session_id = $1
       AND message_id = $2
     ORDER BY timestamp ASC, id ASC`,
    [sessionId, messageId]
  );

  let question = '';
  let reply = '';
  for (const row of rows) {
    if (!question && row.role === 'user') {
      question = String(row.content || '');
    } else if (!reply && row.role === 'assistant') {
      reply = String(row.content || '');
    }
  }

  return { question, reply };
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

async function attachLiveStationContext({
  rag,
  question,
  classification,
  retrieveLiveStationContext,
}) {
  if (typeof retrieveLiveStationContext !== 'function') return rag;

  try {
    const live = await retrieveLiveStationContext(question, { classification });
    const hasTrustedMiss = live.retrievalMode === 'postgres_iot_miss'
      && Array.isArray(live.terms)
      && live.terms.length > 0;
    if (!live.context && !hasTrustedMiss) return rag;
    const retrievalModes = [rag.retrievalMode, live.retrievalMode]
      .filter(mode => mode && mode !== 'none');
    return {
      ...rag,
      retrievalMode: retrievalModes.length > 0 ? retrievalModes.join('+') : rag.retrievalMode,
      context: [rag.context, live.context].filter(Boolean).join('\n\n'),
      liveStationContext: live,
    };
  } catch (err) {
    console.error('Live station context lookup error:', err.message);
    return rag;
  }
}

function formatStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '未知';
  if (['up', 'online', 'normal', 'ok'].includes(status)) return '正常';
  if (['down', 'offline'].includes(status)) return '離線';
  return String(value);
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatCapacity(slotName, count, max, remain) {
  if (!hasNumber(count) && !hasNumber(max) && !hasNumber(remain)) {
    return `${slotName}：目前還沒有容量數字`;
  }

  const remainText = hasNumber(remain) ? `剩餘 ${remain}` : '剩餘量未知';
  const usageText = hasNumber(count) && hasNumber(max) ? `目前 ${count}/${max}` : '';
  const fullHint = hasNumber(remain) && Number(remain) === 0 ? '（目前看起來已滿）' : '';
  return `${slotName}：${[remainText, usageText].filter(Boolean).join('，')}${fullHint}`;
}

function buildLiveStationStatusReply(liveStationContext = null) {
  const rows = Array.isArray(liveStationContext?.rows) ? liveStationContext.rows : [];
  if (rows.length === 0) {
    if (liveStationContext?.retrievalMode !== 'postgres_iot_miss') return '';
    const terms = Array.isArray(liveStationContext?.terms) ? liveStationContext.terms : [];
    const location = terms[0] || '\u9019\u500b\u5730\u5340';
    return [
      '\u53ef\u53ef\u7c89\uff0c\u6211\u6709\u5e6b\u4f60\u67e5\u8a62 ECOCO \u7ad9\u9ede\u8cc7\u6599\u3002',
      '',
      `\u76ee\u524d\u5728\u300c${location}\u300d\u6c92\u6709\u67e5\u5230\u7ad9\u9ede\u3002`,
      '',
      '\u4f60\u53ef\u4ee5\u518d\u544a\u8a34\u6211\u9644\u8fd1\u7684\u6377\u904b\u7ad9\u3001\u8def\u540d\u6216\u5730\u6a19\uff0c\u6211\u518d\u5e6b\u4f60\u67e5\u67e5\u770b\u3002',
    ].join('\n');
  }

  const uniqueRows = [];
  const seenStations = new Set();
  for (const row of rows) {
    const fallbackKey = [row.stationName, row.address].filter(Boolean).join('|');
    const key = String(row.stationCode || fallbackKey).trim();
    if (key && seenStations.has(key)) continue;
    if (key) seenStations.add(key);
    uniqueRows.push(row);
  }

  const displayedRows = uniqueRows.slice(0, 3);
  const matchedStationCount = Number(liveStationContext?.matchedStationCount);
  if (liveStationContext?.queryIntent?.asksCount && Number.isFinite(matchedStationCount)) {
    const terms = Array.isArray(liveStationContext?.terms) ? liveStationContext.terms : [];
    const location = terms[0] || '\u9019\u500b\u5730\u5340';
    const lines = [
      '\u53ef\u53ef\u7c89\uff0c\u6211\u6709\u5e6b\u4f60\u67e5\u8a62 ECOCO \u7ad9\u9ede\u8cc7\u6599\u3002',
      '',
      `\u4f9d\u76ee\u524d\u540c\u6b65\u5230\u7684\u7ad9\u9ede\u8cc7\u6599\uff0c\u300c${location}\u300d\u5171\u6709 ${matchedStationCount} \u500b ECOCO \u7ad9\u9ede\u3002`,
    ];

    if (displayedRows.length > 0) {
      lines.push('', '\u5176\u4e2d\u5305\u542b\uff1a');
      displayedRows.forEach((row, index) => {
        const name = row.stationName || row.stationCode || `\u7ad9\u9ede ${index + 1}`;
        lines.push(
          `${index + 1}. ${name}`,
          `\u5730\u5740\uff1a${row.address || '\u672a\u63d0\u4f9b'}`
        );
      });
    }

    if (liveStationContext?.isStale === true) {
      lines.push(
        '',
        '\u7ad9\u9ede\u8cc7\u6599\u76ee\u524d\u6c92\u6709\u5728\u9810\u671f\u6642\u9593\u5167\u66f4\u65b0\uff0c\u6578\u91cf\u53ef\u80fd\u4e0d\u662f\u6700\u65b0\u72c0\u614b\u3002'
      );
    }
    return lines.join('\n');
  }

  if (liveStationContext?.isStale === true) {
    const lines = [
      '可可粉，站點資料目前沒有在預期時間內更新，所以我暫時不能確認最新的機台狀態或回收槽容量。',
      '',
      '目前可以確認的站點位置：',
    ];
    displayedRows.forEach((row, index) => {
      const name = row.stationName || row.stationCode || `站點 ${index + 1}`;
      lines.push(
        displayedRows.length > 1 ? `${index + 1}. ${name}` : name,
        `地址：${row.address || '未知'}`
      );
    });
    lines.push('', '建議出發前先查看 ECOCO App；若現場有異常，也可以透過客服表單回報，我們會協助確認。');
    return lines.join('\n');
  }

  const lines = displayedRows.length > 1
    ? ['可可粉，幫你找到幾個可能適合的 ECOCO 站點囉：']
    : ['可可粉，幫你查到這個站點目前的狀況囉：'];
  displayedRows.forEach((row, index) => {
    const name = row.stationName || row.stationCode || `站點 ${index + 1}`;
    lines.push(
      '',
      displayedRows.length > 1 ? `${index + 1}. ${name}` : name,
      `地址：${row.address || '未知'}`,
      '',
      '目前狀態',
      `機台：${formatStatus(row.machineStatus || row.stationStatus)}`,
      `連線：${formatStatus(row.lastConnectionStatus)}`,
      '',
      '回收槽容量',
      formatCapacity('第 1 槽', row.bin1Count, row.bin1MaxCapacity, row.bin1RemainCapacity),
      formatCapacity('第 2 槽', row.bin2Count, row.bin2MaxCapacity, row.bin2RemainCapacity),
    );
  });

  lines.push('', '如果你到現場看到的狀態和這裡不一樣，可以直接透過 App 或客服表單回報，我們會協助確認。');
  return lines.join('\n');
}

function shouldUseDeterministicStationReply(question, classification = null, liveStationContext = null) {
  const rows = Array.isArray(liveStationContext?.rows) ? liveStationContext.rows : [];
  if (classification?.category !== 'station_machine') return false;
  if (rows.length === 0) {
    return liveStationContext?.retrievalMode === 'postgres_iot_miss'
      && Array.isArray(liveStationContext?.terms)
      && liveStationContext.terms.length > 0;
  }

  const text = String(question || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const asksItemRule = /(可以投|能不能投|可不可以投|可以回收|能回收|收不收|能不能收)/.test(text)
    && /(牛奶瓶|鮮奶瓶|奶瓶|紙盒|鋁箔包|玻璃|紙杯|塑膠袋|便當盒)/.test(text);

  return !asksItemRule;
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
        await saveChatTrace(pool, {
          sessionId,
          channel: 'web',
          question: userMsg.content,
          rag,
          latencyMs: Date.now() - traceStart,
          questionClassification: classification,
        });

        try {
          await storeChatExchange({
            pool,
            sessionId,
            question: userMsg.content,
            reply,
            messageId,
            classification,
          });
        } catch (dbErr) {
          console.error('DB conversation write error:', dbErr.message);
          return res.json({ reply });
        }

        return res.json({ reply, messageId });
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
      });
      const stationStatusReply = shouldUseDeterministicStationReply(userMsg.content, classification, rag.liveStationContext)
        ? buildLiveStationStatusReply(rag.liveStationContext)
        : '';
      if (stationStatusReply) {
        await saveChatTrace(pool, {
          sessionId,
          channel: 'web',
          question: userMsg.content,
          rag,
          latencyMs: Date.now() - traceStart,
          questionClassification: classification,
        });

        try {
          await storeChatExchange({
            pool,
            sessionId,
            question: userMsg.content,
            reply: stationStatusReply,
            messageId,
            classification,
          });
        } catch (dbErr) {
          console.error('DB conversation write error:', dbErr.message);
          return res.json({ reply: stationStatusReply });
        }

        return res.json({ reply: stationStatusReply, messageId });
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

      await saveChatTrace(pool, {
        sessionId,
        channel: 'web',
        question: userMsg.content,
        rag,
        latencyMs: Date.now() - traceStart,
        response,
        questionClassification: classification,
      });

      try {
        await storeChatExchange({
          pool,
          sessionId,
          question: userMsg.content,
          reply,
          messageId,
          gap,
          classification,
        });
      } catch (dbErr) {
        console.error('DB conversation write error:', dbErr.message);
        return res.json({ reply });
      }

      res.json({ reply, messageId });
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
  KNOWLEDGE_GAP_MACHINE_MARKER,
  KNOWLEDGE_GAP_MARKERS,
  MAX_WEB_CHAT_TIMEOUT_MS,
  WEB_SESSION_COOKIE_NAME,
  attachLiveStationContext,
  buildLiveStationStatusReply,
  shouldUseDeterministicStationReply,
  createMessageWithTimeout,
  createSignedSessionCookieValue,
  createChatRouter,
  detectKnowledgeGap,
  FRIENDLY_AI_ERROR_REPLY,
  getClientSessionId,
  getLatestUserMessage,
  getSafeSessionId,
  getWebChatTimeoutMs,
  loadExchangeByMessageId,
  loadServerConversationHistory,
  normalizeModelMessages,
  parseKnowledgeGapMeta,
  resolveWebSession,
  setWebSessionCookie,
  storeChatExchange,
  stripKnowledgeGapMarker,
  validateHistory,
};
