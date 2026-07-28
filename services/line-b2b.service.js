const { saveChatTrace } = require('./trace.service');
const {
  LINE_FALLBACK_REPLY,
  LINE_RATE_LIMIT_REPLY,
  getLineReplyTimeoutMs,
  getLineTimeoutReply,
  isLineRateLimited,
  resolveWithTimeout,
} = require('./line-shared.service');

function isLineBotMentioned(message = {}) {
  const mentionees = Array.isArray(message.mention?.mentionees)
    ? message.mention.mentionees
    : [];
  return mentionees.some(mentionee => (
    mentionee?.type === 'user' && mentionee.isSelf === true
  ));
}

function stripLineBotMentions(message = {}) {
  let text = String(message.text || '');
  const ranges = (Array.isArray(message.mention?.mentionees)
    ? message.mention.mentionees
    : [])
    .filter(mentionee => (
      mentionee?.type === 'user'
      && mentionee.isSelf === true
      && Number.isInteger(mentionee.index)
      && Number.isInteger(mentionee.length)
      && mentionee.index >= 0
      && mentionee.length > 0
    ))
    .sort((a, b) => b.index - a.index);

  for (const range of ranges) {
    text = `${text.slice(0, range.index)}${text.slice(range.index + range.length)}`;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function createLineB2BHandler({ pool, partnerService }) {
  return async function handleLineB2BMessage({
    event,
    isTextMessage,
    locationErrorReply,
    rateLimitKey,
    sessionId,
    userCoords,
    userText: initialUserText,
  }) {
    let userText = initialUserText;
    let partnerRoute = null;
    let processingError = null;

    try {
      partnerRoute = await partnerService.routeLineGroupMessage({
        groupId: event.source.groupId,
        text: userText,
      });
    } catch (err) {
      console.error('LINE B2B routing error:', err.message);
    }

    const isBindingMessage = partnerRoute?.type === 'binding';
    const shouldReply = isBindingMessage || isLineBotMentioned(event.message);
    if (!shouldReply) {
      if (partnerRoute?.type === 'partner') {
        try {
          await partnerService.storePartnerMessage({
            companyId: partnerRoute.company.id,
            lineGroupId: partnerRoute.lineGroupId,
            sessionId,
            role: 'user',
            content: userText,
          });
        } catch (err) {
          console.error('LINE B2B passive conversation write error:', err.message);
          processingError = err;
        }
      }
      return {
        processingError,
        reply: '',
        shouldReply: false,
        shouldStoreConversation: false,
        userText,
      };
    }

    if (partnerRoute?.type === 'partner' && isTextMessage) {
      userText = stripLineBotMentions(event.message) || '你好';
    }

    let reply = LINE_FALLBACK_REPLY;
    if (isLineRateLimited(rateLimitKey)) {
      reply = LINE_RATE_LIMIT_REPLY;
      await saveChatTrace(pool, {
        sessionId,
        channel: 'line',
        question: userText,
        rag: { retrievalMode: 'line_rate_limited', chunks: [] },
        latencyMs: 0,
        questionClassification: null,
      });
    } else if (locationErrorReply) {
      reply = locationErrorReply;
      await saveChatTrace(pool, {
        sessionId,
        channel: 'line_b2b',
        question: userText,
        rag: { retrievalMode: 'line_invalid_location', chunks: [] },
        latencyMs: 0,
        questionClassification: null,
      });
    } else {
      try {
        partnerRoute ||= await partnerService.routeLineGroupMessage({
          groupId: event.source.groupId,
          text: userText,
        });
        if (partnerRoute.type !== 'partner') {
          reply = partnerRoute.reply;
          await saveChatTrace(pool, {
            sessionId,
            channel: 'line_b2b',
            question: userText,
            rag: {
              retrievalMode: partnerRoute.type === 'binding'
                ? 'partner_binding'
                : 'partner_unbound',
              chunks: [],
            },
            latencyMs: 0,
          });
        } else {
          const timeoutMs = getLineReplyTimeoutMs();
          const timeoutReply = getLineTimeoutReply();
          const abortController = new AbortController();
          const partnerReplyPromise = partnerService.answerPartnerQuestion({
            company: partnerRoute.company,
            lineGroupId: partnerRoute.lineGroupId,
            sessionId,
            question: userText,
            channel: 'line_b2b',
            signal: abortController.signal,
            coords: userCoords,
          });
          const result = await resolveWithTimeout(
            partnerReplyPromise,
            timeoutMs,
            timeoutReply,
            () => abortController.abort()
          );
          reply = result.value?.reply || result.value || LINE_FALLBACK_REPLY;
          if (result.timedOut) {
            await saveChatTrace(pool, {
              sessionId,
              channel: 'line_b2b',
              question: userText,
              rag: { retrievalMode: 'partner_timeout', chunks: [] },
              latencyMs: timeoutMs,
              error: `LINE B2B reply timed out after ${timeoutMs}ms`,
            });
            partnerReplyPromise.catch(err => {
              console.warn('Late LINE B2B reply failed after timeout:', err.message);
            });
          }
        }
      } catch (err) {
        console.error('LINE B2B reply error:', err.message);
        reply = LINE_FALLBACK_REPLY;
        await saveChatTrace(pool, {
          sessionId,
          channel: 'line_b2b',
          question: userText,
          rag: { retrievalMode: 'partner_error', chunks: [] },
          error: err.message,
        });
      }
    }

    return {
      classification: null,
      processingError,
      reply,
      shouldReply: true,
      shouldStoreConversation: false,
      userText,
    };
  };
}

module.exports = {
  createLineB2BHandler,
  isLineBotMentioned,
  stripLineBotMentions,
};
