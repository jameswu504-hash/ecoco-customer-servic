const { compareSecret } = require('../services/secret.service');

function requireIotSyncKey(req, res, next) {
  const dedicatedKey = process.env.IOT_SYNC_KEY || '';
  const expected = dedicatedKey || process.env.ADMIN_KEY || '';
  const provided = dedicatedKey
    ? req.headers['x-iot-sync-key'] || ''
    : req.headers['x-iot-sync-key'] || req.headers['x-admin-key'] || '';

  if (!compareSecret(provided, expected)) {
    return res.status(401).json({ error: '未授權' });
  }

  next();
}

module.exports = { requireIotSyncKey };
