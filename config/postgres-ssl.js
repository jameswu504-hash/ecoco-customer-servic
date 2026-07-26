function getPostgresSslConfig(env = process.env) {
  const mode = String(env.PGSSL || 'verify-full').trim().toLowerCase();
  if (mode === 'disable') return false;
  if (['verify-full', 'verify_ca', 'verify-ca'].includes(mode)) {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

module.exports = {
  getPostgresSslConfig,
};
