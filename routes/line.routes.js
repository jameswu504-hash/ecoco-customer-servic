const crypto = require('crypto');
const express = require('express');
const { maskSensitiveText } = require('../services/privacy.service');

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

function getLineConfig(env = process.env) {
  return {
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
  };
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyLineSignature({ body, signature, channelSecret }) {
  if (!body || !signature || !channelSecret) return false;
  const digest = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  return safeCompare(signature, digest);
}

async function replyToLine({ replyToken, text, channelAccessToken }) {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE Reply API failed: ${response.status} ${body}`);
  }
}

function buildLineSessionId(event = {}) {
  const userId = event.source?.userId || event.source?.groupId || event.source?.roomId || 'unknown';
  return `line_${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32)}`;
}

async function buildAiReply({
  client,
  text,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  defaultAnthropicModel,
}) {
  const rag = await retrieveKnowledgeForQuestion(text);
  const runtimeGuardrails = buildRuntimeGuardrails(text, rag);
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
    max_tokens: 1024,
    system: [{
      type: 'text',
      text: buildSystemPrompt(rag.context, runtimeGuardrails),
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: text }],
  });

  return response.content.find(block => block.type === 'text')?.text
    || '抱歉，AI 客服暫時無法回覆，請稍後再試或改由人工客服協助。';
}

function createLineRouter({
  pool,
  client,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  defaultAnthropicModel,
}) {
  const router = express.Router();

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
      if (event.type !== 'message' || event.message?.type !== 'text' || !event.replyToken) continue;

      const userText = String(event.message.text || '').trim();
      if (!userText) continue;

      let reply = '抱歉，AI 客服暫時無法回覆，請稍後再試或改由人工客服協助。';
      try {
        reply = await buildAiReply({
          client,
          text: userText,
          retrieveKnowledgeForQuestion,
          buildRuntimeGuardrails,
          buildSystemPrompt,
          defaultAnthropicModel,
        });
      } catch (err) {
        console.error('LINE AI reply error:', err.message);
      }

      try {
        await replyToLine({
          replyToken: event.replyToken,
          text: reply,
          channelAccessToken: config.channelAccessToken,
        });
      } catch (err) {
        console.error('LINE Reply API error:', err.message);
      }

      try {
        const ts = new Date().toISOString();
        const sessionId = buildLineSessionId(event);
        await pool.query(
          'INSERT INTO conversations (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)',
          [sessionId, 'user', maskSensitiveText(userText), ts]
        );
        await pool.query(
          'INSERT INTO conversations (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)',
          [sessionId, 'assistant', maskSensitiveText(reply), ts]
        );
      } catch (err) {
        console.error('LINE conversation write error:', err.message);
      }
    }
  });

  return router;
}

module.exports = {
  buildLineSessionId,
  createLineRouter,
  getLineConfig,
  verifyLineSignature,
};
