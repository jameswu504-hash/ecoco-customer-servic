const { compareSecret } = require('../services/secret.service');

function requireStaffKey(req, res, next) {
  const key = req.headers['x-staff-key'] || '';
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
