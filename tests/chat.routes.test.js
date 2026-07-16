// Integration tests for the chat gap-detection orchestration in routes/chat.routes.js
// (createChatRouter /chat endpoint). External services are mocked: the Anthropic
// client is a stub and every DB write goes through an in-memory mock pool.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
  createChatRouter,
  detectKnowledgeGap,
  loadServerConversationHistory,
} = require('../routes/chat.routes');

// ---- mock helpers -----------------------------------------------------------

function makePool() {
  // Tracks every INSERT target so tests can assert what was persisted.
  const inserts = { conversations: 0, unanswered: 0, ratings: 0, chat_traces: 0 };
  const pool = {
    inserts,
    async query(sql, params) {
      if (sql.includes('INSERT INTO conversations')) inserts.conversations += 1;
      else if (sql.includes('INSERT INTO unanswered_questions')) inserts.unanswered += 1;
      else if (sql.includes('INSERT INTO ratings')) inserts.ratings += 1;
      else if (sql.includes('INSERT INTO chat_traces')) inserts.chat_traces += 1;
      else if (sql.includes('FROM conversations')) return { rows: [] };
      return { rows: [] };
    },
  };
  return pool;
}

function makeAnthropicClient(replyText, { stopReason = 'end_turn' } = {}) {
  return {
    messages: {
      create: async () => ({
        stop_reason: stopReason,
        content: [{ type: 'text', text: replyText }],
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
    },
  };
}

const noopRag = () => ({ retrievalMode: 'none', chunks: [], context: '' });
const noopGuardrails = () => '';
const noopSystemPromptBlocks = () => [{ type: 'text', text: 'system' }];

function listenApp(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

function postChat(server, body) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/chat', method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, json: data }); }
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function buildChatApp({ client, pool }) {
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRouter({
    pool,
    client,
    chatLimiter: (req, res, next) => next(),
    ratingLimiter: (req, res, next) => next(),
    requireAdminKey: (req, res, next) => next(),
    retrieveKnowledgeForQuestion: noopRag,
    buildRuntimeGuardrails: noopGuardrails,
    buildSystemPromptBlocks: noopSystemPromptBlocks,
    defaultAnthropicModel: 'claude-test',
  }));
  return app;
}

// ---- gap detection unit (already covered, re-affirmed at the orchestration boundary) --

test('detectKnowledgeGap recognizes the structured meta marker', () => {
  const reply = '無法確認。\n<meta>{"gap":true,"confidence":"low","reason":"missing policy"}</meta>';
  const gap = detectKnowledgeGap(reply);
  assert.equal(gap.isGap, true);
});

test('loadServerConversationHistory normalizes persisted rows', async () => {
  const pool = {
    async query() {
      return { rows: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] };
    },
  };
  const messages = await loadServerConversationHistory(pool, 'session_x');
  // SQL orders by timestamp DESC, so the helper reverses back to chronological order:
  // the most recent row becomes last.
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: 'assistant', content: 'hello' });
  assert.deepEqual(messages[1], { role: 'user', content: 'hi' });
});

// ---- /chat orchestration integration ----------------------------------------

test('/chat returns 400 when the user message is missing', async () => {
  const app = buildChatApp({ client: makeAnthropicClient('x'), pool: makePool() });
  const server = await listenApp(app);
  try {
    const res = await postChat(server, {});
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('/chat happy path: AI replies, conversation persisted, no gap row', async () => {
  const pool = makePool();
  const client = makeAnthropicClient('您的點數可以在 App 查詢，一年效期。');
  const app = buildChatApp({ client, pool });
  const server = await listenApp(app);
  try {
    const res = await postChat(server, { message: '點數多久到期' });
    assert.equal(res.status, 200);
    assert.match(res.json.reply, /點數/);
    assert.equal(pool.inserts.conversations, 1, 'one conversation pair should be written');
    assert.equal(pool.inserts.unanswered, 0, 'non-gap reply must not create an unanswered row');
    assert.equal(pool.inserts.chat_traces, 1, 'a chat trace should be written');
  } finally {
    server.close();
  }
});

test('/chat flags a knowledge gap and records an unanswered question', async () => {
  const pool = makePool();
  const client = makeAnthropicClient('目前沒有足夠資料可以確認，建議您透過客服表單補充資訊。');
  const app = buildChatApp({ client, pool });
  const server = await listenApp(app);
  try {
    const res = await postChat(server, { message: '這個奇怪的問題' });
    assert.equal(res.status, 200);
    assert.equal(pool.inserts.conversations, 1);
    assert.equal(pool.inserts.unanswered, 1, 'gap reply must create an unanswered_questions row');
    assert.equal(pool.inserts.chat_traces, 1);
  } finally {
    server.close();
  }
});

test('/chat records a structured-gap meta marker as an unanswered question', async () => {
  const pool = makePool();
  const client = makeAnthropicClient('無法確認。\n<meta>{"gap":true,"confidence":"low","reason":"missing station policy"}</meta>');
  const app = buildChatApp({ client, pool });
  const server = await listenApp(app);
  try {
    const res = await postChat(server, { message: '站點政策' });
    assert.equal(res.status, 200);
    // the meta marker must be stripped from the reply sent to the user
    assert.equal(res.json.reply.includes('<meta>'), false);
    assert.equal(pool.inserts.unanswered, 1);
  } finally {
    server.close();
  }
});

test('/chat returns 503 with a friendly reply when Claude fails', async () => {
  const pool = makePool();
  const failingClient = {
    messages: {
      create: async () => { throw new Error('Claude upstream timeout'); },
    },
  };
  const app = buildChatApp({ client: failingClient, pool });
  const server = await listenApp(app);
  try {
    const res = await postChat(server, { message: '點數查詢' });
    assert.equal(res.status, 503);
    assert.match(res.json.reply, /連線不穩|客服表單/);
    assert.equal(pool.inserts.chat_traces, 1, 'error path still writes a trace');
  } finally {
    server.close();
  }
});

test('/rating negative feedback creates an unanswered question row', async () => {
  const pool = makePool();
  const client = makeAnthropicClient('x');
  const app = buildChatApp({ client, pool });
  const server = await listenApp(app);
  try {
    // first a chat to establish a session, then a negative rating
    await postChat(server, { message: 'hi' });
    const port = server.address().port;
    const ratingRes = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/rating', method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) })); }
      );
      req.on('error', reject);
      req.end(JSON.stringify({ msgId: 'm1', type: 'negative', question: '點數問題', reply: '不好' }));
    });
    assert.equal(ratingRes.status, 200);
    assert.equal(ratingRes.json.success, true);
    assert.equal(pool.inserts.ratings, 1);
    assert.equal(pool.inserts.unanswered, 1, 'negative rating must create an unanswered row');
  } finally {
    server.close();
  }
});
