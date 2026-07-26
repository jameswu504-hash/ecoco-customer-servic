require('dotenv').config();

const { Pool } = require('pg');
const { getPostgresPoolConfig } = require('../config/postgres-ssl');
const { createRagService } = require('../services/rag.service');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const pool = new Pool(getPostgresPoolConfig(process.env));
  try {
    const ragService = createRagService({ pool, env: process.env });
    await ragService.ensurePgVector();
    const result = await ragService.backfillMissingEmbeddings({
      limit: process.env.EMBEDDING_BACKFILL_LIMIT || 1000,
    });
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Embedding backfill failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
