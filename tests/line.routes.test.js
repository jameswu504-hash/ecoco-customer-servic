// Integration tests for routes/line.routes.js (LINE webhook handling gap).
// External services are mocked: the Anthropic client is a stub object, and the
// LINE reply HTTPS call is intercepted via a global fetch mock. No real network.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
  buildAiReply,
  buildLineModelMessages,
  buildLineSessionId,
  createLineRouter,
  replyToLine,
  storeLineConversation,
  toLineText,
} = require('../routes/line.routes');

const {
  loadServerConversationHistory,
  normalizeModelMessages,
} = require('../routes/chat.routes');

// ---- mock helpers -----------------------------------------------------------

function makePool(rowsBySql = {}) {
  return {
    query(sql, params) {
      for (const [needle, result] of Object.entries(rowsBySql)) {
        if (sql.includes(needle)) return Promise.resolve(result);
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

function makeAnthropicClient(replyText) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: replyText }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };
}

// Install a fetch mock that only answers the LINE reply endpoint.
function installLineFetchMock(onCall) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    onCall(url, opts);
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
    };
  };
  return () => { globalThis.fetch = original; };
}

function listenApp(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server));
  });
}

function request(server, { path, method = 'POST', body, headers = {}, rawBody }) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (rawBody !== undefined) req.rawBody = rawBody;
    req.end(payload);
  });
}

const noopRag = () => ({ retrievalMode: 'none', chunks: [], context: '' });
const noopGuardrails = () => '';
const noopSystemPrompt = () => [{ type: 'text', text: 'system' }];

// ---- unit-level function tests ---------------------------------------------

test('buildLineModelMessages returns just the user message without pool', async () => {
  const messages = await buildLineModelMessages({ pool: null, sessionId: null, text: '我的點數呢' });
  assert.deepEqual(messages, [{ role: 'user', content: '我的點數呢' }]);
});

test('buildLineModelMessages loads history from pool and normalizes', async () => {
  const pool = makePool({
    'FROM conversations': { rows: [
      { role: 'user', content: '早安' },
      { role: 'assistant', content: '您好' },
    ] },
  });
  const messages = await buildLineModelMessages({ pool, sessionId: 'line_x', text: '點數查詢' });
  // normalizeModelMessages merges consecutive user messages into one block
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[messages.length - 1], { role: 'user', content: '早安\n\n點數查詢' });
});

test('buildLineSessionId hashes the LINE user/source id deterministically', () => {
  const a = buildLineSessionId({ source: { userId: 'U123' } });
  const b = buildLineSessionId({ source: { userId: 'U123' } });
  const c = buildLineSessionId({ source: { userId: 'U999' } });
  assert.ok(a.startsWith('line_'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('toLineText strips markdown and links for LINE plaintext', () => {
  const text = toLineText('## 標題\n\n**重點**：請看 [ECOCO](https://ecoco.example.com)\n\n`code`');
  assert.equal(text.includes('##'), false);
  assert.equal(text.includes('**'), false);
  assert.equal(text.includes('`'), false);
  assert.match(text, /標題/);
  assert.match(text, /ECOCO https:\/\/ecoco\.example\.com/);
});

test('replyToLine posts to the LINE reply endpoint with the bearer token (mocked)', async () => {
  let calledUrl = null;
  let calledAuth = null;
  let calledBody = null;
  const restore = installLineFetchMock((url, opts) => {
    calledUrl = url;
    calledAuth = opts.headers.Authorization;
    calledBody = JSON.parse(opts.body);
  });
  try {
    await replyToLine({ replyToken: 'TOKEN123', text: '你好', channelAccessToken: 'secret-token' });
    assert.equal(calledUrl, 'https://api.line.me/v2/bot/message/reply');
    assert.equal(calledAuth, 'Bearer secret-token');
    assert.equal(calledBody.replyToken, 'TOKEN123');
    assert.equal(calledBody.messages[0].type, 'text');
    assert.equal(calledBody.messages[0].text, '你好');
  } finally {
    restore();
  }
});

test('buildAiReply calls Claude, saves a trace and returns the reply text', async () => {
  let traceSaved = false;
  const pool = {
    async query(sql) {
      if (sql.includes('INSERT INTO chat_traces')) traceSaved = true;
      return { rows: [] };
    },
  };
  const client = makeAnthropicClient('這是 AI 回覆');
  const reply = await buildAiReply({
    pool,
    sessionId: 'line_s1',
    client,
    text: '我的點數',
    retrieveKnowledgeForQuestion: noopRag,
    buildRuntimeGuardrails: noopGuardrails,
    buildSystemPromptBlocks: noopSystemPrompt,
    defaultAnthropicModel: 'claude-test',
  });
  assert.equal(reply, '這是 AI 回覆');
  assert.equal(traceSaved, true);
});

test('storeLineConversation writes the exchange and a gap row when reply is a gap', async () => {
  const inserts = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO conversations')) inserts.push('conversation');
      if (sql.includes('INSERT INTO unanswered_questions')) inserts.push('gap');
      return { rows: [] };
    },
  };
  const gapReply = '目前沒有足夠資料可以確認，建議您透過客服表單補充資訊。';
  await storeLineConversation({ pool, sessionId: 'line_s2', question: '奇怪的問題', reply: gapReply });
  assert.deepEqual(inserts, ['conversation', 'gap']);
});

test('storeLineConversation writes only the conversation when reply is not a gap', async () => {
  const inserts = [];
  const pool = {
    async query(sql) {
      if (sql.includes('INSERT INTO conversations')) inserts.push('conversation');
      if (sql.includes('INSERT INTO unanswered_questions')) inserts.push('gap');
      return { rows: [] };
    },
  };
  await storeLineConversation({ pool, sessionId: 'line_s3', question: '一般問題', reply: '這是正常回覆' });
  assert.deepEqual(inserts, ['conversation']);
});

// ---- router-level integration (real express app + mocked external services) --

test('createLineRouter: 503 when LINE is not configured', async () => {
  const app = express();
  app.use('/api', createLineRouter({
    pool: makePool(),
    client: makeAnthropicClient('x'),
    retrieveKnowledgeForQuestion: noopRag,
    buildRuntimeGuardrails: noopGuardrails,
    buildSystemPromptBlocks: noopSystemPrompt,
    defaultAnthropicModel: 'claude-test',
  }));
  const server = await listenApp(app);
  try {
    const res = await request(server, { path: '/api/line/webhook', body: { events: [] } });
    assert.equal(res.status, 503);
  } finally {
    server.close();
  }
});

test('createLineRouter: 401 on invalid LINE signature', async () => {
  process.env.LINE_CHANNEL_SECRET = 'line-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
  const app = express();
  app.use(express.json());
  app.use('/api', createLineRouter({
    pool: makePool(),
    client: makeAnthropicClient('x'),
    retrieveKnowledgeForQuestion: noopRag,
    buildRuntimeGuardrails: noopGuardrails,
    buildSystemPromptBlocks: noopSystemPrompt,
    defaultAnthropicModel: 'claude-test',
  }));
  const server = await listenApp(app);
  try {
    const body = { events: [] };
    const res = await request(server, {
      path: '/api/line/webhook',
      body,
      headers: { 'x-line-signature': 'invalid-signature' },
      rawBody: Buffer.from(JSON.stringify(body)),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
});

test('createLineRouter: full webhook flow replies via LINE and stores the conversation (mocked)', async () => {
  process.env.LINE_CHANNEL_SECRET = 'line-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';

  const recorded = { lineCalls: 0, conversationInserts: 0, gapInserts: 0 };
  const pool = {
    async query(sql) {
      if (sql.includes('INSERT INTO conversations')) recorded.conversationInserts += 1;
      if (sql.includes('INSERT INTO unanswered_questions')) recorded.gapInserts += 1;
      if (sql.includes('FROM conversations')) return { rows: [] };
      return { rows: [] };
    },
  };
  const client = makeAnthropicClient('已收到您的問題，我們協助查詢點數。');

  const restore = installLineFetchMock(() => { recorded.lineCalls += 1; });

  const app = express();
  // Replicate server.js: capture the raw body (used by LINE signature
  // verification) via express.json's verify hook without consuming the stream.
  app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; },
  }));
  app.use('/api', createLineRouter({
    pool,
    client,
    retrieveKnowledgeForQuestion: noopRag,
    buildRuntimeGuardrails: noopGuardrails,
    buildSystemPromptBlocks: noopSystemPrompt,
    defaultAnthropicModel: 'claude-test',
  }));
  const server = await listenApp(app);
  try {
    const body = {
      events: [{
        type: 'message',
        message: { type: 'text', text: '我的點數在哪' },
        replyToken: 'REPLY_TOKEN_1',
        source: { userId: 'U123LINE' },
      }],
    };
    const res = await request(server, {
      path: '/api/line/webhook',
      body,
      headers: { 'x-line-signature': require('crypto').createHmac('sha256', 'line-secret').update(Buffer.from(JSON.stringify(body))).digest('base64') },
      rawBody: Buffer.from(JSON.stringify(body)),
    });
    assert.equal(res.status, 200);
    assert.equal(recorded.lineCalls, 1, 'should call the LINE reply API exactly once');
    assert.equal(recorded.conversationInserts, 1, 'should persist the conversation');
    assert.equal(recorded.gapInserts, 0, 'non-gap reply should not create an unanswered row');
  } finally {
    server.close();
    restore();
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
});

test('createLineRouter: webhook flags a knowledge gap and stores an unanswered row (mocked)', async () => {
  process.env.LINE_CHANNEL_SECRET = 'line-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';

  const recorded = { conversationInserts: 0, gapInserts: 0 };
  const pool = {
    async query(sql) {
      if (sql.includes('INSERT INTO conversations')) recorded.conversationInserts += 1;
      if (sql.includes('INSERT INTO unanswered_questions')) recorded.gapInserts += 1;
      if (sql.includes('FROM conversations')) return { rows: [] };
      return { rows: [] };
    },
  };
  const client = makeAnthropicClient('目前沒有足夠資料可以確認，建議您透過客服表單補充資訊。');
  const restore = installLineFetchMock(() => {});

  const app = express();
  // Replicate server.js: capture the raw body (used by LINE signature
  // verification) via express.json's verify hook without consuming the stream.
  app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; },
  }));
  app.use('/api', createLineRouter({
    pool,
    client,
    retrieveKnowledgeForQuestion: noopRag,
    buildRuntimeGuardrails: noopGuardrails,
    buildSystemPromptBlocks: noopSystemPrompt,
    defaultAnthropicModel: 'claude-test',
  }));
  const server = await listenApp(app);
  try {
    const body = {
      events: [{
        type: 'message',
        message: { type: 'text', text: '奇怪的問題' },
        replyToken: 'REPLY_TOKEN_2',
        source: { userId: 'U456LINE' },
      }],
    };
    const res = await request(server, {
      path: '/api/line/webhook',
      body,
      headers: { 'x-line-signature': require('crypto').createHmac('sha256', 'line-secret').update(Buffer.from(JSON.stringify(body))).digest('base64') },
      rawBody: Buffer.from(JSON.stringify(body)),
    });
    assert.equal(res.status, 200);
    assert.equal(recorded.conversationInserts, 1);
    assert.equal(recorded.gapInserts, 1, 'gap reply should create an unanswered_questions row');
  } finally {
    server.close();
    restore();
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
});
