const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SCHEMA } = require('../db/schema');
const {
  cleanPartnerKnowledgeFile,
} = require('../public/partner-data-cleaner');
const {
  createPartnerCleaningService,
} = require('../services/partner-cleaning.service');

test('local cleaner accepts LINE TXT, preserves internal contacts and never uses external AI', async () => {
  const phone = ['0912', '345', '678'].join('-');
  const email = ['familymart.pm', 'example.com'].join('@');
  const result = await cleanPartnerKnowledgeFile({
    company: { id: 1, name: '全家便利商店（測試）', slug: 'familymart-test' },
    sourceName: '[LINE] ECOCO x FamilyMart.txt',
    content: [
      '[LINE] ECOCO x FamilyMart 聊天記錄',
      '儲存日期：2026/7/30 09:00',
      '',
      '2026/7/29（週三）',
      `09:10\t全家 PM\t崇學站請聯絡 ${phone} 或 ${email}`,
      '09:11\tECOCO PM\t[照片]',
      '09:15\t營運\t已建立設備檢查任務',
      '',
      '2026/7/30（週四）',
      '10:00\t全家 PM\t請確認目前處理狀況',
    ].join('\n'),
  });

  assert.equal(result.source.type, 'line_txt');
  assert.match(result.source.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.policy.preservePersonalData, true);
  assert.equal(result.policy.externalAiUsed, false);
  assert.ok(result.sections.length >= 2);
  assert.ok(result.chunks.length >= result.sections.length);
  assert.ok(result.markdown.includes(phone));
  assert.ok(result.markdown.includes(email));
  assert.equal(result.markdown.includes('[照片]'), false);
  assert.ok(result.sections.every(section => section.companyId === 1));
  assert.ok(result.chunks.every(chunk => chunk.companyId === 1));
});

test('local cleaner accepts Markdown and preserves headings as AI-readable sections', async () => {
  const result = await cleanPartnerKnowledgeFile({
    company: { id: 1, name: '全家便利商店（測試）', slug: 'familymart-test' },
    sourceName: '全家合作知識.md',
    content: [
      '# 全家合作摘要',
      '',
      'ECOCO 與全家合作設置回收機台。',
      '',
      '## 點數合作',
      '',
      '50 點 ECOCO 點數可以依現行規則兌換全家點數。',
      '',
      '## 內部窗口',
      '',
      '請聯絡 familymart.pm@example.com。',
    ].join('\n'),
  });

  assert.equal(result.source.type, 'markdown');
  assert.ok(result.sections.length >= 3);
  assert.ok(result.sections.some(section => /點數合作/.test(section.title)));
  assert.ok(result.markdown.includes('familymart.pm@example.com'));
  assert.equal(result.policy.externalAiUsed, false);
});

test('local cleaner rejects unsupported files', async () => {
  await assert.rejects(
    cleanPartnerKnowledgeFile({
      company: { id: 1, name: '全家便利商店（測試）' },
      sourceName: '合作資料.pdf',
      content: '內容',
    }),
    /TXT.*Markdown|TXT.*MD/i
  );
});

test('B2B cleaning schema keeps sources, jobs and chunks company-scoped', () => {
  const schema = SCHEMA.join('\n');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_source_documents/);
  assert.match(schema, /partner_source_documents[\s\S]*company_id\s+INTEGER NOT NULL/);
  assert.match(schema, /partner_source_documents[\s\S]*content_hash\s+TEXT NOT NULL/);
  assert.match(schema, /partner_source_documents[\s\S]*raw_content_stored\s+BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_cleaning_jobs/);
  assert.match(schema, /partner_cleaning_jobs[\s\S]*skill_version\s+TEXT NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_knowledge_chunks/);
  assert.match(schema, /partner_knowledge_chunks[\s\S]*company_id\s+INTEGER NOT NULL/);
  assert.match(schema, /partner_knowledge_chunks[\s\S]*source_references\s+JSONB/);
});

test('approved local package imports sections and chunks in one company-scoped transaction', async () => {
  const queries = [];
  let sectionSequence = 80;
  const connection = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/INSERT INTO partner_source_documents/.test(sql)) {
        return { rows: [{ id: 41 }] };
      }
      if (/INSERT INTO partner_cleaning_jobs/.test(sql)) {
        return { rows: [{ id: 51 }] };
      }
      if (/INSERT INTO partner_knowledge_sections/.test(sql)) {
        sectionSequence += 1;
        return { rows: [{ id: sectionSequence }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const service = createPartnerCleaningService({
    pool: {
      async connect() {
        return connection;
      },
    },
  });
  const result = await service.importApprovedPackage(7, {
    source: {
      name: '全家合作知識.md',
      type: 'markdown',
      contentHash: 'a'.repeat(64),
      characterCount: 120,
    },
    policy: {
      preservePersonalData: true,
      externalAiUsed: false,
      rawContentUploaded: false,
    },
    skill: {
      name: 'ecoco-clean-brand-knowledge',
      version: '1.0.0',
    },
    report: {
      warnings: [],
    },
    sections: [
      {
        title: '合作摘要',
        category: '清洗資料｜合作摘要',
        content: '聯絡 familymart.pm@example.com',
        contentHash: 'b'.repeat(64),
        metadata: { topic: '合作摘要' },
      },
    ],
    chunks: [
      {
        sectionIndex: 0,
        chunkIndex: 0,
        topic: '合作摘要',
        content: '聯絡 familymart.pm@example.com',
        searchText: '合作摘要 聯絡 familymart.pm@example.com',
        metadata: { sourceType: 'markdown' },
        sourceReferences: [{ sourceName: '全家合作知識.md', sectionIndex: 0 }],
      },
    ],
  });

  assert.equal(result.companyId, 7);
  assert.equal(result.createdSectionCount, 1);
  assert.equal(result.createdChunkCount, 1);
  assert.ok(queries.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
  const sourceInsert = queries.find(({ sql }) => /INSERT INTO partner_source_documents/.test(sql));
  const sectionInsert = queries.find(({ sql }) => /INSERT INTO partner_knowledge_sections/.test(sql));
  const chunkInsert = queries.find(({ sql }) => /INSERT INTO partner_knowledge_chunks/.test(sql));
  assert.equal(sourceInsert.params[0], 7);
  assert.equal(sectionInsert.params[0], 7);
  assert.equal(chunkInsert.params[0], 7);
  assert.ok(sectionInsert.params.includes('聯絡 familymart.pm@example.com'));
});

test('import rejects packages that used external AI or uploaded raw content', async () => {
  const service = createPartnerCleaningService({
    pool: {
      async connect() {
        throw new Error('database should not be reached');
      },
    },
  });
  const base = {
    source: {
      name: '全家合作知識.md',
      type: 'markdown',
      contentHash: 'a'.repeat(64),
      characterCount: 120,
    },
    skill: {
      name: 'ecoco-clean-brand-knowledge',
      version: '1.0.0',
    },
    report: { warnings: [] },
    sections: [{
      title: '合作摘要',
      category: '清洗資料｜合作摘要',
      content: '內容',
      contentHash: 'b'.repeat(64),
      metadata: {},
    }],
    chunks: [{
      sectionIndex: 0,
      chunkIndex: 0,
      topic: '合作摘要',
      content: '內容',
      searchText: '內容',
      metadata: {},
      sourceReferences: [],
    }],
  };

  await assert.rejects(
    service.importApprovedPackage(7, {
      ...base,
      policy: {
        preservePersonalData: true,
        externalAiUsed: true,
        rawContentUploaded: false,
      },
    }),
    /external AI/i
  );
  await assert.rejects(
    service.importApprovedPackage(7, {
      ...base,
      policy: {
        preservePersonalData: true,
        externalAiUsed: false,
        rawContentUploaded: true,
      },
    }),
    /raw content/i
  );
});

test('partner page exposes local TXT and Markdown cleaning before approved SQL import', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'partners.html'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'partners.js'),
    'utf8'
  );

  assert.match(html, /AI 資料清洗/);
  assert.match(html, /accept="\.txt,\.md,text\/plain,text\/markdown"/);
  assert.match(html, /partner-data-cleaner\.js/);
  assert.match(html, /原始檔只在此瀏覽器處理，不會上傳/);
  assert.match(js, /cleanPartnerKnowledgeFile/);
  assert.match(js, /\/knowledge\/import-cleaned/);
  assert.match(js, /確認並匯入知識庫/);
  assert.doesNotMatch(js, /preservePersonalData:\s*false/);
});
