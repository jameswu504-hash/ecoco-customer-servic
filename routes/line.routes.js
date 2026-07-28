const express = require('express');

const { stripKnowledgeGapMarker } = require('../services/knowledge-gap.util');
const {
  createLineB2BHandler,
  isLineBotAddressed,
  isLineBotMentioned,
  stripLineBotMentions,
} = require('../services/line-b2b.service');
const {
  buildAiReply,
  buildLineModelMessages,
  createLineB2CHandler,
  storeLineConversation,
} = require('../services/line-b2c.service');
const lineShared = require('../services/line-shared.service');

const {
  LINE_FALLBACK_REPLY,
  LINE_MAX_INPUT_CHARS,
  buildLineRateLimitKey,
  buildLineSessionId,
  claimLineWebhookEvent,
  completeLineWebhookEvent,
  getLineConfig,
  parseLineLocationMessage,
  replyToLine,
  verifyLineSignature,
} = lineShared;

function createLineRouter({
  pool,
  client,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
  classifyQuestion,
  retrieveLiveStationContext = null,
  partnerService = null,
}) {
  const router = express.Router();
  const handleLineB2BMessage = partnerService
    ? createLineB2BHandler({ pool, partnerService })
    : null;
  const handleLineB2CMessage = createLineB2CHandler({
    pool,
    client,
    retrieveKnowledgeForQuestion,
    buildRuntimeGuardrails,
    buildSystemPrompt,
    buildSystemPromptBlocks,
    defaultAnthropicModel,
    classifyQuestion,
    retrieveLiveStationContext,
  });

  router.post('/line/webhook', async (req, res) => {
    const config = getLineConfig();
    if (!config.channelSecret || !config.channelAccessToken) {
      return res.status(503).json({ error: 'LINE integration is not configured.' });
    }

    const isValid = verifyLineSignature({
      body: req.rawBody,
      signature: req.headers['x-line-signature'],
      channelSecret: config.channelSecret,
    });
    if (!isValid) return res.status(401).json({ error: 'Invalid LINE signature.' });

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    res.status(200).json({ ok: true });

    for (const event of events) {
      const isTextMessage = event.message?.type === 'text';
      const isLocationMessage = event.message?.type === 'location';
      if (event.type !== 'message' || (!isTextMessage && !isLocationMessage) || !event.replyToken) continue;

      // LINE 位置訊息的座標只在本次請求中使用；對話紀錄只保存文字 label。
      let userCoords = null;
      let userText = '';
      let locationErrorReply = '';
      if (isLocationMessage) {
        const locationInput = parseLineLocationMessage(event.message);
        userCoords = locationInput.coords;
        userText = locationInput.text;
        locationErrorReply = locationInput.errorReply;
      } else {
        userText = String(event.message.text || '').trim().slice(0, LINE_MAX_INPUT_CHARS);
      }
      if (!userText) continue;

      let webhookClaim;
      try {
        webhookClaim = await claimLineWebhookEvent(pool, event);
      } catch (err) {
        console.error('LINE webhook event claim error:', err.message);
        continue;
      }
      if (!webhookClaim.claimed) continue;

      const context = {
        event,
        isTextMessage,
        locationErrorReply,
        rateLimitKey: buildLineRateLimitKey(event),
        sessionId: buildLineSessionId(event),
        userCoords,
        userText,
      };
      const isPartnerGroup = event.source?.type === 'group' && handleLineB2BMessage;
      let outcome;
      try {
        outcome = isPartnerGroup
          ? await handleLineB2BMessage(context)
          : await handleLineB2CMessage(context);
      } catch (err) {
        console.error(`LINE ${isPartnerGroup ? 'B2B' : 'B2C'} handler error:`, err.message);
        outcome = {
          classification: null,
          processingError: err,
          reply: LINE_FALLBACK_REPLY,
          shouldReply: true,
          shouldStoreConversation: false,
          userText,
        };
      }

      let webhookProcessingError = outcome.processingError;
      if (!outcome.shouldReply) {
        try {
          await completeLineWebhookEvent(pool, webhookClaim.eventId, webhookProcessingError);
        } catch (err) {
          console.error('LINE webhook event completion error:', err.message);
        }
        continue;
      }

      try {
        await replyToLine({
          replyToken: event.replyToken,
          text: stripKnowledgeGapMarker(outcome.reply),
          channelAccessToken: config.channelAccessToken,
        });
      } catch (err) {
        console.error('LINE Reply API error:', err.message);
        webhookProcessingError = err;
      }

      if (outcome.shouldStoreConversation) {
        try {
          await storeLineConversation({
            pool,
            sessionId: context.sessionId,
            question: outcome.userText,
            reply: outcome.reply,
            classification: outcome.classification,
            messageId: webhookClaim.eventId,
          });
        } catch (err) {
          console.error('LINE B2C conversation write error:', err.message);
          webhookProcessingError ||= err;
        }
      }

      try {
        await completeLineWebhookEvent(pool, webhookClaim.eventId, webhookProcessingError);
      } catch (err) {
        console.error('LINE webhook event completion error:', err.message);
      }
    }
  });

  return router;
}

module.exports = {
  ...lineShared,
  buildAiReply,
  buildLineModelMessages,
  createLineB2BHandler,
  createLineB2CHandler,
  createLineRouter,
  isLineBotAddressed,
  isLineBotMentioned,
  storeLineConversation,
  stripLineBotMentions,
};
