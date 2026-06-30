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

function buildDeterministicSummary({ health, overview, operations, unanswered }) {
  const lines = [];
  lines.push('# ECOCO AI 客服週巡檢');
  lines.push('');
  lines.push(`- 服務狀態：${health.ok ? '正常' : '異常'}`);
  lines.push(`- DB 狀態：${health.database || 'unknown'}`);
  lines.push(`- 模型：${health.model || 'unknown'}`);
  lines.push(`- 語意 RAG：${health.semanticRag ? 'enabled' : 'disabled'}`);
  lines.push(`- 知識同步：${health.knowledgeAutoSync || 'unknown'}`);
  lines.push(`- PostgreSQL 分類：${overview.postgres_sections ?? 0}`);
  lines.push(`- RAG chunks：${overview.rag_chunks ?? 0}`);
  lines.push(`- 待確認衝突：${overview.conflicts_pending_review ?? 0}`);
  lines.push(`- 本期客服案件：${operations.summary?.ticket_count ?? 0}`);
  lines.push(`- 本期 AI 回覆：${operations.summary?.ai_replies ?? 0}`);
  lines.push(`- 知識缺口：${operations.summary?.knowledge_gaps ?? 0}`);
  lines.push(`- 未處理知識缺口：${unanswered.length ?? 0}`);
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
          content: `請用繁體中文整理以下 ECOCO AI 客服週巡檢資料，輸出 3 點風險與 3 點下週建議。不要編造數字。\n\n${summary}`,
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

  const [health, overview, operations, unanswered] = await Promise.all([
    fetchJson(baseUrl, '/healthz'),
    fetchJson(baseUrl, '/api/knowledge/overview', adminKey),
    fetchJson(baseUrl, '/api/reports/operations?period=week', adminKey),
    fetchJson(baseUrl, '/api/unanswered', adminKey),
  ]);

  const summary = buildDeterministicSummary({ health, overview, operations, unanswered });
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
