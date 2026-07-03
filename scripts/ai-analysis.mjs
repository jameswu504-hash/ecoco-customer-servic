import process from 'node:process';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fetchJson(baseUrl, path, adminKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: adminKey ? { 'x-admin-key': adminKey } : {},
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function countPendingUnanswered(unanswered) {
  if (!Array.isArray(unanswered)) return 0;
  return unanswered.filter(item => String(item.status || 'pending') === 'pending').length;
}

function buildDeterministicSummary({ status, overview, operations, unanswered }) {
  const summary = operations.summary || {};
  const knowledge = operations.knowledge || {};
  const pendingUnanswered = countPendingUnanswered(unanswered);
  const lines = [];

  lines.push('# ECOCO AI 客服週巡檢摘要');
  lines.push('');
  lines.push(`- 服務狀態：${status.status === 'ok' ? '正常' : '異常'}`);
  lines.push(`- DB 狀態：${status.database || 'unknown'}`);
  lines.push(`- 模型：${status.anthropicModel || overview.model || 'unknown'}`);
  lines.push(`- 語意 RAG：${status.semanticRagEnabled ? 'enabled' : 'disabled'}`);
  lines.push(`- 知識同步模式：${status.knowledgeAutoSyncMode || overview.effectiveAutoSyncMode || 'unknown'}`);
  lines.push(`- PostgreSQL 知識分類：${overview.dbSectionCount ?? knowledge.dbSections ?? 0}`);
  lines.push(`- RAG chunks：${overview.ragChunkCount ?? knowledge.ragChunks ?? 0}`);
  lines.push(`- 待確認衝突：${knowledge.conflictsPendingReview ?? 0}`);
  lines.push(`- 本週客服 session：${summary.sessions ?? 0}`);
  lines.push(`- 本週使用者訊息：${summary.userMessages ?? 0}`);
  lines.push(`- 本週 AI 回覆：${summary.aiReplies ?? 0}`);
  lines.push(`- 本週知識缺口：${summary.knowledgeGaps ?? 0}`);
  lines.push(`- 目前 pending 知識缺口：${pendingUnanswered}`);

  if (Array.isArray(status.startupWarnings) && status.startupWarnings.length > 0) {
    lines.push('');
    lines.push('## 啟動警告');
    status.startupWarnings.forEach(warning => lines.push(`- ${warning}`));
  }

  if (Array.isArray(operations.categories) && operations.categories.length > 0) {
    lines.push('');
    lines.push('## 本週主要問題分類');
    operations.categories.slice(0, 5).forEach(item => {
      lines.push(`- ${item.category}: ${item.count}`);
    });
  }

  return lines.join('\n');
}

async function buildAiSummary(summary) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return '';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `請根據以下 ECOCO AI 客服週巡檢摘要，整理 3 點重點觀察與 3 點下週建議，語氣專業、簡潔、可交給主管閱讀。\n\n${summary}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic analysis failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  return payload.content?.find(block => block.type === 'text')?.text || '';
}

async function main() {
  const baseUrl = requiredEnv('ECOCO_BASE_URL').replace(/\/+$/, '');
  const adminKey = requiredEnv('ADMIN_KEY');

  const [status, overview, operations, unanswered] = await Promise.all([
    fetchJson(baseUrl, '/api/system/status', adminKey),
    fetchJson(baseUrl, '/api/knowledge/overview', adminKey),
    fetchJson(baseUrl, '/api/reports/operations?period=week', adminKey),
    fetchJson(baseUrl, '/api/unanswered', adminKey),
  ]);

  const summary = buildDeterministicSummary({ status, overview, operations, unanswered });
  console.log(summary);

  try {
    const aiSummary = await buildAiSummary(summary);
    if (aiSummary) {
      console.log('\n## AI 摘要\n');
      console.log(aiSummary);
    }
  } catch (err) {
    console.warn(`AI analysis skipped: ${err.message}`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

export {
  buildDeterministicSummary,
  countPendingUnanswered,
};
