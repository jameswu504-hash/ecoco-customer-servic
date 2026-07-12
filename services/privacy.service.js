const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TW_MOBILE_PATTERN = /(?<!\d)(?:\+?886[-\s]?)?9\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)|(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/g;
const TW_ID_PATTERN = /(?<![A-Z0-9])[A-Z][12]\d{8}(?![A-Z0-9])/gi;
const LONG_NUMBER_PATTERN = /(?<![\d-])\d{8,}(?![\d-])/g;

function isLikelyPublicLongNumber(match, offset, input) {
  if (/^20\d{6}$/.test(match)) return true;

  const before = input.slice(Math.max(0, offset - 120), offset);
  if (/https?:\/\/\S*$/i.test(before)) return true;

  return false;
}

function countSensitiveLongNumbers(input) {
  const content = String(input || '');
  const matches = [...content.matchAll(LONG_NUMBER_PATTERN)];
  return matches.filter(match => !isLikelyPublicLongNumber(match[0], match.index || 0, content)).length;
}

function maskSensitiveText(value) {
  const content = String(value || '');
  return content
    .replace(EMAIL_PATTERN, '[email]')
    .replace(TW_MOBILE_PATTERN, '[phone]')
    .replace(TW_ID_PATTERN, '[tw-id]')
    .replace(LONG_NUMBER_PATTERN, (match, offset) => (
      isLikelyPublicLongNumber(match, offset, content) ? match : '[number]'
    ));
}

function getRetentionDays(env = process.env) {
  const days = Number(env.CONVERSATION_RETENTION_DAYS || 0);
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.floor(days);
}

async function purgeExpiredConversationData(pool, env = process.env) {
  const retentionDays = getRetentionDays(env);
  if (!retentionDays) {
    console.log('Conversation retention cleanup skipped: CONVERSATION_RETENTION_DAYS is not set');
    return { enabled: false, deletedConversations: 0, deletedRatings: 0, deletedGaps: 0 };
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const conversations = await db.query('DELETE FROM conversations WHERE timestamp < $1', [cutoff]);
    const ratings = await db.query('DELETE FROM ratings WHERE timestamp < $1', [cutoff]);
    const gaps = await db.query("DELETE FROM unanswered_questions WHERE timestamp < $1 AND COALESCE(status, 'pending') <> 'pending'", [cutoff]);
    await db.query('COMMIT');

    const result = {
      enabled: true,
      deletedConversations: conversations.rowCount,
      deletedRatings: ratings.rowCount,
      deletedGaps: gaps.rowCount,
    };
    console.log(`Conversation retention cleanup complete: days=${retentionDays} conversations=${result.deletedConversations} ratings=${result.deletedRatings} gaps=${result.deletedGaps}`);
    return result;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

module.exports = {
  EMAIL_PATTERN,
  LONG_NUMBER_PATTERN,
  TW_ID_PATTERN,
  TW_MOBILE_PATTERN,
  countSensitiveLongNumbers,
  getRetentionDays,
  isLikelyPublicLongNumber,
  maskSensitiveText,
  purgeExpiredConversationData,
};
