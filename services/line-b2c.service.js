const {
  loadServerConversationHistory,
  normalizeModelMessages,
} = require('./conversation-history.service');
const {
  detectKnowledgeGap,
  KNOWLEDGE_GAP_MACHINE_MARKER,
  stripKnowledgeGapMarker,
} = require('./knowledge-gap.util');
const {
  LINE_FALLBACK_REPLY,
  LINE_MAX_INPUT_CHARS,
  LINE_RATE_LIMIT_REPLY,
  getLineReplyTimeoutMs,
  getLineTimeoutReply,
  isLineRateLimited,
  resolveWithTimeout,
} = require('./line-shared.service');
const { maskSensitiveText } = require('./privacy.service');
const {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  shouldUseDeterministicStationReply,
} = require('./station-response.service');
const { saveChatTrace } = require('./trace.service');

async function buildLineModelMessages({ pool, sessionId, text }) {
  const userMessage = {
    role: 'user',
    content: String(text || '').trim().slice(0, LINE_MAX_INPUT_CHARS),
  };

  if (!pool || !sessionId) return [userMessage];

  try {
    const storedHistory = await loadServerConversationHistory(pool, sessionId);
    return normalizeModelMessages([...storedHistory, userMessage]);
  } catch (err) {
    console.error('LINE conversation history read error:', err.message);
    return [userMessage];
  }
}

async function buildAiReply({
  pool,
  sessionId,
  client,
  text,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
  signal = undefined,
  classification = null,
  retrieveLiveStationContext = null,
  coords = null,
}) {
  const question = String(text || '').trim().slice(0, LINE_MAX_INPUT_CHARS);
  const traceStart = Date.now();
  let rag = await retrieveKnowledgeForQuestion(question, {
    classification,
    ragScope: classification?.ragScope || [],
  });
  rag = await attachLiveStationContext({
    rag,
    question,
    classification,
    retrieveLiveStationContext,
    coords,
  });
  const stationStatusReply = shouldUseDeterministicStationReply(question, classification, rag.liveStationContext)
    ? buildLiveStationStatusReply(rag.liveStationContext)
    : '';
  if (stationStatusReply) {
    await saveChatTrace(pool, {
      sessionId,
      channel: 'line',
      question,
      rag,
      latencyMs: Date.now() - traceStart,
      questionClassification: classification,
    });
    return stationStatusReply;
  }
  const runtimeGuardrails = buildRuntimeGuardrails(question, rag);
  const modelMessages = await buildLineModelMessages({ pool, sessionId, text: question });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
    max_tokens: 1024,
    system: buildSystemPromptBlocks
      ? buildSystemPromptBlocks(rag.context, runtimeGuardrails)
      : [{ type: 'text', text: buildSystemPrompt(rag.context, runtimeGuardrails) }],
    messages: modelMessages,
  }, signal ? { signal } : undefined);

  if (response.stop_reason === 'max_tokens') {
    console.warn(`LINE Claude reply reached max_tokens: session=${sessionId}`);
  }

  await saveChatTrace(pool, {
    sessionId,
    channel: 'line',
    question,
    rag,
    latencyMs: Date.now() - traceStart,
    response,
    questionClassification: classification,
  });

  const replyText = response.content.find(block => block.type === 'text')?.text || LINE_FALLBACK_REPLY;
  if (response.stop_reason === 'max_tokens') {
    return `${replyText}\n${KNOWLEDGE_GAP_MACHINE_MARKER}`;
  }
  return replyText;
}

async function storeLineConversation({
  pool,
  sessionId,
  question,
  reply,
  classification = null,
  messageId = '',
}) {
  const ts = new Date().toISOString();
  const gap = detectKnowledgeGap(reply);
  const storedQuestion = maskSensitiveText(question);
  const storedReply = maskSensitiveText(stripKnowledgeGapMarker(reply));

  await pool.query(
    `INSERT INTO conversations (session_id, role, content, timestamp, message_id)
     VALUES ($1, $2, $3, $4, $7), ($1, $5, $6, $4, $7)
     ON CONFLICT (session_id, role, message_id) WHERE message_id <> '' DO NOTHING`,
    [sessionId, 'user', storedQuestion, ts, 'assistant', storedReply, messageId]
  );

  if (gap.isGap || classification?.shouldEscalate) {
    const reason = gap.isGap
      ? gap.reason
      : `Question classified as ${classification.category}: ${classification.reason || 'requires manual handling'}`;
    await pool.query(
      'INSERT INTO unanswered_questions (session_id, question, reply, reason, timestamp) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, storedQuestion, storedReply, reason, ts]
    );
  }
}

function createLineB2CHandler({
  pool,
  client,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
  classifyQuestion,
  retrieveLiveStationContext = null,
}) {
  return async function handleLineB2CMessage({
    locationErrorReply,
    rateLimitKey,
    sessionId,
    userCoords,
    userText,
  }) {
    const classification = typeof classifyQuestion === 'function'
      ? classifyQuestion(userText)
      : null;
    let reply = LINE_FALLBACK_REPLY;
    let shouldStoreConversation = true;

    if (isLineRateLimited(rateLimitKey)) {
      reply = LINE_RATE_LIMIT_REPLY;
      shouldStoreConversation = false;
      await saveChatTrace(pool, {
        sessionId,
        channel: 'line',
        question: userText,
        rag: { retrievalMode: 'line_rate_limited', chunks: [] },
        latencyMs: 0,
        questionClassification: classification,
      });
    } else if (locationErrorReply) {
      reply = locationErrorReply;
      shouldStoreConversation = false;
      await saveChatTrace(pool, {
        sessionId,
        channel: 'line',
        question: userText,
        rag: { retrievalMode: 'line_invalid_location', chunks: [] },
        latencyMs: 0,
        questionClassification: classification,
      });
    } else if (classification?.directReply && classification.shouldUseRag === false) {
      reply = classification.directReply;
      await saveChatTrace(pool, {
        sessionId,
        channel: 'line',
        question: userText,
        rag: { retrievalMode: 'none', chunks: [] },
        latencyMs: 0,
        questionClassification: classification,
      });
    } else {
      const timeoutMs = getLineReplyTimeoutMs();
      const timeoutReply = getLineTimeoutReply();
      const abortController = new AbortController();
      const aiReplyPromise = buildAiReply({
        pool,
        sessionId,
        client,
        text: userText,
        retrieveKnowledgeForQuestion,
        buildRuntimeGuardrails,
        buildSystemPrompt,
        buildSystemPromptBlocks,
        defaultAnthropicModel,
        signal: abortController.signal,
        classification,
        retrieveLiveStationContext,
        coords: userCoords,
      });

      try {
        const result = await resolveWithTimeout(
          aiReplyPromise,
          timeoutMs,
          timeoutReply,
          () => abortController.abort()
        );
        reply = result.value;
        if (result.timedOut) {
          console.warn(`LINE AI reply timed out after ${timeoutMs}ms: session=${sessionId}`);
          shouldStoreConversation = false;
          await saveChatTrace(pool, {
            sessionId,
            channel: 'line',
            question: userText,
            rag: { retrievalMode: 'line_timeout', chunks: [] },
            latencyMs: timeoutMs,
            error: `LINE AI reply timed out after ${timeoutMs}ms`,
            questionClassification: classification,
          });
          aiReplyPromise.catch(err => {
            console.warn('Late LINE AI reply failed after timeout:', err.message);
          });
        }
      } catch (err) {
        console.error('LINE AI reply error:', err.message);
        await saveChatTrace(pool, {
          sessionId,
          channel: 'line',
          question: userText,
          rag: { retrievalMode: 'none', chunks: [] },
          error: err.message,
          questionClassification: classification,
        });
      }
    }

    return {
      classification,
      processingError: null,
      reply,
      shouldReply: true,
      shouldStoreConversation,
      userText,
    };
  };
}

module.exports = {
  buildAiReply,
  buildLineModelMessages,
  createLineB2CHandler,
  storeLineConversation,
};
