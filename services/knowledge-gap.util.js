const KNOWLEDGE_GAP_MACHINE_MARKER = '[KNOWLEDGE_GAP]';
const KNOWLEDGE_GAP_META_PATTERN = /<meta>\s*({[\s\S]*?})\s*<\/meta>/i;
const KNOWLEDGE_GAP_META_STRIP_PATTERN = /<meta>\s*{[\s\S]*?}\s*<\/meta>/gi;
const KNOWLEDGE_GAP_META_INCOMPLETE_PATTERN = /<meta>(?![\s\S]*<\/meta>)[\s\S]*$/i;
const KNOWLEDGE_GAP_MARKERS = [
  '沒有確切資料',
  '目前沒有足夠資料',
  '建議您透過客服表單',
  '需要人工補充或確認',
];

function parseKnowledgeGapMeta(reply) {
  if (typeof reply !== 'string') return null;
  const match = reply.match(KNOWLEDGE_GAP_META_PATTERN);
  if (!match) return null;

  try {
    const meta = JSON.parse(match[1]);
    return {
      gap: Boolean(meta.gap),
      confidence: String(meta.confidence || '').trim().toLowerCase(),
      reason: String(meta.reason || '').trim(),
      raw: meta,
    };
  } catch (err) {
    return {
      gap: false,
      confidence: '',
      reason: `Invalid knowledge gap meta: ${err.message}`,
      raw: null,
    };
  }
}

function detectKnowledgeGap(reply, stopReason = '') {
  if (typeof reply !== 'string') {
    return { isGap: false, reason: '' };
  }

  if (String(stopReason || '') === 'max_tokens') {
    return {
      isGap: true,
      reason: 'AI reply truncated at max_tokens; gap meta may be missing, flagged for manual review.',
    };
  }

  const meta = parseKnowledgeGapMeta(reply);
  if (meta && meta.gap) {
    return {
      isGap: true,
      reason: `AI reply included structured knowledge gap meta: confidence=${meta.confidence || 'unknown'}${meta.reason ? `; ${meta.reason}` : ''}`,
      confidence: meta.confidence || 'unknown',
    };
  }

  if (reply.includes(KNOWLEDGE_GAP_MACHINE_MARKER)) {
    return {
      isGap: true,
      reason: `AI reply included knowledge gap marker: ${KNOWLEDGE_GAP_MACHINE_MARKER}`,
    };
  }

  const marker = KNOWLEDGE_GAP_MARKERS.find(text => reply.includes(text));
  if (!marker) {
    return { isGap: false, reason: '' };
  }

  return {
    isGap: true,
    reason: `AI 回覆包含知識缺口標記：「${marker}」`,
  };
}

function stripKnowledgeGapMarker(reply) {
  return String(reply || '')
    .replaceAll(KNOWLEDGE_GAP_MACHINE_MARKER, '')
    .replace(KNOWLEDGE_GAP_META_STRIP_PATTERN, '')
    .replace(KNOWLEDGE_GAP_META_INCOMPLETE_PATTERN, '')
    .trim();
}

module.exports = {
  detectKnowledgeGap,
  KNOWLEDGE_GAP_MACHINE_MARKER,
  KNOWLEDGE_GAP_MARKERS,
  parseKnowledgeGapMeta,
  stripKnowledgeGapMarker,
};
