const crypto = require('crypto');

function compareSecret(actual, expected) {
  const leftValue = String(actual || '');
  const rightValue = String(expected || '');
  if (!leftValue || !rightValue) return false;

  const len = Math.max(Buffer.byteLength(leftValue), Buffer.byteLength(rightValue));
  const left = Buffer.alloc(len);
  const right = Buffer.alloc(len);
  Buffer.from(leftValue).copy(left);
  Buffer.from(rightValue).copy(right);
  return crypto.timingSafeEqual(left, right);
}

function requireStaffKey(req, res, next) {
  const key = req.headers['x-staff-key'] || req.headers['x-admin-key'] || '';
  const expected = process.env.STAFF_KEY || '';
  if (!compareSecret(key, expected)) {
    return res.status(401).json({ error: 'Unauthorized staff access.' });
  }
  next();
}

module.exports = {
  compareSecret,
  requireStaffKey,
};
