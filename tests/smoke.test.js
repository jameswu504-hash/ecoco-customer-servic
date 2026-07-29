const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { requireAdminKey } = require('../middleware/admin-auth');
const { requireIotSyncKey } = require('../middleware/iot-sync-auth');
const {
  createMessageWithTimeout,
  createChatRouter,
  FRIENDLY_AI_ERROR_REPLY,
  getLatestUserMessage,
  getWebChatTimeoutMs,
  persistChatArtifacts,
  validateHistory,
} = require('../routes/chat.routes');
const {
  loadExchangeByMessageId,
  normalizeModelMessages,
} = require('../services/conversation-history.service');
const {
  detectKnowledgeGap,
  parseKnowledgeGapMeta,
  stripKnowledgeGapMarker,
} = require('../services/knowledge-gap.util');
const {
  createSignedSessionCookieValue,
  getClientSessionId,
  getSafeSessionId,
  WEB_SESSION_COOKIE_NAME,
} = require('../services/session.service');
const { getKnowledgeEmbeddingStatus } = require('../services/health.service');
const { scanFile } = require('../scripts/scan-pii');
const { cleanKnowledgeInput } = require('../routes/knowledge.routes');
const { requireStaffKey } = require('../middleware/staff-auth');
const { getRetentionDays, maskSensitiveText } = require('../services/privacy.service');
const { classifyQuestion } = require('../services/question-classifier.service');
const { compareSecret } = require('../services/secret.service');
const { summarizeQuestionClassification, summarizeRagChunks } = require('../services/trace.service');
const {
  escapeIlikePattern,
} = require('../routes/dashboard.routes');
const {
  buildAiReply,
  claimLineWebhookEvent,
  cleanupLineRateBuckets,
  createInFlightTaskTracker,
  deliverLineMessage,
  ensureLineWebhookEndpoint,
  getExpectedLineWebhookUrl,
  getLineConfig,
  getLineReplyTimeoutMs,
  getLineTimeoutReply,
  isLineRateLimited,
  LINE_RATE_LIMIT_MAX_BUCKETS,
  parseLineLocationMessage,
  resolveWithTimeout,
  safeCompare,
  toLineText,
  verifyLineSignature,
} = require('../routes/line.routes');
const { normalizeAdminNote, MAX_ADMIN_NOTE_CHARS } = require('../routes/unanswered.routes');
const {
  cleanWikiEntryInput,
  escapeWikiSearchTerm,
  isInternalMode,
  normalizeDepartment,
  normalizeVisibility,
  validateWikiEntry,
} = require('../services/internal-wiki.service');
const { createPromptService } = require('../services/prompt.service');
const {
  buildRuntimeGuardrails,
  buildChineseStationTerms,
  buildSearchTerms,
  createRagService,
  normalizeScopeTerms,
  rankKnowledgeRows,
} = require('../services/rag.service');
const { SCHEMA, migrateTimestampColumns, migrateUniqueMessageIndexes } = require('../db/schema');

const TEST_SESSION_ENV = {
  SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
};

test('known point issue ranks the point knowledge first', () => {
  const terms = buildSearchTerms('點數沒有入帳怎麼辦');
  const rows = [
    {
      id: 1,
      category: '合作商家',
      title: '合作商家列表',
      content: 'ECOCO 點數可以到合作商家折抵。',
      sort_order: 2,
    },
    {
      id: 2,
      category: '點數問題',
      title: '點數未入帳',
      content: '請提供註冊手機、回收時間、站點與截圖，客服會協助查詢。',
      sort_order: 1,
    },
  ];

  const ranked = rankKnowledgeRows(rows, terms);

  assert.equal(ranked[0].category, '點數問題');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('high risk chunk adds conservative guardrail', () => {
  const guardrail = buildRuntimeGuardrails('點數沒有入帳，可以補點嗎？', {
    chunks: [{ risk_level: 'High' }],
    context: '',
  });

  assert.match(guardrail, /客服表單|不承諾|人工/i);
});

test('runtime guardrails ignore generic risk words from retrieved context', () => {
  const guardrail = buildRuntimeGuardrails('\u9ede\u6578\u600e\u9ebc\u7b97', {
    chunks: [{ risk_level: 'Low' }],
    context: '\u5e33\u865f \u624b\u6a5f \u6545\u969c \u6eff\u5009 \u5ba2\u8a34 \u9ede\u6578\u672a\u5165\u5e33',
  });

  assert.equal(guardrail, '');
});

test('runtime guardrails still trigger for explicit high-risk user intent', () => {
  const guardrail = buildRuntimeGuardrails('\u9ede\u6578\u672a\u5165\u5e33\uff0c\u53ef\u4ee5\u88dc\u9ede\u55ce', {
    chunks: [{ risk_level: 'Low' }],
    context: '',
  });

  assert.match(guardrail, /高風險客服回覆限制/);
});

test('web chat timeout is bounded and aborts a stalled AI request', async () => {
  assert.equal(getWebChatTimeoutMs({ WEB_CHAT_TIMEOUT_MS: '999999' }), 55000);
  assert.equal(getWebChatTimeoutMs({ WEB_CHAT_TIMEOUT_MS: 'invalid' }), 45000);

  let aborted = false;
  const fakeClient = {
    messages: {
      create: (payload, options) => new Promise(() => {
        options.signal.addEventListener('abort', () => {
          aborted = true;
        });
      }),
    },
  };

  await assert.rejects(
    createMessageWithTimeout(fakeClient, { messages: [] }, 100),
    error => error.code === 'WEB_CHAT_TIMEOUT'
  );
  assert.equal(aborted, true);
});

test('knowledge gap marker is recorded', () => {
  const gap = detectKnowledgeGap('目前沒有足夠資料可以確認，建議您透過客服表單補充資訊。');

  assert.equal(gap.isGap, true);
  assert.match(gap.reason, /知識缺口/);
});

test('machine knowledge gap marker is recorded but hidden from users', () => {
  const reply = '[KNOWLEDGE_GAP] 目前無法確認，請補充站點與時間。';
  const gap = detectKnowledgeGap(reply);

  assert.equal(gap.isGap, true);
  assert.match(gap.reason, /KNOWLEDGE_GAP/);
  assert.equal(stripKnowledgeGapMarker(reply), '目前無法確認，請補充站點與時間。');
});

test('structured knowledge gap metadata is parsed and stripped from user replies', () => {
  const reply = '目前無法確認，請補充站點與時間。\n<meta>{"gap":true,"confidence":"low","reason":"missing station policy"}</meta>';
  const meta = parseKnowledgeGapMeta(reply);
  const gap = detectKnowledgeGap(reply);

  assert.equal(meta.gap, true);
  assert.equal(meta.confidence, 'low');
  assert.equal(gap.isGap, true);
  assert.match(gap.reason, /structured knowledge gap meta/);
  assert.equal(stripKnowledgeGapMarker(reply), '目前無法確認，請補充站點與時間。');
});

test('station lookup questions add Chinese station aliases for RAG', () => {
  const chongSyueStation = '\u5d07' + '\u5b78' + '\u7ad9';
  const chongSyue = '\u5d07' + '\u5b78';
  const taiNanChongSyueStation = '\u53f0' + '\u5357' + chongSyueStation;
  const whereIsIt = '\u5728' + '\u54ea' + '\u88e1';
  const stationTerms = buildChineseStationTerms(`${chongSyueStation}${'\u5728' + '\u54ea'}`);
  const searchTerms = buildSearchTerms(`${taiNanChongSyueStation}${whereIsIt}`);

  assert.ok(stationTerms.includes(chongSyueStation));
  assert.ok(stationTerms.includes(chongSyue));
  assert.ok(searchTerms.includes(taiNanChongSyueStation));
  assert.ok(searchTerms.includes(chongSyueStation));
});

test('station lookup classification is routed to station machine knowledge', () => {
  const chongSyue = '\u5d07' + '\u5b78';
  const station = classifyQuestion(`${chongSyue}${'\u7ad9' + '\u5728' + '\u54ea'}`);
  const stationSearch = classifyQuestion(`${'\u7ad9' + '\u9ede' + '\u67e5' + '\u8a62'} ${chongSyue}`);

  assert.equal(station.category, 'station_machine');
  assert.equal(station.shouldUseRag, true);
  assert.equal(stationSearch.category, 'station_machine');
});

test('station name terms rank matching station rows first', () => {
  const chongSyueStation = '\u5d07' + '\u5b78' + '\u7ad9';
  const terms = buildSearchTerms(`${chongSyueStation}${'\u5728' + '\u54ea'}`);
  const stationCategory = `AI${'\u5ba2' + '\u670d' + '\u77e5' + '\u8b58' + '\uff1a'}${'\u7ad9' + '\u9ede' + '\u8cc7' + '\u6599'} / ${'\u81fa' + '\u5357'}`;
  const rows = [
    {
      id: 1,
      category: '\u516c' + '\u53f8' + '\u57fa' + '\u672c' + '\u8cc7' + '\u8a0a',
      title: '\u5ba2' + '\u670d' + '\u8868' + '\u55ae',
      content: `${'\u53ef' + '\u4ee5' + '\u67e5' + '\u8a62'}${'\u7ad9' + '\u9ede' + '\u4f4d' + '\u7f6e'}${'\u8207' + '\u5730' + '\u5740'}\u3002`,
      sort_order: 1,
    },
    {
      id: 2,
      category: stationCategory,
      title: `${'\u81fa' + '\u5357' + '\u6771' + '\u5340' + '\uff5c'}ECOCO${chongSyueStation}`,
      content: `${'\u5730' + '\u5740' + '\uff1a'}${'\u81fa' + '\u5357' + '\u5e02' + '\u6771' + '\u5340'}${'\u5d07' + '\u5b78' + '\u8def'}5${'\u865f'}\u3002${'\u6a5f' + '\u578b' + '\uff1a'}AI-HD\u3002`,
      sort_order: 2,
    },
  ];

  const ranked = rankKnowledgeRows(rows, terms);

  assert.equal(ranked[0].id, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('question classifier maps common customer questions to stable routing categories', () => {
  const points = classifyQuestion('我的回收點數沒有入帳，可以補點嗎？');
  const app = classifyQuestion('APP 無法登入，OTP 驗證碼一直收不到');
  const manual = classifyQuestion('我要客服幫我查我的帳號退款');
  const incidentalPoint = classifyQuestion('這個站點有點遠');
  const refundPolicy = classifyQuestion('退款規則與申請條件是什麼？');

  assert.equal(points.category, 'points');
  assert.equal(points.shouldUseRag, true);
  assert.ok(points.ragScope.includes('點數'));
  assert.equal(app.category, 'app_account');
  assert.ok(app.ragScope.includes('APP'));
  assert.equal(manual.shouldUseRag, false);
  assert.equal(manual.shouldEscalate, true);
  assert.match(manual.directReply, /客服人員/);
  assert.notEqual(incidentalPoint.category, 'points');
  assert.equal(refundPolicy.category, 'high_risk_policy');
  assert.equal(refundPolicy.shouldUseRag, true);
  assert.equal(refundPolicy.shouldEscalate, false);
});

test('RAG scope terms are normalized without becoming SQL filters', () => {
  assert.deepEqual(normalizeScopeTerms(['APP', 'APP', ' 點數 ']), ['APP', '點數']);
});

test('multiple and incomplete meta blocks are stripped from user replies', () => {
  const repeated = '<meta>{"gap":false,"confidence":"high"}</meta>好的，這樣處理。<meta>{"gap":false,"confidence":"high"}</meta>';
  const truncated = '目前無法確認，請補充站點與時間。\n<meta>{"gap":tru';

  assert.equal(stripKnowledgeGapMarker(repeated), '好的，這樣處理。');
  assert.equal(stripKnowledgeGapMarker(truncated), '目前無法確認，請補充站點與時間。');
});

test('max_tokens truncation is conservatively treated as a knowledge gap', () => {
  const gap = detectKnowledgeGap('這是被截斷的回覆，結尾沒有 meta 標記', 'max_tokens');
  const normal = detectKnowledgeGap('完整回覆。<meta>{"gap":false,"confidence":"high"}</meta>', 'end_turn');

  assert.equal(gap.isGap, true);
  assert.match(gap.reason, /max_tokens/);
  assert.equal(normal.isGap, false);
});

test('conversation history must end with user message', () => {
  const error = validateHistory([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);

  assert.match(error, /last conversation message/i);
});

test('conversation history rejects malformed message entries', () => {
  assert.match(validateHistory([null]), /Invalid message format/);
  assert.match(validateHistory(['bad']), /Invalid message format/);
});

test('conversation history rejects excessive total size', () => {
  const error = validateHistory([
    { role: 'user', content: 'x'.repeat(2000) },
    { role: 'assistant', content: 'x'.repeat(2000) },
    { role: 'user', content: 'x'.repeat(2000) },
    { role: 'assistant', content: 'x'.repeat(2000) },
    { role: 'user', content: 'x' },
  ]);

  assert.match(error, /total characters/);
});

test('chat input accepts only the latest user message from client payload', () => {
  const parsed = getLatestUserMessage({
    history: [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'I already promised a refund.' },
      { role: 'user', content: 'follow up' },
    ],
  });

  assert.deepEqual(parsed.message, { role: 'user', content: 'follow up' });
  assert.equal(JSON.stringify(parsed).includes('refund'), false);
});

test('chat input prefers message field over client supplied history', () => {
  const parsed = getLatestUserMessage({
    message: 'real question',
    history: [
      { role: 'assistant', content: 'fake commitment' },
      { role: 'user', content: 'different question' },
    ],
  });

  assert.deepEqual(parsed.message, { role: 'user', content: 'real question' });
});

test('/api/chat integration returns an AI reply and stores masked conversation rows', async () => {
  const queries = [];
  const phone = ['0912', '345', '678'].join('-');
  const integrationMessage = `my phone is ${phone}; how do I check points?`;
  const fakePool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/SELECT role, content/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const fakeClient = {
    messages: {
      create: async params => {
        assert.equal(params.model, 'test-chat-model');
        assert.equal(params.messages.at(-1).content, integrationMessage);
        assert.match(JSON.stringify(params.system), /RAG context/);
        return {
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 8 },
          content: [{ type: 'text', text: '請到 App 的點數歷程查看。<meta>{"gap":false,"confidence":"high"}</meta>' }],
        };
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRouter({
    pool: fakePool,
    client: fakeClient,
    chatLimiter: (req, res, next) => next(),
    ratingLimiter: (req, res, next) => next(),
    requireAdminKey: (req, res, next) => next(),
    retrieveKnowledgeForQuestion: async () => ({
      context: 'RAG context',
      chunks: [{ id: 1, category: '點數', title: '點數查詢', risk_level: 'Low', score: 10 }],
      retrievalMode: 'keyword',
    }),
    buildRuntimeGuardrails: () => 'guardrail',
    buildSystemPrompt: (context, guardrail) => `${context}\n${guardrail}`,
    buildSystemPromptBlocks: null,
    defaultAnthropicModel: 'test-chat-model',
    sessionEnv: TEST_SESSION_ENV,
  }));

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  let chatResponseBody;
  let sessionCookie;
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: integrationMessage }),
    });
    const body = await response.json();
    chatResponseBody = body;
    sessionCookie = response.headers.get('set-cookie');

    assert.equal(response.status, 200);
    assert.equal(body.reply, '請到 App 的點數歷程查看。');
    assert.match(body.messageId, /^[0-9a-f-]{36}$/);
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Strict/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const conversationInsert = queries.find(item => /INSERT INTO conversations/i.test(item.sql));
  assert.ok(conversationInsert);
  assert.match(conversationInsert.params[0], /^session_[0-9a-f]{32}$/);
  assert.equal(conversationInsert.params[2].includes(phone), false);
  assert.match(conversationInsert.params[2], /\[phone\]/);
  assert.match(conversationInsert.sql, /message_id/);
  assert.equal(conversationInsert.params[6], chatResponseBody.messageId);
});

test('/api/chat direct manual routing bypasses Claude and records an unanswered item', async () => {
  const queries = [];
  const fakePool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/SELECT role, content/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const fakeClient = {
    messages: {
      create: async () => {
        throw new Error('Claude should not be called for direct manual routing');
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRouter({
    pool: fakePool,
    client: fakeClient,
    chatLimiter: (req, res, next) => next(),
    ratingLimiter: (req, res, next) => next(),
    requireAdminKey: (req, res, next) => next(),
    retrieveKnowledgeForQuestion: async () => {
      throw new Error('RAG should not be called for direct manual routing');
    },
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => 'system',
    buildSystemPromptBlocks: null,
    defaultAnthropicModel: 'test-chat-model',
    classifyQuestion,
    sessionEnv: TEST_SESSION_ENV,
  }));

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': 'session_manualroute',
      },
      body: JSON.stringify({ message: '我要客服幫我查我的帳號退款' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.reply, /客服人員/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  assert.ok(queries.some(item => /INSERT INTO chat_traces/i.test(item.sql) && item.params.includes('high_risk')));
  assert.ok(queries.some(item => /INSERT INTO unanswered_questions/i.test(item.sql)));
});

test('server-side model history is normalized before sending to Claude', () => {
  const messages = normalizeModelMessages([
    { role: 'assistant', content: 'old answer 1' },
    { role: 'assistant', content: 'old answer 2' },
    { role: 'user', content: 'new question' },
  ]);

  assert.deepEqual(messages, [
    { role: 'assistant', content: 'old answer 1\n\nold answer 2' },
    { role: 'user', content: 'new question' },
  ]);
});

test('web sessions accept only server-signed HttpOnly cookie values', () => {
  const env = { SESSION_SECRET: 'test-session-secret-with-at-least-32-characters' };
  const sessionId = getSafeSessionId({}, env);
  const issuedAt = Date.UTC(2026, 6, 27);
  const signed = createSignedSessionCookieValue(sessionId, env, issuedAt);
  const headers = { cookie: `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}` };

  assert.match(sessionId, /^session_[0-9a-f]{32}$/);
  assert.equal(getClientSessionId(headers, env, issuedAt + 1000), sessionId);
  assert.equal(getClientSessionId(headers, env, issuedAt + (8 * 24 * 60 * 60 * 1000)), null);
  assert.equal(getClientSessionId({ 'x-session-id': sessionId }, env), null);
  assert.equal(getClientSessionId({
    cookie: `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(`${signed}tampered`)}`,
  }, env, issuedAt + 1000), null);
  assert.match(
    createSignedSessionCookieValue(sessionId, {
      ADMIN_KEY: 'temporary-admin-key-fallback',
    }),
    new RegExp(`^${sessionId}\\.\\d+\\.`)
  );
});

test('admin middleware rejects missing admin key', () => {
  const previous = process.env.ADMIN_KEY;
  process.env.ADMIN_KEY = 'test-admin-key';

  let statusCode = 0;
  let body = null;
  const req = { headers: {} };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  let nextCalled = false;

  requireAdminKey(req, res, () => {
    nextCalled = true;
  });

  process.env.ADMIN_KEY = previous;

  assert.equal(statusCode, 401);
  assert.equal(nextCalled, false);
  assert.ok(body.error);
});

test('staff middleware requires staff key and does not fall back to admin key', () => {
  const previousStaff = process.env.STAFF_KEY;
  process.env.STAFF_KEY = 'staff-secret-for-test';

  let statusCode = 0;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;

  requireStaffKey({ headers: { 'x-admin-key': 'staff-secret-for-test' } }, res, () => {
    nextCalled = true;
  });
  assert.equal(statusCode, 401);
  assert.equal(nextCalled, false);

  statusCode = 0;
  requireStaffKey({ headers: { 'x-staff-key': 'staff-secret-for-test' } }, res, () => {
    nextCalled = true;
  });

  process.env.STAFF_KEY = previousStaff;
  assert.equal(nextCalled, true);
});

test('conversation persistence masks phone and email values', () => {
  const phone = ['0912', '345', '678'].join('-');
  const email = ['test', 'example.com'].join('@');
  const masked = maskSensitiveText(`my phone is ${phone} and email is ${email}`);

  assert.equal(masked.includes(phone), false);
  assert.equal(masked.includes(email), false);
  assert.match(masked, /\[phone\]/);
  assert.match(masked, /\[email\]/);
});

test('conversation persistence masks common id and long number values', () => {
  const twId = ['A1', '234', '567', '89'].join('');
  const memberNumber = ['1234', '5678'].join('');
  const masked = maskSensitiveText(`id ${twId} member ${memberNumber}`);

  assert.equal(masked.includes(twId), false);
  assert.equal(masked.includes(memberNumber), false);
  assert.match(masked, /\[tw-id\]/);
  assert.match(masked, /\[number\]/);
});

test('knowledge input is anonymized before it can be saved or exported', () => {
  const email = ['support', 'example.com'].join('@');
  const phone = ['0912', '345', '678'].join('-');
  const twId = ['A1', '234', '567', '89'].join('');
  const memberNumber = ['1234', '5678'].join('');
  const cleaned = cleanKnowledgeInput(`請聯絡 ${email}，電話 ${phone}，身分證 ${twId}，會員 ${memberNumber}`);

  assert.equal(cleaned.includes(email), false);
  assert.equal(cleaned.includes(phone), false);
  assert.equal(cleaned.includes(twId), false);
  assert.equal(cleaned.includes(memberNumber), false);
  assert.match(cleaned, /redacted-email/);
  assert.match(cleaned, /09XX-XXX-XXX/);
  assert.match(cleaned, /\[tw-id\]/);
  assert.match(cleaned, /\[number\]/);
});

test('RAG returns no context when keyword and semantic search both miss', async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  const rag = createRagService({ pool, env: {} });
  const result = await rag.retrieveKnowledgeForQuestion('完全不相關的測試問題');

  assert.deepEqual(result.chunks, []);
  assert.equal(result.context, '');
  assert.equal(result.retrievalMode, 'none');
});

test('embedding requests retry transient failures but not indefinitely', async () => {
  let attempts = 0;
  const rag = createRagService({
    pool: { query: async () => ({ rows: [] }) },
    env: {
      OPENAI_API_KEY: 'test-key',
      EMBEDDING_MAX_RETRIES: '2',
      EMBEDDING_RETRY_BASE_MS: '0',
      EMBEDDING_TIMEOUT_MS: '1000',
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => 'rate limited',
        };
      }
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      };
    },
  });

  const embeddings = await rag.embedTexts(['test']);

  assert.equal(attempts, 2);
  assert.deepEqual(embeddings, [[0.1, 0.2]]);
});

test('RAG classification scope boosts ranking without hard-filtering SQL', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const rag = createRagService({ pool, env: {} });
  const classification = classifyQuestion('APP 無法登入，驗證碼收不到');
  const result = await rag.retrieveKnowledgeForQuestion('APP 無法登入，驗證碼收不到', { classification });
  const keywordQuery = queries.find(item => /FROM knowledge_chunks/i.test(item.sql));

  assert.equal(result.questionClassification.category, 'app_account');
  assert.deepEqual(result.scopeTerms.slice(0, 2), ['APP', '帳號']);
  assert.ok(keywordQuery);
  assert.doesNotMatch(keywordQuery.sql, /category ILIKE/);
  assert.doesNotMatch(keywordQuery.sql, /title ILIKE/);
  assert.ok(keywordQuery.sql.includes('search_text ILIKE'));
  assert.ok(keywordQuery.params.some(param => param.includes('APP')));
});

test('chat trace summaries include retrieved chunk ids and scores without full content', () => {
  const summary = summarizeRagChunks({
    chunks: [
      {
        id: 12,
        category: '點數規則',
        title: '點數效期',
        content: 'x'.repeat(2000),
        risk_level: 'Low',
        score: 18,
      },
    ],
  });

  assert.equal(summary.length, 1);
  assert.equal(summary[0].id, 12);
  assert.equal(summary[0].score, 18);
  assert.equal(Object.hasOwn(summary[0], 'content'), false);
});

test('chat trace summaries include safe question classification fields', () => {
  const summary = summarizeQuestionClassification(classifyQuestion('APP 帳號登入不了'));

  assert.equal(summary.category, 'app_account');
  assert.equal(summary.label, 'APP / 帳號');
  assert.equal(summary.shouldUseRag, true);
  assert.ok(summary.ragScope.includes('APP'));
});

test('dashboard keeps dynamic click handlers usable', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard-v2.html'), 'utf8');

  assert.equal(dashboard.includes('protectDashboardHtmlAssignments'), false);
  assert.equal(dashboard.includes('DOMPurify.sanitize'), false);
});

test('package does not depend on floating latest SDK versions', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.notEqual(pkg.dependencies['@anthropic-ai/sdk'], 'latest');
  assert.ok(pkg.engines.node);
});

test('server exposes a health check route', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /\/healthz/);
  assert.match(server, /missingEmbeddingChunkCount/);
  assert.match(server, /embeddingCoveragePercent/);
});

test('workflow scripts referenced by GitHub Actions exist', () => {
  const backupWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'backup.yml'), 'utf8');
  const analysisWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ai-analysis.yml'), 'utf8');
  const ciWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(backupWorkflow, /node scripts\/backup\.mjs/);
  assert.match(backupWorkflow, /node scripts\/check-knowledge-drift\.mjs/);
  assert.match(backupWorkflow, /actions\/upload-artifact@v4/);
  assert.equal(backupWorkflow.includes('git push'), false);
  assert.equal(backupWorkflow.includes('git commit'), false);
  assert.match(analysisWorkflow, /node scripts\/ai-analysis\.mjs/);
  assert.match(analysisWorkflow, /MAIL_TO/);
  assert.match(ciWorkflow, /npm run lint/);
  assert.match(ciWorkflow, /npm test/);
  assert.match(ciWorkflow, /npm run eval:validate/);
  assert.match(ciWorkflow, /npm run scan:pii/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'backup.mjs')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'ai-analysis.mjs')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'check-knowledge-drift.mjs')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'run-evals.mjs')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'evals', 'golden-set.json')), true);
});

test('go-live status report covers handoff and launch decisions', () => {
  const report = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'archive', 'GO_LIVE_STATUS_REPORT_2026-07-03.md'),
    'utf8'
  );

  assert.match(report, /LINE Developers/);
  assert.match(report, /GitHub Actions/);
  assert.match(report, /驗收題/);
  assert.match(report, /公司帳號/);
  assert.match(report, /小範圍試營運/);
});

test('public chat response does not expose RAG source metadata', () => {
  const chatRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.routes.js'), 'utf8');

  assert.equal(chatRoute.includes('ragSources'), false);
});

test('negative feedback is routed to unanswered questions for maintenance', () => {
  const chatRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.routes.js'), 'utf8');
  const indexJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');

  assert.match(chatRoute, /type === 'negative'/);
  assert.match(chatRoute, /INSERT INTO unanswered_questions/);
  assert.match(chatRoute, /使用者點選「需改善」/);
  assert.doesNotMatch(indexJs, /x-session-id/);
});

test('rating session id requires a valid signed cookie', () => {
  const env = { SESSION_SECRET: 'test-session-secret-with-at-least-32-characters' };
  const sessionId = 'session_abcdefgh';
  const signed = createSignedSessionCookieValue(sessionId, env);

  assert.equal(getClientSessionId({}, env), null);
  assert.equal(getClientSessionId({ 'x-session-id': sessionId }, env), null);
  assert.equal(
    getClientSessionId({ cookie: `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}` }, env),
    sessionId
  );
});

test('LINE webhook only reclaims failed or stale processing events', async () => {
  let capturedSql = '';
  const pool = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    },
  };

  await claimLineWebhookEvent(pool, {
    webhookEventId: 'event-123',
    deliveryContext: { isRedelivery: true },
  });

  assert.match(capturedSql, /status = 'failed'/);
  assert.match(
    capturedSql,
    /\(line_webhook_events\.status = 'processing'\s+AND line_webhook_events\.updated_at < NOW\(\) - INTERVAL '5 minutes'\)/
  );
  assert.doesNotMatch(
    capturedSql,
    /OR line_webhook_events\.updated_at < NOW\(\) - INTERVAL '5 minutes'/
  );
});

test('embedding health count checks the column before using a direct vector predicate', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (/information_schema\.columns/.test(sql)) return { rows: [{ exists: true }] };
      return { rows: [{ chunk_count: '10', embedded_count: '8' }] };
    },
  };

  const status = await getKnowledgeEmbeddingStatus(pool);

  assert.deepEqual(status, { chunkCount: 10, embeddedCount: 8 });
  assert.match(queries[1], /embedding IS NOT NULL/);
  assert.doesNotMatch(queries[1], /to_jsonb/);
});

test('PII scan ignores RFC-reserved example email domains', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'reserved-email-domain.txt');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, 'support@example.com dev@example.org qa@example.net');
  try {
    assert.equal(scanFile(fixturePath).emailMatches, 0);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('rating question and reply are looked up by session and message id', async () => {
  const fakePool = {
    query: async (sql, params) => {
      assert.match(sql, /FROM conversations/);
      assert.match(sql, /message_id = \$2/);
      assert.match(sql, /LIMIT 2/);
      assert.deepEqual(params, ['session_abcdefgh', 'reply-123']);
      return {
        rows: [
          { role: 'user', content: '這是使用者的問題' },
          { role: 'assistant', content: '這是 AI 的回覆' },
        ],
      };
    },
  };

  const exchange = await loadExchangeByMessageId(fakePool, 'session_abcdefgh', 'reply-123');
  assert.deepEqual(exchange, { question: '這是使用者的問題', reply: '這是 AI 的回覆' });

  const empty = await loadExchangeByMessageId(fakePool, null, 'reply-123');
  assert.deepEqual(empty, { question: '', reply: '' });
});

test('conversation retention requires an explicit enable switch', () => {
  assert.equal(getRetentionDays({ CONVERSATION_RETENTION_DAYS: '180' }), 0);
  assert.equal(getRetentionDays({
    CONVERSATION_RETENTION_ENABLED: 'true',
    CONVERSATION_RETENTION_DAYS: '180',
  }), 180);
});

test('chat trace and conversation writes start in parallel', async () => {
  const pendingResolvers = [];
  const queries = [];
  const pool = {
    query(sql) {
      queries.push(sql);
      return new Promise(resolve => pendingResolvers.push(() => resolve({ rows: [] })));
    },
  };

  const pending = persistChatArtifacts({
    pool,
    trace: {
      sessionId: 'session_parallel',
      question: 'question',
      rag: { retrievalMode: 'none', chunks: [] },
    },
    exchange: {
      pool,
      sessionId: 'session_parallel',
      question: 'question',
      reply: 'reply',
      messageId: 'message-parallel',
    },
  });

  await Promise.resolve();
  assert.equal(queries.length, 2);
  assert.ok(queries.some(sql => /INSERT INTO chat_traces/.test(sql)));
  assert.ok(queries.some(sql => /INSERT INTO conversations/.test(sql)));
  pendingResolvers.forEach(resolve => resolve());
  assert.equal(await pending, true);
});

test('/api/rating binds feedback to the selected response instead of the latest exchange', async () => {
  const queries = [];
  const sessionEnv = { SESSION_SECRET: 'test-session-secret-with-at-least-32-characters' };
  const sessionId = 'session_rating123';
  const sessionCookie = `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(createSignedSessionCookieValue(sessionId, sessionEnv))}`;
  const fakePool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM conversations/.test(sql)) {
        return {
          rows: [
            { role: 'user', content: 'selected question' },
            { role: 'assistant', content: 'selected reply' },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRouter({
    pool: fakePool,
    client: { messages: { create: async () => ({}) } },
    chatLimiter: (req, res, next) => next(),
    ratingLimiter: (req, res, next) => next(),
    requireAdminKey: (req, res, next) => next(),
    retrieveKnowledgeForQuestion: async () => ({ context: '', chunks: [], retrievalMode: 'none' }),
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => '',
    defaultAnthropicModel: 'test-model',
    sessionEnv,
  }));

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/rating`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ msgId: 'selected-message-id', type: 'positive' }),
    });

    assert.equal(response.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const lookup = queries.find(item => /FROM conversations/.test(item.sql));
  const insert = queries.find(item => /INSERT INTO ratings/.test(item.sql));
  assert.deepEqual(lookup.params, [sessionId, 'selected-message-id']);
  assert.deepEqual(insert.params.slice(0, 2), ['selected-message-id', 'positive']);
  assert.deepEqual(insert.params.slice(3), ['selected question', 'selected reply']);
});

test('rating endpoint rejects unmatched sessions and ignores client-provided question text', () => {
  const chatRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.routes.js'), 'utf8');
  const ratingBlock = chatRoute.slice(chatRoute.indexOf("router.post('/rating'"), chatRoute.indexOf("router.get('/ratings'"));

  assert.match(ratingBlock, /loadExchangeByMessageId/);
  assert.match(ratingBlock, /getClientSessionId/);
  assert.match(ratingBlock, /No matching conversation found for rating/);
  assert.equal(/req\.body[^\n]*question/.test(ratingBlock), false);
});

test('customer frontend rating payload only carries msgId and type', () => {
  const indexJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.js'), 'utf8');

  assert.match(indexJs, /JSON\.stringify\(\{ msgId, type \}\)/);
  assert.equal(/JSON\.stringify\(\{ msgId, type, question, reply \}\)/.test(indexJs), false);
});

test('golden eval set has enough reviewed cases and high-risk coverage', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals', 'golden-set.json'), 'utf8'));
  const cases = golden.cases || [];

  assert.ok(cases.length >= 30);
  assert.ok(cases.some(item => item.risk === 'high'));
  assert.ok(cases.some(item => Array.isArray(item.must_include_any)));
  for (const item of cases) {
    assert.ok(item.id);
    assert.ok(item.question);
    assert.ok(Array.isArray(item.must_include));
    assert.ok(Array.isArray(item.must_not_include));
  }
});

test('eval deterministic judge supports required synonym groups', async () => {
  const { deterministicJudge } = await import('../scripts/run-evals.mjs');
  const result = deterministicJudge('點數效期為一年，可以在 App 的我的點數查看到期日。', {
    must_include: ['App'],
    must_include_any: [
      ['12 個月', '一年'],
      ['點數紀錄', '我的點數'],
    ],
    must_not_include: ['終身有效'],
  });

  assert.equal(result.pass, true);
});

test('knowledge drift comparison detects changed section hashes', async () => {
  const { compareKnowledgeMaps, hasDrift, toSectionMap } = await import('../scripts/check-knowledge-drift.mjs');
  const local = toSectionMap({ sections: [{ category: 'A', content: 'old' }] });
  const remote = toSectionMap({ sections: [{ category: 'A', content: 'new' }, { category: 'B', content: 'new' }] });
  const diff = compareKnowledgeMaps(local, remote);

  assert.equal(hasDrift(diff), true);
  assert.deepEqual(diff.remoteOnly, ['B']);
  assert.equal(diff.changed[0].category, 'A');
});

test('schema includes report and dashboard performance indexes', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.js'), 'utf8');

  assert.match(schema, /idx_conv_timestamp/);
  assert.match(schema, /idx_conv_role_timestamp/);
  assert.match(schema, /idx_conv_session_ts/);
  assert.match(schema, /idx_ratings_timestamp/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_traces/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS admin_audit_logs/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS line_webhook_events/);
  assert.match(schema, /uq_ratings_msg_id/);
  assert.match(schema, /uq_conv_session_role_message/);
  assert.doesNotMatch(schema, /DROP CONSTRAINT IF EXISTS iot_station_statuses_pkey/);
});

test('knowledge chunks are not blindly rebuilt on every startup', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /ensureKnowledgeChunksReady/);
  assert.match(server, /REBUILD_KNOWLEDGE_CHUNKS_ON_START/);
});

test('runtime config fails fast when required production secrets are missing', () => {
  const { validateRuntimeConfig } = require('../server');
  const result = validateRuntimeConfig({});

  assert.match(result.errors.join('\n'), /DATABASE_URL/);
  assert.match(result.errors.join('\n'), /ANTHROPIC_API_KEY/);
  assert.match(result.errors.join('\n'), /ADMIN_KEY/);
  assert.match(result.warnings.join('\n'), /SESSION_SECRET/);
  assert.match(result.warnings.join('\n'), /IOT_SYNC_KEY/);
});

test('runtime config warns about undersized dedicated secrets', () => {
  const { validateRuntimeConfig } = require('../server');
  const short = validateRuntimeConfig({
    DATABASE_URL: 'postgresql://example',
    ANTHROPIC_API_KEY: 'anthropic-key',
    ADMIN_KEY: 'admin-key-with-enough-length',
    SESSION_SECRET: 'short',
    IOT_SYNC_KEY: 'short',
  });

  assert.equal(short.errors.length, 0);
  assert.match(short.warnings.join('\n'), /SESSION_SECRET is short/);
  assert.match(short.warnings.join('\n'), /IOT_SYNC_KEY is short/);
});

test('shared chat behavior lives in services instead of route modules', () => {
  const chatRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.routes.js'), 'utf8');
  const lineRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'line.routes.js'), 'utf8');
  const lineB2CService = fs.readFileSync(path.join(__dirname, '..', 'services', 'line-b2c.service.js'), 'utf8');
  const partnerService = fs.readFileSync(path.join(__dirname, '..', 'services', 'partner.service.js'), 'utf8');

  assert.doesNotMatch(lineRoute, /require\(['"]\.\/chat\.routes['"]\)/);
  assert.doesNotMatch(partnerService, /require\(['"]\.\.\/routes\/chat\.routes['"]\)/);
  assert.match(chatRoute, /services\/session\.service/);
  assert.match(chatRoute, /services\/knowledge-gap\.util/);
  assert.match(chatRoute, /services\/station-response\.service/);
  assert.match(chatRoute, /services\/conversation-history\.service/);
  assert.match(lineB2CService, /conversation-history\.service/);
  assert.match(lineB2CService, /station-response\.service/);
});

test('IoT sync authentication retains ADMIN_KEY compatibility when no dedicated key is set', () => {
  const previousAdmin = process.env.ADMIN_KEY;
  const previousSync = process.env.IOT_SYNC_KEY;
  process.env.ADMIN_KEY = 'admin-key-with-enough-length';
  delete process.env.IOT_SYNC_KEY;

  let statusCode = 0;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };

  try {
    requireIotSyncKey(
      { headers: { 'x-admin-key': process.env.ADMIN_KEY } },
      res,
      () => { nextCalled = true; }
    );
  } finally {
    if (previousAdmin === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = previousAdmin;
    if (previousSync === undefined) delete process.env.IOT_SYNC_KEY;
    else process.env.IOT_SYNC_KEY = previousSync;
  }

  assert.equal(statusCode, 0);
  assert.equal(nextCalled, true);
});

test('PostgreSQL SSL modes distinguish encryption from certificate verification', () => {
  const { getPostgresPoolConfig, getPostgresSslConfig, validateRuntimeConfig } = require('../server');
  const importScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'import-knowledge-json.js'), 'utf8');
  const syncScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-iot-stations-to-postgres.js'), 'utf8');
  const snapshotScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'export-iot-station-snapshot.js'), 'utf8');
  const baseEnv = {
    DATABASE_URL: 'postgresql://example',
    ANTHROPIC_API_KEY: 'anthropic-key',
    ADMIN_KEY: 'admin-key-with-enough-length',
    SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
    IOT_SYNC_KEY: 'test-iot-sync-key-with-24-chars',
  };

  assert.equal(getPostgresSslConfig({ PGSSL: 'disable' }), false);
  assert.deepEqual(getPostgresSslConfig({ PGSSL: 'require' }), { rejectUnauthorized: false });
  assert.deepEqual(getPostgresSslConfig({ PGSSL: 'verify-full' }), { rejectUnauthorized: true });
  assert.deepEqual(getPostgresSslConfig({}), { rejectUnauthorized: true });
  const poolConfig = getPostgresPoolConfig({
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1/db?sslmode=require&channel_binding=require',
    PGSSL: 'verify-full',
  });
  assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(poolConfig.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(poolConfig.connectionString).searchParams.get('channel_binding'), 'require');
  assert.match(
    validateRuntimeConfig({ ...baseEnv, PGSSL: 'require' }).warnings.join('\n'),
    /does not verify the server certificate/
  );
  assert.match(importScript, /getPostgresPoolConfig/);
  assert.match(syncScript, /getPostgresPoolConfig/);
  assert.match(syncScript, /ECOCO_IOT_MYSQL_SSL_REJECT_UNAUTHORIZED \|\| 'true'/);
  assert.match(snapshotScript, /ECOCO_IOT_MYSQL_SSL_REJECT_UNAUTHORIZED \|\| 'true'/);
});

test('admin IoT routes use async error handling', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /function asyncHandler/);
  assert.match(server, /app\.post\('\/api\/iot\/station-statuses\/sync', iotSyncLimiter, requireIotSyncKey, asyncHandler/);
  assert.match(server, /app\.get\('\/api\/iot\/station-statuses\/search', adminGuard, asyncHandler/);
  assert.match(server, /app\.use\(\(err, req, res, next\) =>/);
});

test('readJsonFile returns null instead of throwing on malformed JSON', () => {
  const { readJsonFile } = require('../server');
  const tempRelativePath = path.join('tests', `.tmp-bad-json-${Date.now()}.json`);
  const tempPath = path.join(__dirname, '..', tempRelativePath);

  fs.writeFileSync(tempPath, '{bad json', 'utf8');
  try {
    assert.equal(readJsonFile(tempRelativePath), null);
  } finally {
    fs.unlinkSync(tempPath);
  }
});

test('internal mode requires a staff key and customer mode does not', () => {
  const { validateRuntimeConfig } = require('../server');
  const baseEnv = {
    DATABASE_URL: 'postgresql://example',
    ANTHROPIC_API_KEY: 'anthropic-key',
    ADMIN_KEY: 'admin-key-with-enough-length',
    SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
    IOT_SYNC_KEY: 'test-iot-sync-key-with-24-chars',
  };

  assert.equal(isInternalMode({ APP_MODE: 'internal' }), true);
  assert.equal(isInternalMode({ APP_MODE: 'customer' }), false);
  assert.equal(validateRuntimeConfig({ ...baseEnv, APP_MODE: 'customer' }).errors.includes('STAFF_KEY is required when APP_MODE=internal'), false);
  assert.match(validateRuntimeConfig({ ...baseEnv, APP_MODE: 'internal' }).errors.join('\n'), /STAFF_KEY/);
  assert.equal(validateRuntimeConfig({ ...baseEnv, APP_MODE: 'internal', STAFF_KEY: 'staff-key-with-enough-length' }).errors.length, 0);
});

test('public health check does not expose internal runtime details by default', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /app\.get\('\/api\/system\/status', adminGuard/);
  assert.match(server, /includeDetails = false/);
  assert.match(server, /X-Robots-Tag/);
});

test('server handles database pool errors and Render shutdown signals', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /pool\.on\('error'/);
  assert.match(server, /process\.on\('unhandledRejection'/);
  assert.match(server, /process\.on\('SIGTERM'/);
  assert.match(server, /pool\.end\(\)/);
});

test('CSP blocks inline JavaScript and inline style execution', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard-v2.html'), 'utf8');
  const inlineHandlerPattern = /\son(?:click|change|input|keydown|submit)\s*=|\.onclick\s*=/i;
  const inlineScriptPattern = /<script(?![^>]*\bsrc=)[^>]*>/i;
  const inlineStylePattern = /\sstyle\s*=/i;
  const inlineStyleBlockPattern = /<style[\s>]/i;

  assert.doesNotMatch(server, /scriptSrc:\s*\[[^\]]*unsafe-inline/);
  assert.match(server, /scriptSrcAttr:\s*\[\s*["']'none'["']/);
  assert.doesNotMatch(server, /styleSrc:\s*\[[^\]]*unsafe-inline/);
  assert.match(server, /styleSrcAttr:\s*\[\s*["']'none'["']/);
  assert.doesNotMatch(indexHtml, inlineHandlerPattern);
  assert.doesNotMatch(dashboardHtml, inlineHandlerPattern);
  assert.doesNotMatch(indexHtml, inlineScriptPattern);
  assert.doesNotMatch(dashboardHtml, inlineScriptPattern);
  assert.doesNotMatch(indexHtml, inlineStylePattern);
  assert.doesNotMatch(dashboardHtml, inlineStylePattern);
  assert.doesNotMatch(indexHtml, inlineStyleBlockPattern);
  assert.doesNotMatch(dashboardHtml, inlineStyleBlockPattern);
});

test('LINE webhook signature verification accepts only valid signatures', () => {
  const channelSecret = 'line-test-secret';
  const body = Buffer.from(JSON.stringify({ events: [] }));
  const validSignature = require('node:crypto')
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  assert.equal(verifyLineSignature({ body, signature: validSignature, channelSecret }), true);
  assert.equal(verifyLineSignature({ body, signature: 'invalid', channelSecret }), false);
});

test('LINE signature comparison pads unequal lengths before timing-safe compare', () => {
  const lineSharedService = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'line-shared.service.js'),
    'utf8'
  );

  assert.equal(safeCompare('abc', 'abc'), true);
  assert.equal(safeCompare('abc', 'abcd'), false);
  assert.equal(safeCompare('abc\0', 'abc'), false);
  assert.equal(compareSecret('key-value', 'key-value'), true);
  assert.equal(compareSecret('key-value', 'key-value\0'), false);
  assert.equal(compareSecret('', ''), false);
  assert.equal(lineSharedService.includes('left.length !== right.length) return false'), false);
});

test('LINE route is wired and documented through environment variables', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'LINE_INTEGRATION_GUIDE.md'), 'utf8');
  const config = getLineConfig({
    LINE_CHANNEL_SECRET: 'secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'token',
  });

  assert.match(server, /createLineRouter/);
  assert.match(server, /req\.rawBody = buf/);
  assert.match(envExample, /LINE_CHANNEL_SECRET/);
  assert.match(envExample, /LINE_CHANNEL_ACCESS_TOKEN/);
  assert.match(envExample, /\/api\/line\/webhook/);
  assert.match(guide, /\/api\/line\/webhook/);
  assert.match(guide, /LINE_CHANNEL_SECRET/);
  assert.match(guide, /LINE_CHANNEL_ACCESS_TOKEN/);
  assert.deepEqual(config, {
    channelSecret: 'secret',
    channelAccessToken: 'token',
  });
});

test('LINE replies are converted to plain text before sending', () => {
  const text = toLineText('## 標題\n\n**重點**：請看 [ECOCO](https://ecoco.example.com)\n\n`code`');

  assert.equal(text.includes('##'), false);
  assert.equal(text.includes('**'), false);
  assert.equal(text.includes('`'), false);
  assert.match(text, /標題/);
  assert.match(text, /ECOCO https:\/\/ecoco\.example\.com/);
});

test('LINE webhook reuses server-side conversation history', () => {
  const lineB2CService = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'line-b2c.service.js'),
    'utf8'
  );

  assert.match(lineB2CService, /loadServerConversationHistory/);
  assert.match(lineB2CService, /normalizeModelMessages/);
  assert.match(lineB2CService, /buildLineModelMessages/);
  assert.match(lineB2CService, /messages: modelMessages/);
});

test('LINE webhook events are claimed once and completed events are skipped', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: calls.length === 1 ? [{ event_id: params[0] }] : [] };
    },
  };
  const event = {
    webhookEventId: 'evt-123',
    deliveryContext: { isRedelivery: true },
  };

  const first = await claimLineWebhookEvent(pool, event);
  const duplicate = await claimLineWebhookEvent(pool, event);

  assert.deepEqual(first, { claimed: true, eventId: 'evt-123' });
  assert.deepEqual(duplicate, { claimed: false, eventId: 'evt-123' });
  assert.match(calls[0].sql, /ON CONFLICT \(event_id\)/);
  assert.deepEqual(calls[0].params, ['evt-123', true]);
});

test('LINE webhook URL defaults to the current Render service', () => {
  assert.equal(
    getExpectedLineWebhookUrl({
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://ecoco-customer-servic.onrender.com/',
    }),
    'https://ecoco-customer-servic.onrender.com/api/line/webhook'
  );
  assert.equal(
    getExpectedLineWebhookUrl({
      LINE_WEBHOOK_URL: 'https://example.com/custom-line',
      RENDER_EXTERNAL_URL: 'https://ignored.onrender.com',
    }),
    'https://example.com/custom-line'
  );
});

test('production startup repairs a LINE webhook that points to an old Render service', async () => {
  const calls = [];
  const responses = [
    { status: 200, body: { endpoint: 'https://ecoco-linebot.onrender.com/api/line/webhook', active: true } },
    { status: 200, body: {} },
    { status: 200, body: { endpoint: 'https://ecoco-customer-servic.onrender.com/api/line/webhook', active: true } },
  ];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    const response = responses.shift();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    };
  };

  const result = await ensureLineWebhookEndpoint({
    env: {
      RENDER: 'true',
      IS_PULL_REQUEST: 'false',
      RENDER_EXTERNAL_URL: 'https://ecoco-customer-servic.onrender.com',
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    },
    fetchFn,
  });

  assert.equal(result.endpointMatches, true);
  assert.equal(result.active, true);
  assert.equal(result.autoConfigured, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    endpoint: 'https://ecoco-customer-servic.onrender.com/api/line/webhook',
  });
});

test('production startup creates the LINE webhook when the channel has no endpoint', async () => {
  const calls = [];
  const responses = [
    { status: 404, body: { message: 'Not found' } },
    { status: 200, body: {} },
    { status: 200, body: { endpoint: 'https://ecoco-customer-servic.onrender.com/api/line/webhook', active: true } },
  ];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    const response = responses.shift();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    };
  };

  const result = await ensureLineWebhookEndpoint({
    env: {
      RENDER: 'true',
      IS_PULL_REQUEST: 'false',
      RENDER_EXTERNAL_URL: 'https://ecoco-customer-servic.onrender.com',
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    },
    fetchFn,
  });

  assert.equal(result.endpointMatches, true);
  assert.equal(result.autoConfigured, true);
  assert.equal(calls[1].options.method, 'PUT');
});

test('LINE webhook auto-configuration never mutates pull request previews', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        endpoint: 'https://old.example.com/api/line/webhook',
        active: true,
      }),
      text: async () => '',
    };
  };

  const result = await ensureLineWebhookEndpoint({
    env: {
      RENDER: 'true',
      IS_PULL_REQUEST: 'true',
      RENDER_EXTERNAL_URL: 'https://preview.onrender.com',
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    },
    fetchFn,
  });

  assert.equal(result.endpointMatches, false);
  assert.equal(result.autoConfigured, false);
  assert.equal(calls.length, 1);
});

test('LINE webhook emits privacy-safe operational checkpoints', () => {
  const lineRoute = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'line.routes.js'),
    'utf8'
  );

  assert.match(lineRoute, /LINE webhook accepted:/);
  assert.match(lineRoute, /LINE webhook event claimed:/);
  assert.match(lineRoute, /LINE webhook handled:/);
  assert.match(lineRoute, /LINE message delivered:/);
  assert.doesNotMatch(lineRoute, /console\.(?:log|info).*userText/);
});

test('LINE webhook rate limits a single sender before API calls', () => {
  const env = { LINE_RATE_LIMIT_MAX_EVENTS: '2' };
  const sessionId = `line_test_${Date.now()}`;
  const now = 1000;

  assert.equal(isLineRateLimited(sessionId, now, env), false);
  assert.equal(isLineRateLimited(sessionId, now + 100, env), false);
  assert.equal(isLineRateLimited(sessionId, now + 200, env), true);
  assert.equal(isLineRateLimited(sessionId, now + 61_000, env), false);
});

test('LINE location messages return a usable query or an explicit validation error', () => {
  const valid = parseLineLocationMessage({
    type: 'location',
    latitude: 24.1219,
    longitude: 120.6748,
    title: '國立中興大學',
  });
  assert.equal(valid.errorReply, '');
  assert.equal(valid.text, '查詢「國立中興大學」附近的 ECOCO 站點');
  assert.equal(valid.coords.lat, 24.1219);

  const invalid = parseLineLocationMessage({
    type: 'location',
    latitude: 35.6762,
    longitude: 139.6503,
  });
  assert.equal(invalid.coords, null);
  assert.match(invalid.errorReply, /無法讀取這個位置/);
});

test('LINE rate limit and timeout replies are not stored as conversation history', () => {
  const lineB2CService = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'line-b2c.service.js'),
    'utf8'
  );
  const lineRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'line.routes.js'), 'utf8');

  assert.match(lineB2CService, /let shouldStoreConversation = true/);
  assert.match(lineB2CService, /shouldStoreConversation = false/);
  assert.match(lineB2CService, /line_rate_limited/);
  assert.match(lineB2CService, /line_timeout/);
  assert.match(lineRoute, /if \(outcome\.shouldStoreConversation\)/);
});

test('LINE rate limit buckets are pruned before unbounded growth', () => {
  const now = 10_000;
  for (let index = 0; index < LINE_RATE_LIMIT_MAX_BUCKETS + 25; index += 1) {
    isLineRateLimited(`line_bulk_${Date.now()}_${index}`, now, { LINE_RATE_LIMIT_MAX_EVENTS: '10' });
  }

  assert.ok(cleanupLineRateBuckets(now + 1, true) <= LINE_RATE_LIMIT_MAX_BUCKETS);
});

test('LINE reply timeout is configurable and capped below token expiry', async () => {
  assert.equal(getLineReplyTimeoutMs({}), 25_000);
  assert.equal(getLineReplyTimeoutMs({ LINE_REPLY_TIMEOUT_MS: '60000' }), 25_000);
  assert.equal(getLineReplyTimeoutMs({ LINE_REPLY_TIMEOUT_MS: '12000' }), 12_000);
  assert.equal(getLineReplyTimeoutMs({ LINE_REPLY_TIMEOUT_MS: 'bad' }), 25_000);
  assert.equal(getLineTimeoutReply({ LINE_TIMEOUT_REPLY: '稍後回覆' }), '稍後回覆');

  const result = await resolveWithTimeout(new Promise(resolve => setTimeout(() => resolve('late'), 20)), 1, 'timeout');
  assert.deepEqual(result, { timedOut: true, value: 'timeout' });

  const fast = await resolveWithTimeout(Promise.resolve('ok'), 20, 'timeout');
  assert.deepEqual(fast, { timedOut: false, value: 'ok' });
});

test('LINE delivery falls back to a group push when the reply token expired', async () => {
  const calls = [];
  const replyError = new Error('LINE Reply API failed: 400 {"message":"Invalid reply token"}');
  replyError.status = 400;
  replyError.responseBody = '{"message":"Invalid reply token"}';

  const result = await deliverLineMessage({
    event: {
      replyToken: 'expired-token',
      source: { type: 'group', groupId: 'group-fullmart' },
    },
    text: '全家合作資料',
    channelAccessToken: 'test-token',
  }, {
    replyFn: async params => {
      calls.push({ type: 'reply', params });
      throw replyError;
    },
    pushFn: async params => {
      calls.push({ type: 'push', params });
    },
  });

  assert.equal(result.deliveryMode, 'push');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.to, 'group-fullmart');
  assert.equal(calls[1].params.text, '全家合作資料');
});

test('graceful shutdown waits for in-flight LINE webhook work', async () => {
  const tracker = createInFlightTaskTracker();
  const finish = tracker.begin();
  let drained = false;
  const draining = tracker.waitForIdle(100).then(result => {
    drained = result;
  });

  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(drained, false);
  assert.equal(tracker.size(), 1);

  finish();
  await draining;
  assert.equal(drained, true);
  assert.equal(tracker.size(), 0);

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(
    serverSource,
    /httpServer\.close[\s\S]*lineWebhookTaskTracker\.waitForIdle[\s\S]*pool\.end/
  );
});

test('LINE reply timeout aborts the underlying request via onTimeout hook', async () => {
  const controller = new AbortController();
  let aborted = false;
  controller.signal.addEventListener('abort', () => { aborted = true; });

  const slow = new Promise(resolve => setTimeout(() => resolve('late'), 30));
  const result = await resolveWithTimeout(slow, 1, 'timeout', () => controller.abort());

  assert.equal(result.timedOut, true);
  assert.equal(aborted, true);

  const fastController = new AbortController();
  let fastAborted = false;
  fastController.signal.addEventListener('abort', () => { fastAborted = true; });
  const fast = await resolveWithTimeout(Promise.resolve('ok'), 30, 'timeout', () => fastController.abort());

  assert.equal(fast.timedOut, false);
  assert.equal(fastAborted, false);
});

test('LINE buildAiReply passes abort signal and flags max_tokens as gap', async () => {
  const calls = [];
  const fakeClient = {
    messages: {
      create: async (params, options) => {
        calls.push({ params, options });
        return {
          stop_reason: 'max_tokens',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '被截斷的回覆' }],
        };
      },
    },
  };
  const fakePool = { query: async () => ({ rows: [] }) };
  const controller = new AbortController();

  const reply = await buildAiReply({
    pool: fakePool,
    sessionId: 'line_test',
    client: fakeClient,
    text: '測試問題',
    retrieveKnowledgeForQuestion: async () => ({ retrievalMode: 'none', chunks: [], context: '' }),
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => 'system',
    buildSystemPromptBlocks: null,
    defaultAnthropicModel: 'claude-sonnet-4-6',
    signal: controller.signal,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(detectKnowledgeGap(reply).isGap, true);
  assert.equal(stripKnowledgeGapMarker(reply), '被截斷的回覆');
});

test('weekly AI analysis script reads current API field names', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ai-analysis.mjs'), 'utf8');

  assert.match(script, /nodemailer/);
  assert.match(script, /sendMailReport/);
  assert.match(script, /MAIL_USER/);
  assert.match(script, /MAIL_PASS/);
  assert.match(script, /MAIL_TO/);
  assert.match(script, /\/api\/system\/status/);
  assert.match(script, /status\.anthropicModel/);
  assert.match(script, /status\.semanticRagEnabled/);
  assert.match(script, /overview\.dbSectionCount/);
  assert.match(script, /overview\.ragChunkCount/);
  assert.match(script, /summary\.sessions/);
  assert.match(script, /summary\.aiReplies/);
  assert.match(script, /countPendingUnanswered/);
  assert.equal(script.includes('health.ok'), false);
  assert.equal(script.includes('overview.postgres_sections'), false);
  assert.equal(script.includes('operations.summary?.ticket_count'), false);
});

test('system prompt caching is split between static and dynamic blocks', () => {
  const promptService = createPromptService({
    responsePolicies: [{ intent: 'Static policy content', automation_level: 'auto' }],
  });
  const blocks = promptService.buildSystemPromptBlocks('RAG_DYNAMIC_CONTENT', 'DYNAMIC_GUARDRAIL');

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
  assert.equal(blocks[1].cache_control, undefined);
  assert.match(blocks[0].text, /Static policy content/);
  assert.equal(blocks[0].text.includes('RAG_DYNAMIC_CONTENT'), false);
  assert.match(blocks[1].text, /RAG_DYNAMIC_CONTENT/);
  assert.match(blocks[1].text, /DYNAMIC_GUARDRAIL/);
});

test('RAG miss does not fall back to the full knowledge cache', () => {
  const promptService = createPromptService({
    getKnowledgeCache: () => 'FULL_KNOWLEDGE_SHOULD_NOT_APPEAR',
  });
  const blocks = promptService.buildSystemPromptBlocks('', '');
  const text = blocks.map(block => block.text).join('\n');

  assert.equal(text.includes('FULL_KNOWLEDGE_SHOULD_NOT_APPEAR'), false);
  assert.match(text, /沒有檢索到足夠相關/);
});

test('timestamp column migration is conditional instead of running ALTER on every startup', () => {
  const schemaText = SCHEMA.join('\n');

  assert.equal(schemaText.includes('ALTER COLUMN timestamp TYPE TIMESTAMPTZ'), false);
  assert.match(schemaText, /conversations ADD COLUMN IF NOT EXISTS message_id/);
  assert.match(schemaText, /idx_conv_session_message/);
  assert.equal(typeof migrateTimestampColumns, 'function');
});

test('message-id dedupe is guarded and kept outside the startup schema list', () => {
  const schemaText = SCHEMA.join('\n');
  const schemaFile = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.js'), 'utf8');

  assert.doesNotMatch(schemaText, /DELETE FROM ratings duplicate/);
  assert.doesNotMatch(schemaText, /DELETE FROM conversations duplicate/);
  assert.match(schemaFile, /SELECT EXISTS[\s\S]*FROM conversations duplicate/);
  assert.match(schemaFile, /SELECT EXISTS[\s\S]*FROM ratings duplicate/);
  assert.match(schemaFile, /if \(hasConversationDuplicates\)[\s\S]*DELETE FROM conversations duplicate/);
  assert.match(schemaFile, /if \(hasRatingDuplicates\)[\s\S]*DELETE FROM ratings duplicate/);
});

test('message-id migration deletes rows only when duplicate guards find data', async () => {
  const runMigration = async duplicateResults => {
    const queries = [];
    let resultIndex = 0;
    const db = {
      async query(sql) {
        queries.push(sql);
        if (/SELECT EXISTS/.test(sql)) {
          return { rows: [{ exists: duplicateResults[resultIndex++] }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    await migrateUniqueMessageIndexes({ connect: async () => db });
    return queries;
  };

  const cleanQueries = await runMigration([false, false]);
  const duplicateQueries = await runMigration([true, true]);

  assert.equal(cleanQueries.some(sql => /DELETE FROM conversations duplicate/.test(sql)), false);
  assert.equal(cleanQueries.some(sql => /DELETE FROM ratings duplicate/.test(sql)), false);
  assert.equal(duplicateQueries.some(sql => /DELETE FROM conversations duplicate/.test(sql)), true);
  assert.equal(duplicateQueries.some(sql => /DELETE FROM ratings duplicate/.test(sql)), true);
  assert.equal(duplicateQueries.filter(sql => /CREATE UNIQUE INDEX IF NOT EXISTS/.test(sql)).length, 2);
});

test('internal wiki uses a separate staff-only schema and normalized filters', () => {
  const schemaText = SCHEMA.join('\n');
  const entry = cleanWikiEntryInput({
    department: '客服 部門',
    visibility: 'manager',
    title: '  新人訓練 SOP  ',
    content: '內部教材',
    tags: ['training', '客服'],
  });

  assert.match(schemaText, /internal_wiki_entries/);
  assert.match(schemaText, /idx_internal_wiki_department/);
  assert.equal(normalizeDepartment('CS Team'), 'cs-team');
  assert.equal(normalizeVisibility('unknown'), 'staff');
  assert.deepEqual(entry, {
    department: 'general',
    visibility: 'manager',
    title: '新人訓練 SOP',
    content: '內部教材',
    tags: 'training, 客服',
  });
  assert.equal(validateWikiEntry(entry), '');
  assert.match(validateWikiEntry({ ...entry, title: '' }), /Title is required/);
});

test('internal wiki routes are mounted only for internal app mode', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

  assert.match(server, /isInternalMode\(\)/);
  assert.match(server, /\/api\/internal/);
  assert.match(server, /createInternalRouter/);
  assert.match(envExample, /APP_MODE=customer/);
  assert.match(envExample, /STAFF_KEY=/);
});

test('internal wiki search treats PostgreSQL wildcard characters as literals', () => {
  const internalRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'internal.routes.js'), 'utf8');

  assert.equal(escapeWikiSearchTerm('APP_100%\\test'), 'APP\\_100\\%\\\\test');
  assert.match(internalRoute, /ESCAPE '\\\\'/);
  assert.match(internalRoute, /escapeWikiSearchTerm/);
});

test('internal wiki async handlers are wrapped with JSON error handling', () => {
  const internalRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'internal.routes.js'), 'utf8');

  assert.match(internalRoute, /function asyncHandler/);
  assert.match(internalRoute, /catch\(next\)/);
  assert.match(internalRoute, /Internal wiki route error/);
});

test('knowledge writes use transaction advisory locks around duplicate checks', () => {
  const knowledgeRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'knowledge.routes.js'), 'utf8');

  assert.match(knowledgeRoute, /pg_advisory_xact_lock/);
  assert.match(knowledgeRoute, /await db\.query\('BEGIN'\)/);
  assert.match(knowledgeRoute, /await db\.query\('COMMIT'\)/);
  assert.match(knowledgeRoute, /Duplicate active knowledge category/);
});

test('section chunk refresh shifts following sort orders when chunk count changes', () => {
  const ragService = fs.readFileSync(path.join(__dirname, '..', 'services', 'rag.service.js'), 'utf8');

  assert.match(ragService, /old_chunk_count/);
  assert.match(ragService, /UPDATE knowledge_chunks[\s\S]*sort_order = sort_order \+ \$1/);
  assert.match(ragService, /KNOWLEDGE_CHUNK_LOCK_ID/);
});

test('admin notes are truncated before database writes', () => {
  const longNote = 'x'.repeat(MAX_ADMIN_NOTE_CHARS + 50);
  const normalized = normalizeAdminNote(`  ${longNote}  `);
  const unansweredRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'unanswered.routes.js'), 'utf8');

  assert.equal(normalized.length, MAX_ADMIN_NOTE_CHARS);
  assert.match(unansweredRoute, /unanswered\.update/);
  assert.match(unansweredRoute, /unanswered\.delete/);
  assert.match(unansweredRoute, /saveAdminAudit/);
});

test('knowledge cache is not kept as a server-wide prompt fallback', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const knowledgeRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'knowledge.routes.js'), 'utf8');

  assert.equal(server.includes('let knowledgeCache'), false);
  assert.equal(server.includes('refreshKnowledgeCache'), false);
  assert.match(knowledgeRoute, /SELECT category, content FROM knowledge_sections/);
  assert.match(knowledgeRoute, /Failed to load merged knowledge/);
});

test('dashboard search escapes ILIKE wildcard characters', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dashboard.routes.js'), 'utf8');

  assert.equal(escapeIlikePattern('APP_100%\\test'), 'APP\\_100\\%\\\\test');
  assert.match(route, /ESCAPE '\\\\'/);
  assert.match(route, /escapeIlikePattern/);
});

test('informational questions with high-risk keywords route to RAG', () => {
  // 「可以…嗎」「需要…嗎」是規則問法，不是個案；退費/付款字眼不應直接轉人工。
  for (const q of ['優惠券可以退費嗎', '可以用信用卡付款嗎', '優惠券兌換需要付款嗎']) {
    const r = classifyQuestion(q);
    assert.equal(r.shouldUseRag, true, q);
    assert.equal(r.category, 'high_risk_policy', q);
  }
});

test('personal high-risk cases still escalate to human support', () => {
  for (const q of ['我要退款', '幫我退費', '我沒有收到退款', '我的帳號被盜了']) {
    const r = classifyQuestion(q);
    assert.equal(r.shouldUseRag, false, q);
    assert.equal(r.shouldEscalate, true, q);
  }
});

test('customer-service info questions route to RAG instead of the canned reply', () => {
  for (const q of ['客服時間是幾點到幾點', '你們有客服電話嗎', '個資保護政策是什麼']) {
    const r = classifyQuestion(q);
    assert.equal(r.shouldUseRag, true, q);
    assert.equal(r.category, 'customer_service_info', q);
  }
});

test('explicit human requests still short-circuit to the escalation reply', () => {
  for (const q of ['我要找真人客服', '轉接人工']) {
    const r = classifyQuestion(q);
    assert.equal(r.shouldUseRag, false, q);
    assert.equal(r.shouldEscalate, true, q);
  }
});

test('small talk requires the whole message to be a greeting', () => {
  for (const q of ['你好', '哈囉！', 'hi']) {
    assert.equal(classifyQuestion(q).category, 'small_talk', q);
  }
  for (const q of ['測試投遞失敗怎麼辦', 'hello kitty 聯名商品還有嗎']) {
    const r = classifyQuestion(q);
    assert.notEqual(r.category, 'small_talk', q);
    assert.equal(r.shouldUseRag, true, q);
  }
});
