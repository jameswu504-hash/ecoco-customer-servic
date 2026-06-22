const crypto = require('crypto');

function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || '';
  const expected = process.env.ADMIN_KEY || '';
  if (!key || !expected) {
    return res.status(401).json({ error: '未授權' });
  }

  const len = Math.max(Buffer.byteLength(key), Buffer.byteLength(expected));
  const a = Buffer.alloc(len);
  const b = Buffer.alloc(len);
  Buffer.from(key).copy(a);
  Buffer.from(expected).copy(b);

  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: '未授權' });
  }
  next();
}

module.exports = { requireAdminKey };
