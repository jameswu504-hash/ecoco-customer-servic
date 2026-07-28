const test = require('node:test');
const assert = require('node:assert/strict');

const { createLineB2BHandler } = require('../services/line-b2b.service');
const { createLineB2CHandler } = require('../services/line-b2c.service');

test('B2B handler records passive partner group messages without invoking a reply', async () => {
  const storedMessages = [];
  let answerCalls = 0;
  const company = { id: 7, name: '測試合作夥伴' };
  const handler = createLineB2BHandler({
    pool: { query: async () => ({ rows: [] }) },
    partnerService: {
      routeLineGroupMessage: async () => ({
        type: 'partner',
        company,
        lineGroupId: 12,
      }),
      storePartnerMessage: async payload => storedMessages.push(payload),
      answerPartnerQuestion: async () => {
        answerCalls += 1;
        return { reply: '不應回覆' };
      },
    },
  });

  const outcome = await handler({
    event: {
      source: { type: 'group', groupId: 'group-1', userId: 'user-1' },
      message: { type: 'text', text: '一般群組討論' },
    },
    isTextMessage: true,
    locationErrorReply: '',
    rateLimitKey: 'line_b2b_passive_test',
    sessionId: 'line_group_test',
    userCoords: null,
    userText: '一般群組討論',
  });

  assert.equal(outcome.shouldReply, false);
  assert.equal(outcome.shouldStoreConversation, false);
  assert.equal(answerCalls, 0);
  assert.deepEqual(storedMessages, [{
    companyId: 7,
    lineGroupId: 12,
    sessionId: 'line_group_test',
    role: 'user',
    content: '一般群組討論',
  }]);
});

test('B2C handler owns classification and direct customer replies without partner dependencies', async () => {
  const traceQueries = [];
  let modelCalls = 0;
  const handler = createLineB2CHandler({
    pool: {
      async query(sql, params = []) {
        traceQueries.push({ sql, params });
        return { rows: [] };
      },
    },
    client: {
      messages: {
        create: async () => {
          modelCalls += 1;
          return { content: [{ type: 'text', text: '不應呼叫模型' }] };
        },
      },
    },
    retrieveKnowledgeForQuestion: async () => {
      throw new Error('direct reply should not use RAG');
    },
    buildRuntimeGuardrails: () => '',
    buildSystemPrompt: () => '',
    buildSystemPromptBlocks: null,
    defaultAnthropicModel: 'test-model',
    classifyQuestion: () => ({
      category: 'customer_service',
      directReply: '請由人工客服協助。',
      shouldUseRag: false,
    }),
  });

  const outcome = await handler({
    locationErrorReply: '',
    rateLimitKey: 'line_b2c_direct_test',
    sessionId: 'line_customer_test',
    userCoords: null,
    userText: '我要找客服',
  });

  assert.equal(outcome.reply, '請由人工客服協助。');
  assert.equal(outcome.shouldReply, true);
  assert.equal(outcome.shouldStoreConversation, true);
  assert.equal(outcome.classification.category, 'customer_service');
  assert.equal(modelCalls, 0);
  assert.equal(traceQueries.length, 1);
});
