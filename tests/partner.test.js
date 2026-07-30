const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SCHEMA } = require('../db/schema');
const {
  buildLineRateLimitKey,
  buildLineSessionId,
  isLineBotAddressed,
  isLineBotMentioned,
  stripLineBotMentions,
} = require('../routes/line.routes');
const { getPartnerTestSessionId } = require('../routes/partners.routes');
const {
  PARTNER_LINE_IMPORT_CHUNK_CHARS,
  PARTNER_NO_DATA_REPLY,
  PARTNER_SCOPE_DENIED_REPLY,
  buildLineChatKnowledgeSections,
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
  assert.match(schema, /ALTER TABLE partner_conversations ADD COLUMN IF NOT EXISTS archived_at/);
  assert.match(schema, /group_key\s+TEXT NOT NULL UNIQUE/);
  assert.match(schema, /idx_partner_conversations_company_day[\s\S]*WHERE line_group_id IS NOT NULL/);
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

test('LINE group rate limits are scoped to member userId instead of the whole group', () => {
  const firstMember = buildLineRateLimitKey({
    source: { type: 'group', groupId: 'group-a', userId: 'user-a' },
  });
  const secondMember = buildLineRateLimitKey({
    source: { type: 'group', groupId: 'group-a', userId: 'user-b' },
  });
  const sameMemberOtherGroup = buildLineRateLimitKey({
    source: { type: 'group', groupId: 'group-b', userId: 'user-a' },
  });

  assert.notEqual(firstMember, secondMember);
  assert.equal(firstMember, sameMemberOtherGroup);
});

test('LINE group replies require an official self mention and remove it from the question', () => {
  const message = {
    type: 'text',
    text: '@ECOCO客服系統 請問機台正常嗎？',
    mention: {
      mentionees: [{
        index: 0,
        length: 10,
        type: 'user',
        isSelf: true,
      }],
    },
  };

  assert.equal(isLineBotMentioned(message), true);
  assert.equal(stripLineBotMentions(message), '請問機台正常嗎？');
  assert.equal(isLineBotMentioned({
    ...message,
    mention: { mentionees: [{ ...message.mention.mentionees[0], isSelf: false }] },
  }), false);
  assert.equal(isLineBotMentioned({ type: 'text', text: '@ECOCO客服系統 請問' }), false);
});

test('LINE group wake prefixes work when the client cannot create official mention metadata', () => {
  for (const text of [
    '@ECOCO客服系統 請問機台正常嗎？',
    '@ECOCO客服 請問機台正常嗎？',
    '@ECOCO 請問機台正常嗎？',
    '/ecoco 請問機台正常嗎？',
  ]) {
    const message = { type: 'text', text };
    assert.equal(isLineBotAddressed(message), true, text);
    assert.equal(stripLineBotMentions(message), '請問機台正常嗎？', text);
  }

  assert.equal(isLineBotAddressed({
    type: 'text',
    text: '我們正在討論 ECOCO客服系統 的使用方式',
  }), false);
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

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /company_id = \$1/);
    assert.equal(query.params[0], 27);
  }
  assert.ok(queries.some(({ sql }) => /partner_knowledge_chunks/.test(sql)));
  assert.ok(queries.some(({ sql }) => /partner_knowledge_sections/.test(sql)));
});

test('partner LINE conversation logs are company-scoped and grouped by Taipei day', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return {
        rows: [
          {
            id: 4,
            line_group_id: 8,
            session_id: 'line_group_a',
            role: 'assistant',
            content: '第二天回覆',
            timestamp: '2026-07-28T01:05:00.000Z',
            conversation_day: '2026-07-28',
            group_label: '全家測試群',
            group_id_last4: '1234',
          },
          {
            id: 3,
            line_group_id: 8,
            session_id: 'line_group_a',
            role: 'user',
            content: '第二天問題',
            timestamp: '2026-07-28T01:04:00.000Z',
            conversation_day: '2026-07-28',
            group_label: '全家測試群',
            group_id_last4: '1234',
          },
          {
            id: 2,
            line_group_id: 8,
            session_id: 'line_group_a',
            role: 'assistant',
            content: '第一天回覆',
            timestamp: '2026-07-27T02:05:00.000Z',
            conversation_day: '2026-07-27',
            group_label: '',
            group_id_last4: '1234',
          },
        ],
      };
    },
  };
  const service = createService(pool);

  const result = await service.listLineConversationDays(7, 999);

  assert.equal(result.selectedDays, 90);
  assert.equal(result.totalDays, 2);
  assert.equal(result.totalMessages, 3);
  assert.equal(result.status, 'active');
  assert.equal(result.days[0].date, '2026-07-28');
  assert.deepEqual(
    result.days[0].messages.map(message => message.role),
    ['user', 'assistant']
  );
  assert.equal(result.days[1].messages[0].groupLabel, 'LINE 群組 • 1234');
  assert.match(queries[0].sql, /WHERE pc\.company_id = \$1/);
  assert.match(queries[0].sql, /pc\.line_group_id IS NOT NULL/);
  assert.match(queries[0].sql, /pc\.archived_at IS NULL/);
  assert.match(queries[0].sql, /AT TIME ZONE 'Asia\/Taipei'/);
  assert.deepEqual(queries[0].params.slice(0, 2), [7, 90]);
});

test('partner LINE conversation days can be archived, restored and permanently deleted', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/UPDATE partner_conversations/.test(sql)) {
        return { rows: [{ id: 1 }, { id: 2 }] };
      }
      if (/DELETE FROM partner_conversations/.test(sql)) {
        return { rows: [{ id: 1 }, { id: 2 }] };
      }
      return { rows: [] };
    },
  };
  const service = createService(pool);

  const archived = await service.updateConversationDayStatus(7, '2026-07-28', 'archived');
  const restored = await service.updateConversationDayStatus(7, '2026-07-28', 'active');
  const deleted = await service.deleteArchivedConversationDay(
    7,
    '2026-07-28',
    '2026-07-28'
  );

  assert.equal(archived.updatedMessages, 2);
  assert.equal(archived.status, 'archived');
  assert.equal(restored.status, 'active');
  assert.equal(deleted.deletedMessages, 2);
  assert.ok(queries.every(({ params }) => params[0] === 7));
  assert.ok(queries.every(({ params }) => params[1] === '2026-07-28'));
  assert.ok(queries.every(({ sql }) => /AT TIME ZONE 'Asia\/Taipei'/.test(sql)));
  assert.match(queries[2].sql, /archived_at IS NOT NULL/);
  await assert.rejects(
    () => service.updateConversationDayStatus(7, '2026-02-30', 'archived'),
    /valid conversation date/
  );
});

test('passive LINE group messages are masked and stored without an assistant reply', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const service = createService(pool);
  const phone = ['0912', '345', '678'].join('-');

  await service.storePartnerMessage({
    companyId: 7,
    lineGroupId: 12,
    sessionId: 'line_group_session',
    role: 'user',
    content: `請聯絡 ${phone}`,
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO partner_conversations/);
  assert.equal(queries[0].params[0], 7);
  assert.equal(queries[0].params[1], 12);
  assert.equal(queries[0].params[3], 'user');
  assert.equal(queries[0].params[4], '請聯絡 [phone]');
  assert.doesNotMatch(queries[0].sql, /'assistant'/);
});

test('partner retrieval turns natural-language company questions into useful search terms', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      const hasCompanyTerm = params.some(value => value === '%全家%');
      return {
        rows: hasCompanyTerm
          ? [{ id: 1, company_id: 7, category: 'LINE 歷史', content: '全家合作紀錄' }]
          : [],
      };
    },
  };
  const service = createService(pool);

  const rows = await service.retrievePartnerKnowledge(7, '全家的問題');

  assert.equal(rows.length, 1);
  assert.ok(queries[0].params.includes('%全家%'));
});

test('partner overview questions retrieve recent knowledge within the same company', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/ORDER BY sort_order DESC/.test(sql)) {
        return {
          rows: [{ id: 8, company_id: 7, category: '最新合作紀錄', content: '近期內容' }],
        };
      }
      return { rows: [] };
    },
  };
  const service = createService(pool);

  const rows = await service.retrievePartnerKnowledge(7, '全家目前有哪些合作紀錄？');

  assert.equal(rows.length, 1);
  assert.equal(queries[0].params[0], 7);
  assert.match(queries[0].sql, /WHERE company_id = \$1/);
});

test('partner overview questions accept the Taiwanese 甚麼 spelling', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/ORDER BY sort_order DESC/.test(sql)) {
        return {
          rows: [{ id: 8, company_id: 7, category: '最新合作紀錄', content: '近期內容' }],
        };
      }
      return { rows: [] };
    },
  };
  const service = createService(pool);

  const rows = await service.retrievePartnerKnowledge(7, 'ECOCO 跟全家有甚麼合作？');

  assert.equal(rows.length, 1);
  assert.equal(queries[0].params[0], 7);
  assert.match(queries[0].sql, /ORDER BY sort_order DESC/);
});

test('partner overview answers use authorized private data without B2C RAG interference', async () => {
  let sharedRagCalls = 0;
  let capturedContext = '';
  let capturedGuardrail = '';
  let capturedMessages = [];
  const pool = {
    async query(sql) {
      if (/SELECT id, slug, name\s+FROM partner_companies/.test(sql)) {
        return { rows: [{ id: 7, slug: 'familymart-test', name: '全家便利商店（測試）' }] };
      }
      if (/FROM partner_knowledge_sections/.test(sql)) {
        return {
          rows: [{
            id: 8,
            company_id: 7,
            category: 'LINE 歷史｜2026-07',
            content: '2026/7/27 09:00\t專案窗口\t確認合作排程',
            sort_order: 8,
          }],
        };
      }
      if (/FROM partner_conversations/.test(sql)) {
        return {
          rows: [
            {
              role: 'user',
              content: 'ECOCO 跟全家有甚麼合作？',
            },
            {
              role: 'assistant',
              content: '商業合作細節超出 AI 客服授權，請聯絡 ECOCO 業務窗口。',
            },
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
        create: async ({ system, messages }) => {
          const prompt = system.map(block => block.text).join('\n');
          capturedMessages = messages;
          const recognizesBindingAuthorization = (
            /綁定成功.*一律視為.*授權內部人員/.test(prompt)
            && /可以回答.*全部內容/.test(prompt)
            && /不得以.*超出.*授權.*拒絕/.test(prompt)
          );
          return {
            content: [{
              type: 'text',
              text: recognizesBindingAuthorization
                ? '已整理合作紀錄。'
                : '詳細合作內容超出 AI 客服的授權範圍。',
            }],
          };
        },
      },
    },
    retrieveKnowledgeForQuestion: async () => {
      sharedRagCalls += 1;
      return { context: '一般 B2C 合作洽談表單', chunks: [], retrievalMode: 'keyword' };
    },
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: (context, guardrail) => {
      capturedContext = context;
      capturedGuardrail = guardrail;
      return `${context}\n${guardrail}`;
    },
    buildSystemPromptBlocks: null,
    defaultAnthropicModel: 'test-model',
    classifyQuestion: () => null,
    retrieveLiveStationContext: null,
  });

  const result = await service.answerPartnerQuestion({
    company: { id: 7, slug: 'familymart-test', name: '全家便利商店（測試）', status: 'active' },
    sessionId: 'partner_test_7_overview',
    question: 'ECOCO 跟全家有甚麼合作？',
  });

  assert.equal(sharedRagCalls, 0);
  assert.equal(result.privateKnowledgeCount, 1);
  assert.equal(result.reply, '已整理合作紀錄。');
  assert.match(capturedContext, /已授權的內部合作資料/);
  assert.match(capturedContext, /可以整理與引用日期、發言者及內容/);
  assert.match(capturedGuardrail, /綁定成功.*一律視為.*授權內部人員/);
  assert.match(capturedGuardrail, /可以回答.*全部內容/);
  assert.match(capturedGuardrail, /不得以.*超出.*授權.*拒絕/);
  assert.match(capturedGuardrail, /只能使用.*全家便利商店（測試）.*專屬資料.*ECOCO.*共用/);
  assert.doesNotMatch(capturedContext, /一般 B2C 合作洽談表單/);
  assert.deepEqual(capturedMessages, [
    { role: 'user', content: 'ECOCO 跟全家有甚麼合作？' },
  ]);
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

test('LINE TXT imports are anonymized, cleaned and split at date boundaries', () => {
  const phone = ['0912', '345', '678'].join('-');
  const memberNumber = ['1234', '5678'].join('');
  const repeatedMessage = '門市設備、活動排程與回收合作細節請依最新確認內容辦理。'.repeat(300);
  const parsed = buildLineChatKnowledgeSections({
    sourceName: '[LINE] ECOCO x 測試公司 全循環的聊天.txt',
    content: [
      '[LINE] ECOCO x 測試公司 全循環的聊天記錄',
      '儲存日期：2026/7/28 10:24',
      '',
      '2026/7/26（週日）',
      `09:00\t測試窗口\t聯絡電話 ${phone}，會員編號 ${memberNumber}`,
      '09:01\t測試窗口\t[照片]',
      repeatedMessage,
      '',
      '2026/7/27（週一）',
      '10:00\tECOCO\t這是較新的確認內容',
      '10:01\tECOCO\t[貼圖]',
    ].join('\n'),
  });

  assert.ok(parsed.sections.length >= 2);
  assert.equal(parsed.ignoredAttachmentCount, 2);
  assert.equal(parsed.sourceName, 'ECOCO x 測試公司 全循環的聊天');
  assert.ok(parsed.sections.every(section => section.content.length <= PARTNER_LINE_IMPORT_CHUNK_CHARS));
  assert.ok(parsed.sections.every(section => /LINE 歷史｜/.test(section.category)));
  assert.ok(parsed.sections.some(section => /2026-07-26/.test(section.category)));
  assert.ok(parsed.sections.some(section => /2026-07-27/.test(section.category)));
  const combined = parsed.sections.map(section => section.content).join('\n');
  assert.equal(combined.includes(phone), false);
  assert.equal(combined.includes(memberNumber), false);
  assert.equal(combined.includes('[照片]'), false);
  assert.equal(combined.includes('[貼圖]'), false);
  assert.match(combined, /較新日期為優先/);
});

test('LINE TXT imports can preserve speaker attribution and contact details for internal use', () => {
  const phone = ['0912', '345', '678'].join('-');
  const email = ['project.owner', 'example.com'].join('@');
  const parsed = buildLineChatKnowledgeSections({
    sourceName: '內部合作群.txt',
    preservePersonalData: true,
    content: [
      '2026/7/28（週二）',
      `09:00\t全家-專案窗口\t請聯絡 ${phone} 或 ${email}`,
    ].join('\n'),
  });
  const combined = parsed.sections.map(section => section.content).join('\n');

  assert.equal(parsed.preservePersonalData, true);
  assert.match(combined, /全家-專案窗口/);
  assert.ok(combined.includes(phone));
  assert.ok(combined.includes(email));
});

test('LINE TXT batch import writes only new company-scoped sections in one transaction', async () => {
  const payload = {
    sourceName: '合作公司聊天.txt',
    content: [
      '2026/7/25（週六）',
      `09:00\t窗口\t${'舊合作紀錄。'.repeat(700)}`,
      '2026/7/26（週日）',
      `10:00\t窗口\t${'新合作紀錄。'.repeat(700)}`,
    ].join('\n'),
  };
  const parsed = buildLineChatKnowledgeSections(payload);
  const transactionQueries = [];
  const connection = {
    async query(sql, params = []) {
      transactionQueries.push({ sql, params });
      if (/SELECT category/.test(sql)) {
        return { rows: [{ category: parsed.sections[0].category }] };
      }
      if (/MAX\(sort_order\)/.test(sql)) return { rows: [{ next: 12 }] };
      if (/INSERT INTO partner_knowledge_sections/.test(sql)) {
        return {
          rows: [{
            id: 100 + transactionQueries.length,
            company_id: params[0],
            category: params[1],
            content: params[2],
            sort_order: params[3],
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (/FROM partner_companies\s+WHERE id/.test(sql)) {
        return { rows: [{ id: 9, name: '合作公司', status: 'active' }] };
      }
      return { rows: [] };
    },
    async connect() {
      return connection;
    },
  };
  const service = createService(pool);

  const result = await service.importLineChatKnowledge(9, payload);

  assert.equal(result.totalSectionCount, parsed.sections.length);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.equal(result.createdCount, parsed.sections.length - 1);
  assert.ok(transactionQueries.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(transactionQueries.some(({ sql }) => sql === 'COMMIT'));
  const inserts = transactionQueries.filter(({ sql }) => /INSERT INTO partner_knowledge_sections/.test(sql));
  assert.ok(inserts.every(({ params }) => params[0] === 9));
  assert.ok(inserts.every(({ params }) => params[2].length <= PARTNER_LINE_IMPORT_CHUNK_CHARS));
});

test('company knowledge clear removes only scoped knowledge data in one transaction', async () => {
  const transactionQueries = [];
  const connection = {
    async query(sql, params = []) {
      transactionQueries.push({ sql, params });
      if (/FROM partner_companies[\s\S]*FOR UPDATE/.test(sql)) {
        return { rows: [{ id: 9, slug: 'familymart-test', name: '全家便利商店（測試）' }] };
      }
      if (/DELETE FROM partner_knowledge_chunks/.test(sql)) {
        return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      }
      if (/DELETE FROM partner_knowledge_sections/.test(sql)) {
        return { rows: [{ id: 10 }, { id: 11 }] };
      }
      if (/DELETE FROM partner_cleaning_jobs/.test(sql)) {
        return { rows: [{ id: 20 }] };
      }
      if (/DELETE FROM partner_source_documents/.test(sql)) {
        return { rows: [{ id: 30 }] };
      }
      if (/FROM partner_line_groups/.test(sql)) {
        return { rows: [{ line_group_count: 1, conversation_count: 51 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return connection;
    },
  };
  const service = createService(pool);

  const result = await service.clearCompanyKnowledge(9, 'familymart-test');

  assert.deepEqual(result.deleted, {
    knowledgeSections: 2,
    knowledgeChunks: 3,
    cleaningJobs: 1,
    sourceDocuments: 1,
  });
  assert.deepEqual(result.preserved, {
    lineGroups: 1,
    conversations: 51,
  });
  assert.ok(transactionQueries.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(transactionQueries.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(transactionQueries.some(({ sql }) => /DELETE FROM partner_conversations/.test(sql)), false);
  assert.equal(transactionQueries.some(({ sql }) => /DELETE FROM partner_line_groups/.test(sql)), false);
  assert.ok(
    transactionQueries
      .filter(({ sql }) => /DELETE FROM partner_/.test(sql))
      .every(({ params }) => params[0] === 9)
  );
});

test('partner knowledge lifecycle scopes archive and permanent deletion to one company', async () => {
  const directQueries = [];
  const transactionQueries = [];
  const connection = {
    async query(sql, params = []) {
      transactionQueries.push({ sql, params });
      if (/FROM partner_knowledge_sections pks[\s\S]*FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: 12,
            category: '測試知識',
            archived_at: '2026-07-30T00:00:00.000Z',
            source_document_id: 21,
            cleaning_job_id: 31,
            slug: 'familymart-test',
          }],
        };
      }
      if (/DELETE FROM partner_knowledge_chunks/.test(sql)) {
        return { rows: [{ id: 1 }, { id: 2 }] };
      }
      if (/WHERE company_id = \$1[\s\S]*source_document_id = \$2[\s\S]*LIMIT 1/.test(sql)) {
        return { rows: [] };
      }
      if (/DELETE FROM partner_cleaning_jobs/.test(sql)) {
        return { rows: [{ id: 31 }] };
      }
      if (/DELETE FROM partner_source_documents/.test(sql)) {
        return { rows: [{ id: 21 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql, params = []) {
      directQueries.push({ sql, params });
      return {
        rows: [{
          id: 12,
          company_id: 7,
          category: '測試知識',
          archived_at: params[2] === 'archived' ? '2026-07-30T00:00:00.000Z' : null,
        }],
      };
    },
    async connect() {
      return connection;
    },
  };
  const service = createService(pool);

  await service.updateKnowledgeStatus(7, 12, 'archived');
  const deleted = await service.deleteArchivedKnowledge(7, 12, 'familymart-test');

  assert.equal(directQueries[0].params[0], 7);
  assert.equal(directQueries[0].params[1], 12);
  assert.equal(directQueries[0].params[2], 'archived');
  assert.deepEqual(deleted.deleted, {
    knowledgeSections: 1,
    knowledgeChunks: 2,
    cleaningJobs: 1,
    sourceDocuments: 1,
  });
  assert.ok(transactionQueries.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(transactionQueries.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(
    transactionQueries
      .filter(({ sql }) => /(?:DELETE|SELECT)[\s\S]*partner_/.test(sql) && paramsHaveCompany(sql))
      .every(({ params }) => params[0] === 7)
  );

  function paramsHaveCompany(sql) {
    return /company_id = \$1/.test(sql) || /pks\.company_id = \$1/.test(sql);
  }
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
  let liveStationOptions = null;
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
    retrieveLiveStationContext: async (question, options) => {
      liveStationOptions = options;
      return {
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
      };
    },
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
    coords: { lat: 24.1219, lng: 120.6748, label: '中興大學' },
  });

  assert.match(result.reply, /測試站/);
  assert.match(result.reply, /機台：正常/);
  assert.equal(result.retrievalMode, 'postgres_iot+partner_authorized');
  assert.equal(modelCalls, 0);
  assert.deepEqual(liveStationOptions.coords, {
    lat: 24.1219,
    lng: 120.6748,
    label: '中興大學',
  });
});

test('unbound LINE groups are intercepted before the B2C classifier', () => {
  const lineRoute = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'line.routes.js'),
    'utf8'
  );
  const b2bService = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'line-b2b.service.js'),
    'utf8'
  );
  const b2cService = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'line-b2c.service.js'),
    'utf8'
  );

  assert.match(lineRoute, /event\.source\?\.type === 'group' && handleLineB2BMessage/);
  assert.match(lineRoute, /await handleLineB2BMessage\(context\)[\s\S]*await handleLineB2CMessage\(context\)/);
  assert.match(b2bService, /partnerService\.routeLineGroupMessage/);
  assert.match(b2bService, /isLineBotAddressed\(event\.message\)/);
  assert.match(b2bService, /partnerService\.storePartnerMessage/);
  assert.match(b2bService, /partnerRoute\.type === 'binding'[\s\S]*'partner_unbound'/);
  assert.match(b2cService, /classifyQuestion\(userText\)/);
  assert.doesNotMatch(b2bService, /classifyQuestion/);
});

test('partner admin page exposes company-scoped test chat behind admin API', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'partners.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'partners.js'), 'utf8');
  const cleaner = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'partner-data-cleaner.js'),
    'utf8'
  );
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'partners.routes.js'), 'utf8');

  assert.match(html, /LINE 分支測試/);
  assert.match(html, /LINE 對話紀錄/);
  assert.match(html, /尚未綁定真實 LINE 群組，仍可先使用下方測試功能|testChat/);
  assert.match(js, /\/api\/partners\/\$\{company\.id\}\/test-chat/);
  assert.match(js, /\/api\/partners\/\$\{companyId\}\/conversations\?days=\$\{days\}&status=/);
  assert.match(js, /conversation-day/);
  assert.match(html, /knowledgeStatus/);
  assert.match(html, /conversationStatus/);
  assert.match(html, /deletePartnerDataDialog/);
  assert.match(js, /updateKnowledgeArchive/);
  assert.match(js, /updateConversationDayArchive/);
  assert.match(routes, /conversations\/:day\/status/);
  assert.match(routes, /knowledge\/:sectionId\/status/);
  assert.match(html, /clearCompanyKnowledgeDialog/);
  assert.match(html, /clearKnowledgeConfirmation/);
  assert.match(js, /submitClearCompanyKnowledge/);
  assert.doesNotMatch(js, /window\.prompt/);
  assert.match(html, /cleanerFileInput/);
  assert.match(html, /AI 資料清洗/);
  assert.match(html, /accept="\.txt,\.md,text\/plain,text\/markdown"/);
  assert.match(js, /cleanPartnerKnowledgeFile/);
  assert.match(cleaner, /preservePersonalData:\s*true/);
  assert.match(js, /document\.createElement\('details'\)/);
  assert.match(js, /document\.createElement\('summary'\)/);
  assert.match(js, /knowledge-full-content/);
  assert.match(js, /fullContent\.textContent = String\(item\.content/);
  assert.match(routes, /knowledge\/import-cleaned/);
  assert.doesNotMatch(routes, /knowledge\/import-line/);
  assert.match(routes, /:companyId\/conversations/);
  assert.match(js, /x-admin-key/);
  assert.match(routes, /router\.use\(requireAdminKey\)/);
});

test('partner test sessions remain stable only for valid server-issued ids', () => {
  const generated = getPartnerTestSessionId(8, '');

  assert.match(generated, /^partner_test_8_[a-f0-9]{32}$/);
  assert.equal(getPartnerTestSessionId(8, generated), generated);
  assert.notEqual(getPartnerTestSessionId(8, 'line_external_session'), 'line_external_session');
});
