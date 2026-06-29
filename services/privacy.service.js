function maskSensitiveText(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '[phone]')
    .replace(/(?:\+?886[-\s]?)?9\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '[phone]');
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
  getRetentionDays,
  maskSensitiveText,
  purgeExpiredConversationData,
};
