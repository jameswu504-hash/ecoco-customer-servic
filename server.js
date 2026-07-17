require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const { SCHEMA, migrateTimestampColumns } = require('./db/schema');
const { requireAdminKey } = require('./middleware/admin-auth');
const { requireStaffKey } = require('./middleware/staff-auth');
const { createChatRouter } = require('./routes/chat.routes');
const { createDashboardRouter } = require('./routes/dashboard.routes');
const { createInternalRouter } = require('./routes/internal.routes');
const { createKnowledgeRouter } = require('./routes/knowledge.routes');
const { createLineRouter } = require('./routes/line.routes');
const { createReportsRouter } = require('./routes/reports.routes');
const { createUnansweredRouter } = require('./routes/unanswered.routes');
const { isInternalMode } = require('./services/internal-wiki.service');
const { createPromptService } = require('./services/prompt.service');
const { createRagService } = require('./services/rag.service');
const { purgeExpiredConversationData } = require('./services/privacy.service');
const { anonymizeText } = require('./scripts/anonymize-pii');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'none'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use((req, res, next) => {
  if (['/dashboard.html', '/dashboard.css', '/dashboard.js'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const PORT = process.env.PORT || 3000;
const startedAt = new Date().toISOString();
let startupWarnings = [];
let httpServer = null;

const client = new Anthropic();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});
pool.on('error', err => {
  console.error('PG pool error:', err.message);
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請稍後再試，每分鐘最多 10 次。' },
});

const ratingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many ratings. Please try again later.' },
});

function readJsonFile(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getKnowledgeAutoSyncMode() {
  const rawMode = String(process.env.KNOWLEDGE_AUTO_SYNC || 'disable').trim().toLowerCase();
  if (rawMode === 'disable') return 'disable';
  if (rawMode === 'replace') return 'replace';
  if (rawMode === 'upsert') return 'upsert';
  if (rawMode === 'insert_only') return 'insert_only';
  return 'disable';
}

function validateRuntimeConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'ADMIN_KEY'];

  for (const key of required) {
    if (!env[key]) errors.push(`${key} is required`);
  }

  if (env.ADMIN_KEY && env.ADMIN_KEY.length < 16) {
    warnings.push('ADMIN_KEY is short; use a long random value for production.');
  }

  if (!env.CONVERSATION_RETENTION_DAYS || Number(env.CONVERSATION_RETENTION_DAYS) <= 0) {
    warnings.push('CONVERSATION_RETENTION_DAYS is not set; raw conversation logs will be retained.');
  }

  if (!env.OPENAI_API_KEY) {
    warnings.push('OPENAI_API_KEY is not set; semantic RAG will fall back to keyword search.');
  }

  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    warnings.push('LINE webhook is not configured; set LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN before LINE@ testing.');
  }

  if (isInternalMode(env) && !env.STAFF_KEY) {
    errors.push('STAFF_KEY is required when APP_MODE=internal');
  }

  if (['replace', 'upsert'].includes(getKnowledgeAutoSyncMode())) {
    warnings.push(`KNOWLEDGE_AUTO_SYNC=${getKnowledgeAutoSyncMode()} can overwrite dashboard knowledge edits on startup.`);
  }

  return { errors, warnings };
}

function normalizeImportSections(rawSections) {
  const byCategory = new Map();
  for (const section of rawSections) {
    const category = anonymizeText(String(section.category || '').trim());
    const content = anonymizeText(String(section.content || '').trim());
    if (!category || !content) continue;
    if (!byCategory.has(category)) {
      byCategory.set(category, { category, content });
    }
  }
  return [...byCategory.values()];
}

async function syncKnowledgeFromImportFile() {
  const mode = getKnowledgeAutoSyncMode();
  if (mode === 'disable') {
    console.log('Knowledge auto-sync skipped: KNOWLEDGE_AUTO_SYNC=disable');
    return false;
  }

  const importPath = path.join(__dirname, 'data', 'ecoco-knowledge-import.json');
  if (!fs.existsSync(importPath)) {
    console.log('Knowledge auto-sync skipped: import file not found');
    return false;
  }

  const payload = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  const sections = normalizeImportSections(Array.isArray(payload.sections) ? payload.sections : []);
  if (sections.length === 0) {
    console.log('Knowledge auto-sync skipped: no sections found');
    return false;
  }

  const now = new Date().toISOString();
  let sortOrder = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (mode === 'replace') {
      await db.query('DELETE FROM knowledge_chunks');
      await db.query('DELETE FROM knowledge_sections');
    }

    for (const section of sections) {
      if (mode === 'replace') {
        await db.query(
          'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
          [section.category, section.content, sortOrder++, now]
        );
        inserted++;
        continue;
      }

      const existing = await db.query(
        "SELECT id, content FROM knowledge_sections WHERE category = $1 AND COALESCE(archived_at, '') = '' ORDER BY id ASC LIMIT 1",
        [section.category]
      );
      if (existing.rowCount > 0) {
        if (mode === 'upsert') {
          if (existing.rows[0].content !== section.content) {
            await db.query(
              'UPDATE knowledge_sections SET content = $1, updated_at = $2 WHERE id = $3',
              [section.content, now, existing.rows[0].id]
            );
            updated++;
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
      } else {
        const nextSort = await db.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM knowledge_sections');
        await db.query(
          'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
          [section.category, section.content, Number(nextSort.rows[0].next), now]
        );
        inserted++;
      }
    }

    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }

  console.log(`Knowledge auto-sync complete: mode=${mode} inserted=${inserted} updated=${updated} skipped=${skipped}`);
  return inserted > 0 || updated > 0 || mode === 'replace';
}

function loadInitialKnowledgeSections() {
  const importPayload = readJsonFile(path.join('data', 'ecoco-knowledge-import.json'));
  const importSections = normalizeImportSections(Array.isArray(importPayload?.sections) ? importPayload.sections : []);
  if (importSections.length > 0) {
    return { source: 'data/ecoco-knowledge-import.json', sections: importSections };
  }

  const seed = require('./knowledge');
  return {
    source: 'knowledge.js',
    sections: normalizeImportSections(Array.isArray(seed) ? seed : []),
  };
}

async function initDb(ragService) {
  for (const stmt of SCHEMA) {
    await pool.query(stmt);
  }
  await migrateTimestampColumns(pool);
  await ragService.ensurePgVector();

  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM knowledge_sections');
  if (Number(rows[0].count) === 0) {
    const { source, sections } = loadInitialKnowledgeSections();
    const now = new Date().toISOString();
    let i = 0;
    for (const section of sections) {
      await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
        [section.category, section.content, i++, now]
      );
    }
    console.log(`Knowledge initialized from ${source}: ${sections.length} sections`);
  }
}

async function ensureKnowledgeChunksReady(syncChanged = false) {
  const forceMode = String(process.env.REBUILD_KNOWLEDGE_CHUNKS_ON_START || '').toLowerCase();
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM knowledge_chunks');
  const chunkCount = Number(rows[0].count || 0);

  if (forceMode === 'always') {
    console.log('Knowledge chunks rebuild requested: REBUILD_KNOWLEDGE_CHUNKS_ON_START=always');
    await ragService.rebuildKnowledgeChunks();
    return;
  }

  if (syncChanged || chunkCount === 0) {
    console.log(`Knowledge chunks rebuild needed: syncChanged=${syncChanged} chunkCount=${chunkCount}`);
    await ragService.rebuildKnowledgeChunks();
    return;
  }

  console.log(`Knowledge chunks rebuild skipped: existing chunks=${chunkCount}`);
}

const responsePolicyPayload = readJsonFile(path.join('data', 'ecoco-response-policies.json')) || {};
const responsePolicies = Array.isArray(responsePolicyPayload.policies)
  ? responsePolicyPayload.policies
  : [];

const ragService = createRagService({ pool, env: process.env });
const promptService = createPromptService({
  responsePolicies,
});

async function buildHealthStatus({ includeDetails = false } = {}) {
  const health = {
    status: 'ok',
    service: 'ecoco-customer-service',
    checkedAt: new Date().toISOString(),
    database: 'unknown',
  };

  if (includeDetails) {
    health.startedAt = startedAt;
    health.knowledgeAutoSyncMode = getKnowledgeAutoSyncMode();
    health.semanticRagEnabled = ragService.shouldUseSemanticSearch();
    health.embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    health.anthropicModel = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    health.appMode = isInternalMode() ? 'internal' : 'customer';
    health.startupWarnings = startupWarnings;
  }

  try {
    await pool.query('SELECT 1');
    health.database = 'ok';
    if (includeDetails) {
      const { rows } = await pool.query(
        "SELECT COUNT(*) AS section_count, COALESCE(SUM(LENGTH(content)), 0) AS content_chars FROM knowledge_sections WHERE COALESCE(archived_at, '') = ''"
      );
      health.knowledgeSectionCount = Number(rows[0].section_count);
      health.knowledgeContentChars = Number(rows[0].content_chars);
    }
  } catch (err) {
    health.status = 'degraded';
    health.database = 'error';
    if (includeDetails) health.databaseError = err.message;
  }

  return health;
}

app.get('/healthz', async (req, res) => {
  const health = await buildHealthStatus();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.get('/api/system/status', requireAdminKey, async (req, res) => {
  const health = await buildHealthStatus({ includeDetails: true });
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.use('/api', createChatRouter({
  pool,
  client,
  chatLimiter,
  ratingLimiter,
  requireAdminKey,
  retrieveKnowledgeForQuestion: ragService.retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails: ragService.buildRuntimeGuardrails,
  buildSystemPrompt: promptService.buildSystemPrompt,
  buildSystemPromptBlocks: promptService.buildSystemPromptBlocks,
  defaultAnthropicModel: DEFAULT_ANTHROPIC_MODEL,
}));
app.use('/api', createLineRouter({
  pool,
  client,
  retrieveKnowledgeForQuestion: ragService.retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails: ragService.buildRuntimeGuardrails,
  buildSystemPrompt: promptService.buildSystemPrompt,
  buildSystemPromptBlocks: promptService.buildSystemPromptBlocks,
  defaultAnthropicModel: DEFAULT_ANTHROPIC_MODEL,
}));
app.use('/api', createDashboardRouter({ pool, requireAdminKey }));
app.use('/api/reports', createReportsRouter({ pool, requireAdminKey, readJsonFile }));
app.use('/api/unanswered', createUnansweredRouter({ pool, requireAdminKey }));
app.use('/api/knowledge', createKnowledgeRouter({
  pool,
  requireAdminKey,
  readJsonFile,
  getKnowledgeAutoSyncMode,
  rebuildKnowledgeChunksForSection: ragService.rebuildKnowledgeChunksForSection,
  defaultAnthropicModel: DEFAULT_ANTHROPIC_MODEL,
}));
if (isInternalMode()) {
  app.use('/api/internal', createInternalRouter({ pool, requireStaffKey }));
}

async function start() {
  try {
    const config = validateRuntimeConfig(process.env);
    startupWarnings = config.warnings;
    startupWarnings.forEach(warning => console.warn(`Startup warning: ${warning}`));
    if (config.errors.length > 0) {
      throw new Error(`Invalid runtime config: ${config.errors.join('; ')}`);
    }

    await initDb(ragService);
    const syncChanged = await syncKnowledgeFromImportFile();
    await ensureKnowledgeChunksReady(syncChanged);
    await purgeExpiredConversationData(pool, process.env);
    httpServer = app.listen(PORT, () => {
      console.log(`ECOCO customer service server started: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err.message);
    console.error('Please check DATABASE_URL and Render environment variables.');
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully.`);
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await pool.end();
  process.exit(0);
}

if (require.main === module) {
  process.on('unhandledRejection', err => {
    console.error('Unhandled rejection:', err);
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(err => {
      console.error('Graceful shutdown failed:', err.message);
      process.exit(1);
    });
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch(err => {
      console.error('Graceful shutdown failed:', err.message);
      process.exit(1);
    });
  });
  start();
}

module.exports = {
  app,
  getKnowledgeAutoSyncMode,
  loadInitialKnowledgeSections,
  normalizeImportSections,
  readJsonFile,
  start,
  syncKnowledgeFromImportFile,
  buildHealthStatus,
  shutdown,
  validateRuntimeConfig,
  isInternalMode,
};
