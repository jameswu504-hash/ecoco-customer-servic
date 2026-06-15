const fs = require('fs');
const path = require('path');

const SOURCE_PRIORITY = {
  official_faq: 0,
  web_faq_api: 1,
  response_policy_doc: 2,
  social_reply_template: 3,
  agent_reply_bank: 4,
  legacy_system_prompt: 5,
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:^|\n)\s*(?:ECOCO\s*)?(?:客服團隊|宜可可循環經濟團隊|ECOCO Team)\s*$/gim, '')
    .trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function sectionKey(row) {
  return normalizeText(row.category) || '未分類';
}

function automationLabel(value) {
  const normalized = normalizeText(value);
  if (normalized === 'auto_reply_with_guardrails') return '全自動回覆（高風險需保守話術）';
  if (normalized === 'auto_reply_allowed') return '全自動回覆';
  if (normalized === 'record_gap') return '記錄知識缺口';
  return normalized;
}

function formatRecord(row) {
  const title = normalizeText(row.question_or_trigger) || normalizeText(row.subcategory) || row.record_id;
  const answer = normalizeText(row.answer_or_content);
  const meta = [`ID：${row.record_id}`];

  if (row.source) meta.push(`來源：${row.source}`);
  if (row.source_date) meta.push(`日期：${row.source_date}`);
  if (row.automation_level) meta.push(`自動化：${automationLabel(row.automation_level)}`);
  if (row.risk) meta.push(`風險：${row.risk}`);
  if (row.notes) meta.push(`備註：${row.notes}`);

  return `### ${title}\n${meta.map(item => `- ${item}`).join('\n')}\n\n${answer}`;
}

function buildBrandSection(database) {
  const lines = [
    '以下為 ECOCO AI 客服的品牌與語氣規範。若和 FAQ 或客服 SOP 衝突，以較新的官方 FAQ / 線上 FAQ 為準。',
    '',
  ];

  for (const item of database.brand_guidelines || []) {
    lines.push(`## ${normalizeText(item.topic)}`);
    lines.push(normalizeText(item.rule));
    if (item.ai_use) lines.push(`AI 使用方式：${normalizeText(item.ai_use)}`);
    if (item.source) lines.push(`來源：${normalizeText(item.source)}`);
    lines.push('');
  }

  return {
    category: '品牌語氣與客服原則',
    content: lines.join('\n').trim(),
    source: 'ECOCO AI 客服資料庫整合版 / 05_品牌規範',
    visibility: 'public_answer_rules',
  };
}

function buildPolicySection(database) {
  const lines = [
    '以下為 AI 客服全自動回覆時的安全邊界。高風險問題可以由 AI 直接回覆，但必須保守回答、收集必要資訊、引導客服表單，不能承諾補點、退款或已完成人工處理。',
    '',
  ];

  for (const policy of database.response_policies || []) {
    lines.push(`## ${policy.intent}`);
    lines.push(`- 必收資料：${policy.required_fields}`);
    lines.push(`- 可說：${policy.allowed_response}`);
    lines.push(`- 不可說：${policy.do_not_say}`);
    lines.push(`- 自動化等級：${automationLabel(policy.automation_level)}`);
    lines.push(`- 來源：${policy.source}`);
    lines.push('');
  }

  return {
    category: '客服SOP與回覆政策',
    content: lines.join('\n').trim(),
    source: 'ECOCO AI 客服資料庫整合版 / 02_客服SOP',
    visibility: 'public_answer_rules',
  };
}

function buildConflictSection(database) {
  const lines = [
    '以下內容不可直接給 AI 當事實回答，必須先由主管或官方來源確認後再更新正式知識庫。',
    '',
  ];

  for (const conflict of database.conflicts_pending_review || []) {
    const topic = conflict.topic || conflict.issue || '未命名衝突';
    const observed = conflict.conflict_found || conflict.observed_conflict || '';
    lines.push(`## ${topic}`);
    lines.push(`- 優先級：${conflict.priority || ''}`);
    lines.push(`- 目前觀察到的衝突：${observed}`);
    lines.push(`- 建議處理方式：${conflict.recommended_resolution || ''}`);
    lines.push('');
  }

  return {
    category: '資料衝突與待確認事項',
    content: lines.join('\n').trim(),
    source: 'ECOCO AI 客服資料庫整合版 / 07_衝突待確認',
    visibility: 'internal_review',
  };
}

function buildKnowledgeSections(database) {
  const records = (database.knowledge_records || [])
    .filter(row =>
      normalizeText(row.status) === 'active' &&
      normalizeText(row.use_in_ai).toLowerCase() === 'yes' &&
      normalizeText(row.automation_level) !== 'internal_only'
    )
    .sort((a, b) => {
      const priorityA = SOURCE_PRIORITY[a.source_type] ?? 99;
      const priorityB = SOURCE_PRIORITY[b.source_type] ?? 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      const keyCompare = sectionKey(a).localeCompare(sectionKey(b), 'zh-Hant');
      if (keyCompare !== 0) return keyCompare;
      return String(a.record_id || '').localeCompare(String(b.record_id || ''));
    });

  const grouped = new Map();
  for (const row of records) {
    const key = sectionKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const sections = [buildBrandSection(database), buildPolicySection(database)];
  for (const [key, rows] of grouped) {
    const header = [
      `本節共有 ${rows.length} 筆資料。`,
      '使用原則：所有可公開回答的 FAQ 均採全自動回覆；點數、優惠券、帳號、客訴、機台異常等高風險內容需用保守話術，收集必要資訊並引導客服表單，不承諾補點、退款或已完成人工處理。',
      '',
    ];
    sections.push({
      category: `AI客服知識：${key}`,
      content: [...header, ...rows.map(formatRecord)].join('\n\n'),
      source: 'ECOCO AI 客服資料庫整合版 / 01_AI知識庫主表',
      visibility: 'public_knowledge_or_agent_assist',
    });
  }

  sections.push(buildConflictSection(database));
  return sections;
}

function buildImportPayload(database) {
  return {
    generated_at: new Date().toISOString(),
    source: database.source,
    notes: 'Generated from the consolidated ECOCO AI customer service database. Legacy credentials and old API settings are intentionally excluded. Only active, latest-source records are used for AI import sections.',
    summary: database.summary || {},
    sections: buildKnowledgeSections(database),
  };
}

function buildPolicyPayload(database) {
  return {
    generated_at: new Date().toISOString(),
    source: database.source,
    policies: database.response_policies || [],
  };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const inputArgIndex = process.argv.indexOf('--input');
  const outputArgIndex = process.argv.indexOf('--output-dir');
  const inputPath = path.resolve(repoRoot, inputArgIndex >= 0 ? process.argv[inputArgIndex + 1] : 'data/ecoco-ai-customer-service-database.json');
  const outputDir = path.resolve(repoRoot, outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : 'data');
  const database = readJson(inputPath);

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, 'ecoco-knowledge-import.json'), buildImportPayload(database));
  writeJson(path.join(outputDir, 'ecoco-response-policies.json'), buildPolicyPayload(database));

  console.log(`Built ECOCO knowledge data: records=${(database.knowledge_records || []).length} sections=${buildKnowledgeSections(database).length}`);
}

main();
