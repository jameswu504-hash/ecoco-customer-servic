const { maskSensitiveText } = require('./privacy.service');

const MAX_TRACE_CHUNKS = 8;
const MAX_TRACE_TEXT = 500;
const MAX_ERROR_TEXT = 500;

function truncateText(value, max = MAX_TRACE_TEXT) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function summarizeRagChunks(rag = {}) {
  if (!Array.isArray(rag.chunks)) return [];
  return rag.chunks.slice(0, MAX_TRACE_CHUNKS).map(chunk => ({
    id: chunk.id ?? null,
    category: truncateText(chunk.category, 120),
    title: truncateText(chunk.title, 160),
    risk_level: chunk.risk_level || '',
    score: Number.isFinite(Number(chunk.score)) ? Number(chunk.score) : null,
    semantic_score: Number.isFinite(Number(chunk.semantic_score)) ? Number(chunk.semantic_score) : null,
  }));
}

function extractUsage(response = {}) {
  const usage = response.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || usage.inputTokens || 0),
    outputTokens: Number(usage.output_tokens || usage.outputTokens || 0),
    stopReason: String(response.stop_reason || response.stopReason || ''),
  };
}

async function saveChatTrace(pool, {
  sessionId = '',
  channel = 'web',
  question = '',
  rag = {},
  latencyMs = 0,
  response = null,
  error = '',
} = {}) {
  if (!pool) return;

  const usage = extractUsage(response || {});
  const safeQuestion = maskSensitiveText(truncateText(question));
  const safeError = truncateText(error, MAX_ERROR_TEXT);
  const chunks = summarizeRagChunks(rag);
  const retrievalMode = String(rag.retrievalMode || 'none');

  try {
    await pool.query(
      `INSERT INTO chat_traces
        (session_id, channel, question, retrieval_mode, retrieved_chunks, latency_ms, input_tokens, output_tokens, stop_reason, error, timestamp)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
      [
        String(sessionId || ''),
        String(channel || 'web'),
        safeQuestion,
        retrievalMode,
        JSON.stringify(chunks),
        Math.max(0, Math.round(Number(latencyMs) || 0)),
        usage.inputTokens,
        usage.outputTokens,
        usage.stopReason,
        safeError,
        new Date().toISOString(),
      ]
    );
  } catch (traceErr) {
    console.error('Chat trace write error:', traceErr.message);
  }
}

async function saveAdminAudit(pool, {
  actor = 'admin',
  action = '',
  targetType = '',
  targetId = '',
  details = {},
} = {}) {
  if (!pool || !action) return;

  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (actor, action, target_type, target_id, details, timestamp)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        truncateText(actor, 120) || 'admin',
        truncateText(action, 120),
        truncateText(targetType, 120),
        truncateText(targetId, 120),
        JSON.stringify(details || {}),
        new Date().toISOString(),
      ]
    );
  } catch (auditErr) {
    console.error('Admin audit write error:', auditErr.message);
  }
}

module.exports = {
  extractUsage,
  saveAdminAudit,
  saveChatTrace,
  summarizeRagChunks,
  truncateText,
};
