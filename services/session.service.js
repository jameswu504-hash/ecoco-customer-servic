const crypto = require('crypto');

const WEB_SESSION_COOKIE_NAME = 'ecoco_session';
const WEB_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const WEB_SESSION_CLOCK_SKEW_SECONDS = 5 * 60;
const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('base64url');
const SESSION_SECRET_CACHE = new WeakMap();

function getSessionSecret(env = process.env) {
  if (!env || typeof env !== 'object') {
    throw new Error('SESSION_SECRET environment is required.');
  }
  const cached = SESSION_SECRET_CACHE.get(env);
  if (cached) return cached;

  const secret = String(env.SESSION_SECRET || env.ADMIN_KEY || EPHEMERAL_SESSION_SECRET);
  SESSION_SECRET_CACHE.set(env, secret);
  return secret;
}

function signSessionPayload(payload, env = process.env) {
  return crypto
    .createHmac('sha256', getSessionSecret(env))
    .update(payload)
    .digest('base64url');
}

function createSignedSessionCookieValue(sessionId, env = process.env, nowMs = Date.now()) {
  const issuedAt = Math.floor(Number(nowMs) / 1000);
  const payload = `${sessionId}.${issuedAt}`;
  return `${payload}.${signSessionPayload(payload, env)}`;
}

function getCookieValue(headers = {}, name = WEB_SESSION_COOKIE_NAME) {
  const rawCookie = String(headers.cookie || '');
  for (const part of rawCookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function getClientSessionId(headers = {}, env = process.env, nowMs = Date.now()) {
  const token = getCookieValue(headers);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [sessionId, issuedAtText, signature] = parts;
  if (!/^session_[A-Za-z0-9_-]{8,80}$/.test(sessionId)) return null;
  if (!/^\d{10,}$/.test(issuedAtText)) return null;

  const issuedAt = Number(issuedAtText);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(nowSeconds)) return null;
  if (issuedAt > nowSeconds + WEB_SESSION_CLOCK_SKEW_SECONDS) return null;
  if (nowSeconds - issuedAt > WEB_SESSION_MAX_AGE_SECONDS) return null;

  const expected = signSessionPayload(`${sessionId}.${issuedAtText}`, env);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  return sessionId;
}

function getSafeSessionId(headers = {}, env = process.env) {
  return getClientSessionId(headers, env)
    || `session_${crypto.randomUUID().replaceAll('-', '')}`;
}

function setWebSessionCookie(res, sessionId, headers = {}, env = process.env) {
  const secure = env.NODE_ENV === 'production'
    || String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
  const parts = [
    `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(createSignedSessionCookieValue(sessionId, env))}`,
    'Path=/',
    `Max-Age=${WEB_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function resolveWebSession(req, res, env = process.env) {
  const existing = getClientSessionId(req.headers, env);
  if (existing) return existing;

  const sessionId = getSafeSessionId({}, env);
  setWebSessionCookie(res, sessionId, req.headers, env);
  return sessionId;
}

module.exports = {
  createSignedSessionCookieValue,
  getClientSessionId,
  getCookieValue,
  getSafeSessionId,
  getSessionSecret,
  resolveWebSession,
  setWebSessionCookie,
  signSessionPayload,
  WEB_SESSION_COOKIE_NAME,
  WEB_SESSION_MAX_AGE_SECONDS,
};
