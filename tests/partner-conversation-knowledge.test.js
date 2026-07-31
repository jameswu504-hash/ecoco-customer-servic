const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SCHEMA } = require('../db/schema');
const {
  SKILL_NAME,
  SKILL_VERSION,
  buildCandidatesForConversationGroup,
  createPartnerConversationKnowledgeService,
} = require('../services/partner-conversation-knowledge.service');

test('LINE conversation cleaning creates traceable candidates without external AI', () => {
  const result = buildCandidatesForConversationGroup({
    companyId: 7,
    lineGroupId: 3,
    conversationDay: '2026-07-30',
    groupLabel: '全家測試群',
    messages: [
      { id: 1, role: 'user', content: '謝謝' },
      { id: 2, role: 'user', content: '崇學站現在機台狀態正常嗎？' },
      { id: 3, role: 'assistant', content: '目前機台正常、連線正常。' },
      { id: 4, role: 'user', content: '請營運安排明天清運並確認。' },
    ],
  });

  assert.equal(result.skippedNoise, 1);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[0].sourceMessageIds, [2, 3]);
  assert.ok(result.candidates[0].riskFlags.includes('operational_status'));
  assert.deepEqual(result.candidates[0].facts, []);
  assert.deepEqual(result.candidates[0].pendingItems, ['崇學站現在機台狀態正常嗎？']);
  assert.deepEqual(result.candidates[1].pendingItems, ['請營運安排明天清運並確認。']);
  assert.ok(result.candidates[1].todos.length > 0);
  assert.match(result.candidates[0].contentHash, /^[a-f0-9]{64}$/);
});

test('B2B candidate schema keeps batches and review data company-scoped', () => {
  const schema = SCHEMA.join('\n');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_conversation_batches/);
  assert.match(schema, /partner_conversation_batches[\s\S]*company_id\s+INTEGER NOT NULL/);
  assert.match(schema, /UNIQUE\(company_id, line_group_id, conversation_day, content_hash\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_knowledge_candidates/);
  assert.match(schema, /partner_knowledge_candidates[\s\S]*source_message_ids\s+JSONB/);
  assert.match(schema, /partner_knowledge_candidates[\s\S]*approved_section_id/);
  assert.match(schema, /UNIQUE\(company_id, content_hash\)/);
});

test('candidate generation reads only active company LINE messages and is idempotent', async () => {
  const sourceQueries = [];
  const transactionQueries = [];
  let candidateSequence = 100;
  const connection = {
    async query(sql, params = []) {
      transactionQueries.push({ sql, params });
      if (/INSERT INTO partner_conversation_batches/.test(sql)) {
        return { rows: [{ id: 51 }] };
      }
      if (/INSERT INTO partner_knowledge_candidates/.test(sql)) {
        candidateSequence += 1;
        return { rows: [{ id: candidateSequence }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const service = createPartnerConversationKnowledgeService({
    pool: {
      async query(sql, params = []) {
        sourceQueries.push({ sql, params });
        return {
          rows: [
            {
              id: 11,
              line_group_id: 4,
              role: 'user',
              content: '全家與 ECOCO 的合作內容是什麼？',
              timestamp: '2026-07-30T01:00:00.000Z',
              conversation_day: '2026-07-30',
              group_label: '全家群組',
              total_source_count: '2001',
            },
            {
              id: 12,
              line_group_id: 4,
              role: 'assistant',
              content: '合作內容包含門市回收機台。',
              timestamp: '2026-07-30T01:01:00.000Z',
              conversation_day: '2026-07-30',
              group_label: '全家群組',
              total_source_count: '2001',
            },
          ],
        };
      },
      async connect() {
        return connection;
      },
    },
  });

  const result = await service.generateCandidates(7, 1);

  assert.equal(result.companyId, 7);
  assert.equal(result.createdBatchCount, 1);
  assert.equal(result.createdCandidateCount, 1);
  assert.equal(result.skill.name, SKILL_NAME);
  assert.equal(result.skill.version, SKILL_VERSION);
  assert.equal(result.skill.externalAiUsed, false);
  assert.equal(result.truncated, true);
  assert.match(sourceQueries[0].sql, /pc\.company_id = \$1/);
  assert.match(sourceQueries[0].sql, /pc\.archived_at IS NULL/);
  assert.match(sourceQueries[0].sql, /AT TIME ZONE 'Asia\/Taipei'/);
  assert.match(sourceQueries[0].sql, /COUNT\(\*\) OVER\(\) AS total_source_count/);
  assert.match(sourceQueries[0].sql, /ORDER BY pc\.timestamp DESC, pc\.id DESC/);
  assert.match(sourceQueries[0].sql, /ORDER BY recent\.line_group_id ASC[\s\S]*recent\.timestamp ASC/);
  assert.deepEqual(sourceQueries[0].params.slice(0, 2), [7, 1]);
  assert.equal(sourceQueries[0].params[2], 2_000);
  const batchInsert = transactionQueries.find(({ sql }) => (
    /INSERT INTO partner_conversation_batches/.test(sql)
  ));
  const candidateInsert = transactionQueries.find(({ sql }) => (
    /INSERT INTO partner_knowledge_candidates/.test(sql)
  ));
  assert.equal(batchInsert.params[0], 7);
  assert.equal(candidateInsert.params[0], 7);
  assert.match(batchInsert.sql, /ON CONFLICT .* DO NOTHING/s);
  assert.match(candidateInsert.sql, /ON CONFLICT .* DO NOTHING/s);
});

test('approving a candidate creates company-scoped knowledge and RAG chunks', async () => {
  const queries = [];
  const connection = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/SELECT pkc\.\*, pcb\.conversation_day/.test(sql)) {
        return {
          rows: [{
            id: 81,
            company_id: 7,
            batch_id: 51,
            line_group_id: 4,
            title: '合作內容',
            category: 'LINE 待審｜一般合作事項',
            content: '合作內容包含門市回收機台。',
            source_message_ids: [11, 12],
            risk_flags: [],
            status: 'pending_review',
            approved_section_id: null,
            conversation_day: '2026-07-30',
            skill_name: SKILL_NAME,
            skill_version: SKILL_VERSION,
          }],
        };
      }
      if (/MAX\(sort_order\)/.test(sql)) return { rows: [{ next: 3 }] };
      if (/INSERT INTO partner_knowledge_sections/.test(sql)) {
        return { rows: [{ id: 91 }] };
      }
      if (/UPDATE partner_knowledge_candidates/.test(sql)) {
        return {
          rows: [{
            id: 81,
            company_id: 7,
            status: 'approved',
            approved_section_id: 91,
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const service = createPartnerConversationKnowledgeService({
    pool: {
      async connect() {
        return connection;
      },
    },
  });

  const result = await service.reviewCandidate(7, 81, {
    status: 'approved',
    title: '全家合作內容',
    category: 'LINE 待審｜一般合作事項',
    content: 'ECOCO 與全家合作設置門市回收機台。',
  });

  assert.equal(result.createdKnowledgeSectionId, 91);
  assert.equal(result.candidate.status, 'approved');
  const sectionInsert = queries.find(({ sql }) => /INSERT INTO partner_knowledge_sections/.test(sql));
  const chunkInsert = queries.find(({ sql }) => /INSERT INTO partner_knowledge_chunks/.test(sql));
  const candidateUpdate = queries.find(({ sql }) => /UPDATE partner_knowledge_candidates/.test(sql));
  assert.equal(sectionInsert.params[0], 7);
  assert.equal(chunkInsert.params[0], 7);
  assert.equal(candidateUpdate.params[0], 7);
  assert.match(chunkInsert.params[8], /partner_conversation/);
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
});

test('partner admin exposes manual one-day and seven-day candidate review workflow', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'partners.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'partners.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes', 'partners.routes.js'), 'utf8');
  const skill = fs.readFileSync(
    path.join(root, 'skills', 'ecoco-clean-brand-knowledge', 'SKILL.md'),
    'utf8'
  );

  assert.match(html, /LINE 待審知識/);
  assert.match(html, /整理今天/);
  assert.match(html, /整理最近 7 天/);
  assert.match(html, /人工核准後才會進入公司知識與 RAG/);
  assert.match(js, /knowledge-candidates\/generate/);
  assert.match(js, /核准並匯入 RAG/);
  assert.match(js, /candidateStatus/);
  assert.match(js, /紀錄超過 2,000 則，僅處理最新 2,000 則/);
  assert.match(routes, /knowledge-candidates\/:candidateId/);
  assert.match(skill, /name: ecoco-clean-brand-knowledge/);
  assert.match(skill, /版本：1\.2\.0/);
  assert.match(skill, /Bot 回覆不得自動列為已確認事實/);
  assert.match(skill, /pending_review/);
  assert.match(skill, /不得進入 RAG/);
});
