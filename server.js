require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const { SCHEMA } = require('./db/schema');
const { requireAdminKey } = require('./middleware/admin-auth');
const { createChatRouter } = require('./routes/chat.routes');
const { createDashboardRouter } = require('./routes/dashboard.routes');
const { createKnowledgeRouter } = require('./routes/knowledge.routes');
const { createReportsRouter } = require('./routes/reports.routes');
const { createUnansweredRouter } = require('./routes/unanswered.routes');
const { createPromptService } = require('./services/prompt.service');
const { createRagService } = require('./services/rag.service');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const PORT = process.env.PORT || 3000;

const client = new Anthropic();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請稍後再試，每分鐘最多 10 次。' },
});

let knowledgeCache = '';

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

async function refreshKnowledgeCache() {
  const { rows } = await pool.query(
    "SELECT category, content FROM knowledge_sections WHERE COALESCE(archived_at, '') = '' ORDER BY sort_order ASC, id ASC"
  );
  knowledgeCache = rows.map(r => `## ${r.category}\n${r.content}`).join('\n\n');
  console.log('Knowledge cache refreshed:', knowledgeCache.length);
}

async function syncKnowledgeFromImportFile() {
  const mode = getKnowledgeAutoSyncMode();
  if (mode === 'disable') {
    console.log('Knowledge auto-sync skipped: KNOWLEDGE_AUTO_SYNC=disable');
    return;
  }

  const importPath = path.join(__dirname, 'data', 'ecoco-knowledge-import.json');
  if (!fs.existsSync(importPath)) {
    console.log('Knowledge auto-sync skipped: import file not found');
    return;
  }

  const payload = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  if (sections.length === 0) {
    console.log('Knowledge auto-sync skipped: no sections found');
    return;
  }

  if (mode === 'replace') {
    await pool.query('DELETE FROM knowledge_sections');
  }

  const now = new Date().toISOString();
  let sortOrder = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const section of sections) {
    const category = String(section.category || '').trim();
    const content = String(section.content || '').trim();
    if (!category || !content) continue;

    if (mode === 'replace') {
      await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
        [category, content, sortOrder++, now]
      );
      inserted++;
      continue;
    }

    const existing = await pool.query(
      'SELECT id FROM knowledge_sections WHERE category = $1 ORDER BY id ASC LIMIT 1',
      [category]
    );
    if (existing.rowCount > 0) {
      if (mode === 'upsert') {
        await pool.query(
          'UPDATE knowledge_sections SET content = $1, updated_at = $2 WHERE id = $3',
          [content, now, existing.rows[0].id]
        );
        updated++;
      } else {
        skipped++;
      }
    } else {
      const nextSort = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM knowledge_sections');
      await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
        [category, content, Number(nextSort.rows[0].next), now]
      );
      inserted++;
    }
  }

  console.log(`Knowledge auto-sync complete: mode=${mode} inserted=${inserted} updated=${updated} skipped=${skipped}`);
}

async function initDb(ragService) {
  for (const stmt of SCHEMA) {
    await pool.query(stmt);
  }
  await ragService.ensurePgVector();

  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM knowledge_sections');
  if (Number(rows[0].count) === 0) {
    const seed = require('./knowledge');
    const now = new Date().toISOString();
    let i = 0;
    for (const section of seed) {
      await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
        [section.category, section.content, i++, now]
      );
    }
    console.log(`Knowledge initialized from knowledge.js: ${seed.length} sections`);
  }
}

const responsePolicyPayload = readJsonFile(path.join('data', 'ecoco-response-policies.json')) || {};
const responsePolicies = Array.isArray(responsePolicyPayload.policies)
  ? responsePolicyPayload.policies
  : [];

const ragService = createRagService({ pool, env: process.env });
const promptService = createPromptService({
  responsePolicies,
  getKnowledgeCache: () => knowledgeCache,
});

app.use('/api', createChatRouter({
  pool,
  client,
  chatLimiter,
  requireAdminKey,
  retrieveKnowledgeForQuestion: ragService.retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails: ragService.buildRuntimeGuardrails,
  buildSystemPrompt: promptService.buildSystemPrompt,
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
  refreshKnowledgeCache,
  rebuildKnowledgeChunks: ragService.rebuildKnowledgeChunks,
  getKnowledgeCache: () => knowledgeCache,
  defaultAnthropicModel: DEFAULT_ANTHROPIC_MODEL,
}));

async function start() {
  try {
    await initDb(ragService);
    await syncKnowledgeFromImportFile();
    await refreshKnowledgeCache();
    await ragService.rebuildKnowledgeChunks();
    app.listen(PORT, () => {
      console.log(`ECOCO customer service server started: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err.message);
    console.error('Please check DATABASE_URL and Render environment variables.');
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  getKnowledgeAutoSyncMode,
  readJsonFile,
  start,
};
