// Integration tests for services/rag.service.js (RAG pipeline coverage gap).
// External services are mocked: the OpenAI embedding endpoint is intercepted via a
// global fetch mock so no real HTTP request is ever made.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildChunksFromSection,
  buildRuntimeGuardrails,
  buildSearchTerms,
  createRagService,
  extractRiskLevel,
  hasHighRiskChunk,
  normalizeRiskLevel,
  normalizeText,
  rankKnowledgeRows,
  scoreChunk,
} = require('../services/rag.service');

// ---- helpers ----------------------------------------------------------------

// Build a mock pg Pool whose query() returns whatever we preload by SQL substring.
function makePool(responses) {
  return {
    query(sql, params) {
      for (const [needle, result] of responses) {
        if (sql.includes(needle)) return Promise.resolve(result);
      }
      // default: empty
      return Promise.resolve({ rows: [] });
    },
    connect() {
      // mimic pg client with BEGIN/COMMIT/ROLLBACK/query/release
      const client = {
        queries: [],
        async query(sql, params) {
          client.queries.push({ sql, params });
          return Promise.resolve({ rows: [] });
        },
        release() {},
      };
      return Promise.resolve(client);
    },
  };
}

// Install a global fetch mock that only answers the OpenAI embedding endpoint.
function installFetchMock(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

// ---- pure functions ---------------------------------------------------------

test('normalizeRiskLevel maps aliases to canonical casing', () => {
  assert.equal(normalizeRiskLevel('high'), 'High');
  assert.equal(normalizeRiskLevel('medium'), 'Medium');
  assert.equal(normalizeRiskLevel(''), 'Low');
  assert.equal(normalizeRiskLevel(undefined), 'Low');
});

test('extractRiskLevel reads the risk label from free text', () => {
  assert.equal(extractRiskLevel('風險：High'), 'High');
  assert.equal(extractRiskLevel('risk: Medium'), 'Medium');
  assert.equal(extractRiskLevel('risk_level: Low'), 'Low');
  assert.equal(extractRiskLevel('no marker here'), 'Low');
});

test('scoreChunk weights category over title over content', () => {
  const chunk = { category: '點數問題', title: '點數未入帳', content: '請聯絡客服處理點數問題' };
  const s = scoreChunk(chunk, ['點數']);
  // category +8, title +6, content +2
  assert.equal(s, 16);
});

test('rankKnowledgeRows sorts by score and caps at MAX_RAG_CHUNKS, adds semantic score', () => {
  const rows = [
    { id: 1, category: '合作商家', title: '列表', content: 'x', sort_order: 1 },
    { id: 2, category: '點數問題', title: '點數未入帳', content: '點數說明', sort_order: 2, semantic_score: 0.5 },
    { id: 3, category: 'a', title: 'b', content: 'c', sort_order: 3 },
    { id: 4, category: 'a', title: 'b', content: 'c', sort_order: 4 },
    { id: 5, category: 'a', title: 'b', content: 'c', sort_order: 5 },
    { id: 6, category: 'a', title: 'b', content: 'c', sort_order: 6 },
    { id: 7, category: 'a', title: 'b', content: 'c', sort_order: 7 },
    { id: 8, category: 'a', title: 'b', content: 'c', sort_order: 8 },
    { id: 9, category: 'a', title: 'b', content: 'c', sort_order: 9 },
  ];
  const ranked = rankKnowledgeRows(rows, ['點數']);
  assert.ok(ranked.length <= 8);
  // the point row (semantic 0.5 -> +50) should beat the first row
  assert.equal(ranked[0].id, 2);
});

test('buildSearchTerms extracts keywords, synonyms and tokens without duplicates', () => {
  const terms = buildSearchTerms('我的點數沒有入帳，可以補點嗎？機台卡住了');
  assert.ok(terms.includes('點數'));
  assert.ok(terms.includes('入帳'));
  assert.ok(terms.includes('補點'));
  assert.ok(terms.includes('機台'));
  assert.ok(terms.includes('卡住'));
  assert.equal(new Set(terms).size, terms.length);
});

test('buildChunksFromSection splits a section into titled chunks and parses risk', () => {
  const chunks = buildChunksFromSection({
    id: 42,
    category: '點數問題',
    content: '前言說明\n### 點數效期\n有效期一年，請在 App 查詢。\n### 補點流程\n風險：High\n請提供手機末三碼。',
    updated_at: '2026-07-01',
  });
  // The leading "前言說明" becomes a chunk whose title falls back to the category.
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].title, '點數問題');
  assert.equal(chunks[0].category, '點數問題');
  assert.equal(chunks[0].riskLevel, 'Low');
  assert.equal(chunks[1].title, '點數效期');
  assert.equal(chunks[1].riskLevel, 'Low');
  assert.equal(chunks[2].title, '補點流程');
  assert.equal(chunks[2].riskLevel, 'High');
  assert.equal(chunks[0].sectionId, 42);
});

test('buildChunksFromSection returns empty for blank section', () => {
  assert.deepEqual(buildChunksFromSection({ id: 1, category: '', content: '' }), []);
});

test('hasHighRiskChunk reflects high-risk chunks only', () => {
  assert.equal(hasHighRiskChunk({ chunks: [{ risk_level: 'Low' }] }), false);
  assert.equal(hasHighRiskChunk({ chunks: [{ risk_level: 'High' }] }), true);
  assert.equal(hasHighRiskChunk({}), false);
});

test('buildRuntimeGuardrails returns empty text when no risk trigger', () => {
  const guardrail = buildRuntimeGuardrails('今天天氣如何', { chunks: [{ risk_level: 'Low' }], context: '' });
  assert.equal(guardrail, '');
});

test('buildRuntimeGuardrails triggers on high-risk chunk', () => {
  const guardrail = buildRuntimeGuardrails('一般問題', { chunks: [{ risk_level: 'High' }], context: '' });
  assert.match(guardrail, /不承諾|人工/i);
});

test('buildRuntimeGuardrails triggers on risky keyword (退款)', () => {
  const guardrail = buildRuntimeGuardrails('我可以申請退款嗎', { chunks: [], context: '' });
  assert.match(guardrail, /不承諾|人工/i);
});

test('normalizeText strips emoji and collapses whitespace', () => {
  const normalized = normalizeText('  Hello　 世界 🌟 World  ');
  assert.equal(normalized.includes('🌟'), false);
  assert.equal(normalized, 'Hello 世界 World');
});

// ---- service-level (mocked pool + mocked OpenAI embedding) -------------------

test('retrieveKnowledgeForQuestion: keyword mode only, no semantic without OPENAI key', async () => {
  const pool = makePool([
    ['SELECT id, category, title, content, risk_level, sort_order', {
      rows: [
        { id: 1, category: '點數問題', title: '點數未入帳', content: '請提供手機', risk_level: 'Low', sort_order: 1 },
      ],
    }],
  ]);
  const rag = createRagService({ pool, env: {} });
  const result = await rag.retrieveKnowledgeForQuestion('我的點數沒有入帳');

  assert.equal(result.retrievalMode, 'keyword');
  assert.equal(result.chunks.length, 1);
  assert.match(result.context, /點數未入帳/);
});

test('retrieveKnowledgeForQuestion: none mode when nothing matches', async () => {
  const pool = makePool([]); // all queries return empty rows
  const rag = createRagService({ pool, env: {} });
  const result = await rag.retrieveKnowledgeForQuestion('完全不相關的字串 qwerty');

  assert.equal(result.retrievalMode, 'none');
  assert.deepEqual(result.chunks, []);
  assert.equal(result.context, '');
});

test('retrieveKnowledgeForQuestion: hybrid mode when both semantic and keyword hit (mocked embedding)', async () => {
  const restore = installFetchMock(async (url, opts) => {
    const body = JSON.parse(opts.body);
    // return a fake embedding vector for each input
    const data = body.input.map((text) => ({ embedding: new Array(8).fill(0.1) }));
    return {
      ok: true,
      json: async () => ({ data }),
      text: async () => '',
    };
  });

  let semanticQuerySeen = false;
  const pool = makePool([
    ['1 - (embedding <=> $1::vector)', { rows: [
      { id: 1, category: '站點', title: '新竹站點', content: '新竹有設點', risk_level: 'Low', sort_order: 5, semantic_score: 0.9 },
    ], semanticQuerySeenMarker: true }],
    ['SELECT id, category, title, content, risk_level, sort_order', { rows: [
      { id: 1, category: '站點', title: '新竹站點', content: '新竹有設點', risk_level: 'Low', sort_order: 5 },
    ] }],
  ]);
  // tag the semantic query branch by intercepting query
  const wrappedPool = {
    async query(sql, params) {
      if (sql.includes('embedding <=>')) semanticQuerySeen = true;
      return pool.query(sql, params);
    },
    connect: pool.connect.bind(pool),
  };

  try {
    const rag = createRagService({ pool: wrappedPool, env: { OPENAI_API_KEY: 'test-key' } });
    // force the semantic path on by enabling pgVector via ensurePgVector with a non-throwing pool
    await rag.ensurePgVector();
    const result = await rag.retrieveKnowledgeForQuestion('新竹哪裡有站點');

    assert.equal(semanticQuerySeen, true);
    assert.equal(result.retrievalMode, 'hybrid');
    assert.equal(result.chunks.length, 1);
  } finally {
    restore();
  }
});

test('ensurePgVector marks vector unavailable when CREATE EXTENSION fails (mocked pool)', async () => {
  const failingPool = {
    async query() { throw new Error('extension not supported'); },
    async connect() { throw new Error('should not connect'); },
  };
  const rag = createRagService({ pool: failingPool, env: {} });
  await rag.ensurePgVector();
  // should not throw; semantic search should stay disabled
  assert.equal(rag.shouldUseSemanticSearch(), false);
});

test('rebuildKnowledgeChunks writes chunks through a transaction (mocked pool + mocked fetch)', async () => {
  const restore = installFetchMock(async (url, opts) => {
    const body = JSON.parse(opts.body);
    const data = body.input.map(() => ({ embedding: new Array(8).fill(0.2) }));
    return { ok: true, json: async () => ({ data }), text: async () => '' };
  });

  let committed = false;
  let deleted = false;
  let inserted = false;
  const pool = {
    async query(sql) {
      if (sql.includes('FROM knowledge_sections WHERE COALESCE(archived_at')) {
        return { rows: [{ id: 1, category: '點數問題', content: '### 效期\n一年有效。', sort_order: 1, updated_at: '2026-07-01' }] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('BEGIN')) return;
          if (sql.includes('COMMIT')) { committed = true; return; }
          if (sql.includes('ROLLBACK')) return;
          if (sql.includes('pg_advisory_xact_lock')) return;
          if (sql.includes('DELETE FROM knowledge_chunks')) { deleted = true; return; }
          if (sql.includes('INSERT INTO knowledge_chunks')) { inserted = true; return; }
        },
        release() {},
      };
    },
  };

  try {
    const rag = createRagService({ pool, env: {} });
    await rag.rebuildKnowledgeChunks();
    assert.equal(deleted, true, 'should delete old chunks');
    assert.equal(inserted, true, 'should insert new chunks');
    assert.equal(committed, true, 'should commit the transaction');
  } finally {
    restore();
  }
});

test('rebuildKnowledgeChunksForSection only rebuilds the requested section (mocked pool)', async () => {
  let deletedId = null;
  const pool = {
    async query(sql, params) {
      if (sql.includes('archived_at')) return { rows: [{ id: 7, category: 'APP', content: '登入說明', sort_order: 1, archived_at: '' }] };
      if (sql.includes('base_sort_order')) return { rows: [{ base_sort_order: 0 }] };
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params) {
          if (sql.includes('DELETE FROM knowledge_chunks WHERE section_id')) deletedId = params[0];
          if (sql.includes('COMMIT')) return;
          if (sql.includes('BEGIN')) return;
          if (sql.includes('ROLLBACK')) return;
          if (sql.includes('pg_advisory_xact_lock')) return;
          if (sql.includes('INSERT INTO knowledge_chunks')) return;
        },
        release() {},
      };
    },
  };

  const rag = createRagService({ pool, env: {} });
  await rag.rebuildKnowledgeChunksForSection(7);
  assert.equal(deletedId, 7);
});

test('shouldUseSemanticSearch is false without OPENAI_API_KEY even if pgVector is available', () => {
  const pool = {
    async query() { return { rows: [] }; },
    async connect() { return { query() {}, release() {} }; },
  };
  const rag = createRagService({ pool, env: { OPENAI_API_KEY: '' } });
  assert.equal(rag.shouldUseSemanticSearch(), false);
});
