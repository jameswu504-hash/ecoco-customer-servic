function normalizeModelMessages(messages = []) {
  const normalized = [];
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    const content = String(message.content || '').trim();
    if (!content) continue;

    const previous = normalized[normalized.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      normalized.push({ role: message.role, content });
    }
  }
  return normalized;
}

async function loadServerConversationHistory(pool, sessionId, limit = 12) {
  const { rows } = await pool.query(
    `SELECT role, content
     FROM conversations
     WHERE session_id = $1
     ORDER BY timestamp DESC, id DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return normalizeModelMessages(rows.reverse());
}

async function loadExchangeByMessageId(pool, sessionId, messageId) {
  if (!pool || !sessionId || !messageId) return { question: '', reply: '' };

  const { rows } = await pool.query(
    `SELECT role, content
     FROM conversations
     WHERE session_id = $1
       AND message_id = $2
     ORDER BY timestamp ASC, id ASC
     LIMIT 2`,
    [sessionId, messageId]
  );

  let question = '';
  let reply = '';
  for (const row of rows) {
    if (!question && row.role === 'user') {
      question = String(row.content || '');
    } else if (!reply && row.role === 'assistant') {
      reply = String(row.content || '');
    }
  }

  return { question, reply };
}

module.exports = {
  loadExchangeByMessageId,
  loadServerConversationHistory,
  normalizeModelMessages,
};
