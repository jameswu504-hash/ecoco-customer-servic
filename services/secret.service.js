const crypto = require('crypto');

function compareSecret(actual, expected) {
  const actualValue = String(actual || '');
  const expectedValue = String(expected || '');
  if (!actualValue || !expectedValue) return false;

  const actualHash = crypto.createHash('sha256').update(actualValue, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expectedValue, 'utf8').digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

module.exports = { compareSecret };
