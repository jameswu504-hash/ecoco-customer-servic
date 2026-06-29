const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { requireAdminKey } = require('../middleware/admin-auth');
const { detectKnowledgeGap } = require('../routes/chat.routes');
const { maskSensitiveText } = require('../services/privacy.service');
const {
  buildRuntimeGuardrails,
  buildSearchTerms,
  rankKnowledgeRows,
} = require('../services/rag.service');

test('known point issue ranks the point knowledge first', () => {
  const terms = buildSearchTerms('點數沒有入帳怎麼辦');
  const rows = [
    {
      id: 1,
      category: '合作商家',
      title: '優惠券兌換',
      content: '可查看合作商家與優惠券使用方式。',
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

  assert.match(guardrail, /高風險客服規則/);
  assert.match(guardrail, /不可以承諾/);
  assert.match(guardrail, /客服表單/);
});

test('knowledge gap marker is recorded', () => {
  const gap = detectKnowledgeGap('目前沒有足夠資料可確認，建議您填寫客服表單。');

  assert.equal(gap.isGap, true);
  assert.match(gap.reason, /知識缺口/);
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
  const masked = maskSensitiveText('my phone is 0912-345-678 and email is test@example.com');

  assert.equal(masked.includes('0912-345-678'), false);
  assert.equal(masked.includes('test@example.com'), false);
  assert.match(masked, /\[phone\]/);
  assert.match(masked, /\[email\]/);
});

test('dashboard keeps dynamic click handlers usable', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');

  assert.equal(dashboard.includes('protectDashboardHtmlAssignments'), false);
  assert.equal(dashboard.includes('DOMPurify.sanitize'), false);
});
