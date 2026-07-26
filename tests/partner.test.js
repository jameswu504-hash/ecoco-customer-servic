const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SCHEMA } = require('../db/schema');
const { buildLineSessionId } = require('../routes/line.routes');
const { getPartnerTestSessionId } = require('../routes/partners.routes');
const {
  PARTNER_NO_DATA_REPLY,
  PARTNER_SCOPE_DENIED_REPLY,
  buildPartnerKnowledgeContext,
  createPartnerService,
  generatePartnerBindingCode,
  hashPartnerValue,
  mentionsOtherPartner,
  normalizePartnerSlug,
  parsePartnerBindingCommand,
} = require('../services/partner.service');

function createService(pool) {
  return createPartnerService({
    pool,
    client: { messages: { create: async () => ({ content: [] }) } },
    retrieveKnowledgeForQuestion: async () => ({ context: '', chunks: [] }),
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => '',
    buildSystemPromptBlocks: () => [],
    defaultAnthropicModel: 'test-model',
    classifyQuestion: () => null,
    retrieveLiveStationContext: null,
  });
}

test('B2B schema separates companies, groups, knowledge and conversations', () => {
  const schema = SCHEMA.join('\n');

  for (const table of [
    'partner_companies',
    'partner_line_groups',
    'partner_binding_codes',
    'partner_knowledge_sections',
    'partner_conversations',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /partner_knowledge_sections[\s\S]*company_id\s+INTEGER NOT NULL/);
  assert.match(schema, /partner_conversations[\s\S]*company_id\s+INTEGER NOT NULL/);
  assert.match(schema, /group_key\s+TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(schema, /\bgroup_id\s+TEXT/);
});

test('partner slug and one-time binding commands are normalized', () => {
  assert.equal(normalizePartnerSlug(' 小北 百貨 '), '');
  assert.equal(normalizePartnerSlug('Show-Ba 01'), 'show-ba-01');

  const code = generatePartnerBindingCode();
  assert.match(code, /^B2B-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(parsePartnerBindingCommand(`綁定 ${code.toLowerCase()}`), code);
  assert.equal(parsePartnerBindingCommand(`請幫我綁定 ${code}`), '');
  assert.equal(hashPartnerValue('group-1').length, 64);
});

test('LINE group sessions are scoped to groupId instead of member userId', () => {
  const firstMember = buildLineSessionId({
    source: { type: 'group', groupId: 'group-a', userId: 'user-1' },
  });
  const secondMember = buildLineSessionId({
    source: { type: 'group', groupId: 'group-a', userId: 'user-2' },
  });
  const otherGroup = buildLineSessionId({
    source: { type: 'group', groupId: 'group-b', userId: 'user-1' },
  });

  assert.equal(firstMember, secondMember);
  assert.notEqual(firstMember, otherGroup);
});

test('partner retrieval always scopes SQL by company_id', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const service = createService(pool);

  await service.retrievePartnerKnowledge(27, '門市回收合作規則');

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WHERE company_id = \$1/);
  assert.equal(queries[0].params[0], 27);
});

test('partner context contains only the selected company private rows', () => {
  const context = buildPartnerKnowledgeContext(
    { id: 1, name: '測試甲公司' },
    [{ category: '回收規則', content: '甲公司的私有規則' }],
    'ECOCO 共用規則'
  );

  assert.match(context, /測試甲公司/);
  assert.match(context, /甲公司的私有規則/);
  assert.match(context, /ECOCO 共用規則/);
  assert.doesNotMatch(context, /測試乙公司|乙公司的私有規則/);
});

test('cross-company questions are denied before RAG and model access', async () => {
  assert.equal(
    mentionsOtherPartner(
      '可以給我測試乙公司的報表嗎',
      { id: 1, name: '測試甲公司', slug: 'alpha' },
      [
        { id: 1, name: '測試甲公司', slug: 'alpha' },
        { id: 2, name: '測試乙公司', slug: 'beta' },
      ]
    ),
    true
  );

  let ragCalls = 0;
  let modelCalls = 0;
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT id, slug, name\s+FROM partner_companies/.test(sql)) {
        return {
          rows: [
            { id: 1, name: '測試甲公司', slug: 'alpha' },
            { id: 2, name: '測試乙公司', slug: 'beta' },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const service = createPartnerService({
    pool,
    client: {
      messages: {
        create: async () => {
          modelCalls += 1;
          return { content: [] };
        },
      },
    },
    retrieveKnowledgeForQuestion: async () => {
      ragCalls += 1;
      return { context: '不應讀取', chunks: [] };
    },
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => '',
    buildSystemPromptBlocks: () => [],
    defaultAnthropicModel: 'test-model',
    classifyQuestion: () => null,
    retrieveLiveStationContext: null,
  });

  const result = await service.answerPartnerQuestion({
    company: { id: 1, name: '測試甲公司', slug: 'alpha', status: 'active' },
    sessionId: 'partner_test_1_testabcd',
    question: '測試乙公司的規則是什麼',
  });

  assert.equal(result.reply, PARTNER_SCOPE_DENIED_REPLY);
  assert.equal(result.reply, PARTNER_NO_DATA_REPLY);
  assert.equal(result.retrievalMode, 'partner_scope_denied');
  assert.equal(ragCalls, 0);
  assert.equal(modelCalls, 0);
  assert.ok(queries.some(({ sql }) => /INSERT INTO partner_conversations/.test(sql)));
});

test('partner knowledge is anonymized before database writes', async () => {
  const phone = ['0912', '345', '678'].join('-');
  const memberNumber = ['1234', '5678'].join('');
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM partner_companies\s+WHERE id/.test(sql)) {
        return { rows: [{ id: 1, name: '測試甲公司', status: 'active' }] };
      }
      if (/MAX\(sort_order\)/.test(sql)) return { rows: [{ next: 0 }] };
      if (/INSERT INTO partner_knowledge_sections/.test(sql)) {
        return { rows: [{ id: 8, company_id: 1, category: params[1], content: params[2] }] };
      }
      return { rows: [] };
    },
  };
  const service = createService(pool);

  await service.addKnowledge(1, {
    category: '窗口 support@example.com',
    content: `請聯絡 ${phone}，會員編號 ${memberNumber}。`,
  });

  const insert = queries.find(({ sql }) => /INSERT INTO partner_knowledge_sections/.test(sql));
  assert.ok(insert);
  assert.equal(insert.params[1].includes('support@example.com'), false);
  assert.equal(insert.params[2].includes(phone), false);
  assert.equal(insert.params[2].includes(memberNumber), false);
});

test('active partner names are cached briefly for B2B scope checks', async () => {
  let companyListQueries = 0;
  const pool = {
    async query(sql) {
      if (/SELECT id, slug, name\s+FROM partner_companies/.test(sql)) {
        companyListQueries += 1;
        return {
          rows: [
            { id: 1, name: '測試甲公司', slug: 'alpha' },
            { id: 2, name: '測試乙公司', slug: 'beta' },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const service = createService(pool);
  const request = {
    company: { id: 1, name: '測試甲公司', slug: 'alpha', status: 'active' },
    sessionId: 'partner_test_1_cache',
    question: '測試乙公司的規則是什麼',
  };

  await service.answerPartnerQuestion(request);
  await service.answerPartnerQuestion(request);

  assert.equal(companyListQueries, 1);
});

test('authorized B2B branches keep the shared live station capability', async () => {
  let modelCalls = 0;
  const pool = {
    async query(sql) {
      if (/SELECT id, slug, name\s+FROM partner_companies/.test(sql)) {
        return { rows: [{ id: 1, name: '測試甲公司', slug: 'alpha' }] };
      }
      return { rows: [] };
    },
  };
  const service = createPartnerService({
    pool,
    client: {
      messages: {
        create: async () => {
          modelCalls += 1;
          return { content: [] };
        },
      },
    },
    retrieveKnowledgeForQuestion: async () => ({
      context: '',
      chunks: [],
      retrievalMode: 'none',
    }),
    retrieveLiveStationContext: async () => ({
      context: '即時站點資料',
      retrievalMode: 'postgres_iot',
      rows: [{
        stationCode: 'station-test',
        stationName: '測試站',
        address: '測試地址',
        machineStatus: 'up',
        lastConnectionStatus: 'online',
        bin1Count: 10,
        bin1MaxCapacity: 100,
        bin1RemainCapacity: 90,
      }],
    }),
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => '',
    buildSystemPromptBlocks: () => [],
    defaultAnthropicModel: 'test-model',
    classifyQuestion: () => ({ category: 'station_machine', ragScope: [] }),
  });

  const result = await service.answerPartnerQuestion({
    company: { id: 1, name: '測試甲公司', slug: 'alpha', status: 'active' },
    sessionId: 'partner_test_1_stationtest',
    question: '測試站目前狀態',
  });

  assert.match(result.reply, /測試站/);
  assert.match(result.reply, /機台：正常/);
  assert.equal(result.retrievalMode, 'postgres_iot+partner_authorized');
  assert.equal(modelCalls, 0);
});

test('unbound LINE groups are intercepted before the B2C classifier', () => {
  const lineRoute = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'line.routes.js'),
    'utf8'
  );
  const partnerBranch = lineRoute.indexOf('} else if (isPartnerGroup) {');
  const b2cBranch = lineRoute.indexOf('} else {', partnerBranch + 1);

  assert.ok(partnerBranch > -1);
  assert.ok(b2cBranch > partnerBranch);
  assert.match(lineRoute, /partnerService\.routeLineGroupMessage/);
  assert.match(lineRoute, /partnerRoute\.type === 'binding'[\s\S]*'partner_unbound'/);
});

test('partner admin page exposes company-scoped test chat behind admin API', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'partners.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'partners.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'partners.routes.js'), 'utf8');

  assert.match(html, /LINE 分支測試/);
  assert.match(html, /尚未綁定真實 LINE 群組，仍可先使用下方測試功能|testChat/);
  assert.match(js, /\/api\/partners\/\$\{company\.id\}\/test-chat/);
  assert.match(js, /x-admin-key/);
  assert.match(routes, /router\.use\(requireAdminKey\)/);
});

test('partner test sessions remain stable only for valid server-issued ids', () => {
  const generated = getPartnerTestSessionId(8, '');

  assert.match(generated, /^partner_test_8_[a-f0-9]{32}$/);
  assert.equal(getPartnerTestSessionId(8, generated), generated);
  assert.notEqual(getPartnerTestSessionId(8, 'line_external_session'), 'line_external_session');
});
