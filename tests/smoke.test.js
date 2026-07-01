const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { requireAdminKey } = require('../middleware/admin-auth');
const {
  detectKnowledgeGap,
  getSafeSessionId,
  validateHistory,
} = require('../routes/chat.routes');
const { cleanKnowledgeInput } = require('../routes/knowledge.routes');
const { maskSensitiveText } = require('../services/privacy.service');
const {
  buildRuntimeGuardrails,
  buildSearchTerms,
  createRagService,
  rankKnowledgeRows,
} = require('../services/rag.service');

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

test('knowledge gap marker is recorded', () => {
  const gap = detectKnowledgeGap('目前沒有足夠資料可以確認，建議您透過客服表單補充資訊。');

  assert.equal(gap.isGap, true);
  assert.match(gap.reason, /知識缺口/);
});

test('conversation history must end with user message', () => {
  const error = validateHistory([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);

  assert.match(error, /last conversation message/i);
});

test('unsafe client session id is replaced by server-generated id', () => {
  const safe = getSafeSessionId({ 'x-session-id': 'session_abc123456789' });
  const unsafe = getSafeSessionId({ 'x-session-id': '<script>alert(1)</script>' });

  assert.equal(safe, 'session_abc123456789');
  assert.match(unsafe, /^server_[0-9a-f-]{36}$/i);
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

test('conversation persistence masks phone and email values', () => {
  const phone = ['0912', '345', '678'].join('-');
  const email = ['test', 'example.com'].join('@');
  const masked = maskSensitiveText(`my phone is ${phone} and email is ${email}`);

  assert.equal(masked.includes(phone), false);
  assert.equal(masked.includes(email), false);
  assert.match(masked, /\[phone\]/);
  assert.match(masked, /\[email\]/);
});

test('knowledge input is anonymized before it can be saved or exported', () => {
  const email = ['support', 'example.com'].join('@');
  const phone = ['0912', '345', '678'].join('-');
  const cleaned = cleanKnowledgeInput(`請聯絡 ${email}，電話 ${phone}`);

  assert.equal(cleaned.includes(email), false);
  assert.equal(cleaned.includes(phone), false);
  assert.match(cleaned, /redacted-email/);
  assert.match(cleaned, /09XX-XXX-XXX/);
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
});

test('dashboard keeps dynamic click handlers usable', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');

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
});

test('workflow scripts referenced by GitHub Actions exist', () => {
  const backupWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'backup.yml'), 'utf8');
  const analysisWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ai-analysis.yml'), 'utf8');

  assert.match(backupWorkflow, /node scripts\/backup\.mjs/);
  assert.match(analysisWorkflow, /node scripts\/ai-analysis\.mjs/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'backup.mjs')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'ai-analysis.mjs')), true);
});

test('public chat response does not expose RAG source metadata', () => {
  const chatRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.routes.js'), 'utf8');

  assert.equal(chatRoute.includes('ragSources'), false);
});

test('schema includes report and dashboard performance indexes', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.js'), 'utf8');

  assert.match(schema, /idx_conv_timestamp/);
  assert.match(schema, /idx_conv_role_timestamp/);
  assert.match(schema, /idx_conv_session_ts/);
  assert.match(schema, /idx_ratings_timestamp/);
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
});

test('public health check does not expose internal runtime details by default', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /app\.get\('\/api\/system\/status', requireAdminKey/);
  assert.match(server, /includeDetails = false/);
  assert.match(server, /X-Robots-Tag/);
});

test('CSP allows dashboard inline event handlers until dashboard scripts are refactored', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /scriptSrcAttr:\s*\[\s*["']'unsafe-inline'["']/);
});
