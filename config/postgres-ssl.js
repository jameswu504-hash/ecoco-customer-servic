function getPostgresSslConfig(env = process.env) {
  const mode = String(env.PGSSL || 'verify-full').trim().toLowerCase();
  if (mode === 'disable') return false;
  if (['verify-full', 'verify_ca', 'verify-ca'].includes(mode)) {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

function normalizePostgresConnectionString(connectionString) {
  const raw = String(connectionString || '').trim();
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'].forEach(key => {
      url.searchParams.delete(key);
    });
    return url.toString();
  } catch {
    return raw;
  }
}

function getPostgresPoolConfig(env = process.env) {
  return {
    connectionString: normalizePostgresConnectionString(env.DATABASE_URL),
    ssl: getPostgresSslConfig(env),
  };
}

module.exports = {
  getPostgresPoolConfig,
  getPostgresSslConfig,
  normalizePostgresConnectionString,
};
