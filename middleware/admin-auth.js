const { compareSecret } = require('../services/secret.service');

function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || '';
  const expected = process.env.ADMIN_KEY || '';
  if (!compareSecret(key, expected)) {
    return res.status(401).json({ error: '未授權' });
  }
  next();
}

module.exports = { requireAdminKey };
