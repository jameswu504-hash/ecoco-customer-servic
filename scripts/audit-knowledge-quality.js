const fs = require('fs');
const path = require('path');
const { anonymizeJsonValue, anonymizeText } = require('./anonymize-pii');

const repoRoot = path.join(__dirname, '..');
const databasePath = path.join(repoRoot, 'data', 'ecoco-ai-customer-service-database.json');
const jsonOutputPath = path.join(repoRoot, 'data', 'knowledge-quality-audit.json');
const markdownOutputPath = path.join(repoRoot, 'docs', 'KNOWLEDGE_QUALITY_AUDIT.md');

const SOURCE_PRIORITY = {
  official_faq: 100,
  web_faq_api: 90,
  response_policy_doc: 85,
  social_reply_template: 75,
  legacy_system_prompt: 60,
  agent_reply_bank: 50,
};

function normalizeQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[？?！!。．.，,、：:；;「」『』（）()【】\[\]\s]/g, '')
    .trim();
}

function sourcePriority(row) {
  return SOURCE_PRIORITY[row.source_type] || 0;
}

function riskPriority(row) {
  return { Low: 1, Medium: 2, High: 3 }[row.risk] || 0;
}

function chooseRecommendedRecord(rows) {
  return [...rows].sort((a, b) => {
    const sourceDiff = sourcePriority(b) - sourcePriority(a);
    if (sourceDiff !== 0) return sourceDiff;

    const riskDiff = riskPriority(a) - riskPriority(b);
    if (riskDiff !== 0) return riskDiff;

    return String(b.source_date || '').localeCompare(String(a.source_date || ''));
  })[0];
}

function preview(value, length = 180) {
  const text = anonymizeText(String(value || '')).replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function main() {
  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const records = Array.isArray(database.knowledge_records) ? database.knowledge_records : [];
  const activeAiRecords = records.filter(row =>
    row.status === 'active' &&
    String(row.use_in_ai || '').toLowerCase() === 'yes' &&
    row.automation_level !== 'internal_only'
  );
  const groups = new Map();

  for (const row of activeAiRecords) {
    const key = normalizeQuestion(row.question_or_trigger);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([normalized_question, rows]) => {
      const recommended = chooseRecommendedRecord(rows);
      return {
        normalized_question,
        question: recommended.question_or_trigger,
        duplicate_count: rows.length,
        recommended_keep_record_id: recommended.record_id,
        recommended_reason: `優先來源：${recommended.source_type || '未標示'}；風險：${recommended.risk || '未標示'}`,
        candidates: rows.map(row => ({
          record_id: row.record_id,
          source_type: row.source_type,
          source: row.source,
          category: row.category,
          risk: row.risk,
          automation_level: row.automation_level,
          status: row.status,
          answer_preview: preview(row.answer_or_content),
          recommended_action: row.record_id === recommended.record_id ? 'keep' : 'review_or_archive',
        })),
      };
    })
    .sort((a, b) => b.duplicate_count - a.duplicate_count || a.question.localeCompare(b.question, 'zh-Hant'));

  const conflicts = Array.isArray(database.conflicts_pending_review)
    ? database.conflicts_pending_review
    : [];

  const audit = {
    generated_at: new Date().toISOString(),
    source: 'data/ecoco-ai-customer-service-database.json',
    summary: {
      knowledge_records: records.length,
      active_ai_records: activeAiRecords.length,
      archived_records: records.filter(row => row.status === 'archived').length,
      duplicate_groups: duplicateGroups.length,
      duplicate_records: duplicateGroups.reduce((sum, group) => sum + group.duplicate_count, 0),
      conflicts_pending_review: conflicts.length,
    },
    duplicate_groups: duplicateGroups,
    conflicts_pending_review: conflicts,
  };

  fs.writeFileSync(jsonOutputPath, `${JSON.stringify(anonymizeJsonValue(audit), null, 2)}\n`, 'utf8');

  const duplicateLines = duplicateGroups.slice(0, 40).map((group, index) => {
    const candidateLines = group.candidates.map(candidate => (
      `  - ${candidate.recommended_action === 'keep' ? '保留' : '檢查'}：${candidate.record_id} / ${candidate.source_type} / ${candidate.category} / ${candidate.risk}`
    )).join('\n');

    return [
      `### ${index + 1}. ${group.question}`,
      '',
      `- 重複筆數：${group.duplicate_count}`,
      `- 建議保留：${group.recommended_keep_record_id}`,
      `- 原因：${group.recommended_reason}`,
      '- 候選資料：',
      candidateLines,
    ].join('\n');
  }).join('\n\n');

  const conflictLines = conflicts.map((conflict, index) => (
    [
      `### ${index + 1}. ${conflict.topic || conflict.title || conflict.issue || '未命名衝突'}`,
      '',
      `- 狀態：${conflict.status || 'pending_review'}`,
      `- 說明：${conflict.description || conflict.issue || '需人工確認'}`,
      `- 建議：由主管或官方來源決定權威答案，再移除或合併矛盾來源。`,
    ].join('\n')
  )).join('\n\n');

  const markdown = `# ECOCO 知識庫品質稽核

本文件由 \`npm run audit:knowledge\` 產生，用來找出仍會進 AI 的重複問題與待確認衝突。已標成 \`archived\` 的歷史資料會保留在主檔，但不列入 active 重複統計。

## 摘要

- 知識筆數：${audit.summary.knowledge_records}
- 目前會進 AI 的筆數：${audit.summary.active_ai_records}
- 已封存筆數：${audit.summary.archived_records}
- active 重複問題組數：${audit.summary.duplicate_groups}
- active 重複涉及筆數：${audit.summary.duplicate_records}
- 待確認衝突：${audit.summary.conflicts_pending_review}

## 去重原則

建議優先序：

1. 官方 FAQ
2. 線上 FAQ API
3. 回覆政策文件
4. 社群回覆範本
5. 舊 Meta / system prompt
6. 真人客服話術

真人客服話術可保留語氣參考，但若和官方 FAQ 衝突，應以官方 FAQ 為準。\`npm run apply:knowledge-audit\` 會把建議剔除的 active 重複資料標成 \`archived\`，不會刪除原始資料。

## 重複問題清單（前 40 組）

${duplicateLines || '目前沒有偵測到重複問題。'}

## 待確認衝突

${conflictLines || '目前沒有待確認衝突。'}

## 完整 JSON

完整稽核結果請見：

\`\`\`text
data/knowledge-quality-audit.json
\`\`\`
`;

  fs.writeFileSync(markdownOutputPath, anonymizeText(markdown), 'utf8');
  console.log(`Wrote ${path.relative(repoRoot, jsonOutputPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, markdownOutputPath)}`);
}

main();
