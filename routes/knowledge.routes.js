const express = require('express');
const path = require('path');
const { anonymizeText } = require('../scripts/anonymize-pii');

function cleanKnowledgeInput(value) {
  return anonymizeText(String(value || '').trim());
}

async function findDuplicateCategory(pool, category, ignoreId = null) {
  const params = [category];
  let sql = "SELECT id FROM knowledge_sections WHERE category = $1 AND COALESCE(archived_at, '') = ''";
  if (ignoreId !== null) {
    params.push(ignoreId);
    sql += ` AND id <> $${params.length}`;
  }
  sql += ' LIMIT 1';
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

async function lockCategoryForWrite(db, category) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [category]);
}

async function rollbackQuietly(db) {
  await db.query('ROLLBACK').catch(() => {});
}

function createKnowledgeRouter({
  pool,
  requireAdminKey,
  readJsonFile,
  getKnowledgeAutoSyncMode,
  refreshKnowledgeCache,
  rebuildKnowledgeChunksForSection,
  getKnowledgeCache,
  defaultAnthropicModel,
}) {
  const router = express.Router();

  router.use(requireAdminKey);

  router.get('/overview', async (req, res) => {
    try {
      const importPayload = readJsonFile(path.join('data', 'ecoco-knowledge-import.json')) || {};
      const databasePayload = readJsonFile(path.join('data', 'ecoco-ai-customer-service-database.json')) || {};

      const [{ rows: dbCounts }, { rows: latestRows }, { rows: chunkCounts }] = await Promise.all([
        pool.query("SELECT COUNT(*) AS section_count, COALESCE(SUM(LENGTH(content)), 0) AS content_chars FROM knowledge_sections WHERE COALESCE(archived_at, '') = ''"),
        pool.query("SELECT MAX(updated_at) AS latest_update FROM knowledge_sections WHERE COALESCE(archived_at, '') = ''"),
        pool.query('SELECT COUNT(*) AS chunk_count FROM knowledge_chunks'),
      ]);

      const summary = importPayload.summary || databasePayload.summary || {};
      const sourceDocuments = Array.isArray(databasePayload.source_documents)
        ? databasePayload.source_documents.map(source => ({
            source_name: source.source_name || '',
            source_type: source.source_type || '',
            role: source.role || '',
            recommended_ai_use: source.recommended_ai_use || '',
            caution: source.caution || '',
            records_used: source.records_used ?? '',
          }))
        : [];

      const sections = Array.isArray(importPayload.sections) ? importPayload.sections : [];

      res.json({
        generatedAt: importPayload.generated_at || databasePayload.generated_at || '',
        source: importPayload.source || databasePayload.source || '',
        notes: importPayload.notes || '',
        importSectionCount: sections.length,
        dbSectionCount: Number(dbCounts[0].section_count),
        ragChunkCount: Number(chunkCounts[0].chunk_count),
        dbContentChars: Number(dbCounts[0].content_chars),
        latestDbUpdate: latestRows[0].latest_update || '',
        autoSyncMode: process.env.KNOWLEDGE_AUTO_SYNC || 'disable',
        effectiveAutoSyncMode: getKnowledgeAutoSyncMode(),
        model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
        counts: summary.counts || {},
        topCategories: Array.isArray(summary.category_counts) ? summary.category_counts.slice(0, 10) : [],
        sourceDocuments,
      });
    } catch (err) {
      console.error('Knowledge overview error:', err.message);
      res.status(500).json({ error: 'Failed to load knowledge overview.' });
    }
  });

  router.get('/sections', async (req, res) => {
    try {
      const includeArchived = String(req.query.include_archived || '').toLowerCase() === 'true';
      const { rows } = await pool.query(
        `SELECT id, category, content, sort_order, updated_at, COALESCE(archived_at, '') AS archived_at
         FROM knowledge_sections
         ${includeArchived ? '' : "WHERE COALESCE(archived_at, '') = ''"}
         ORDER BY sort_order ASC, id ASC`
      );
      res.json(rows);
    } catch (dbErr) {
      console.error('DB knowledge sections query error:', dbErr.message);
      res.status(500).json({ error: 'Failed to load knowledge sections.' });
    }
  });

  router.get('/export', async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT category, content, sort_order, updated_at FROM knowledge_sections WHERE COALESCE(archived_at, '') = '' ORDER BY sort_order ASC, id ASC"
      );
      const safeRows = rows.map(row => ({
        ...row,
        category: cleanKnowledgeInput(row.category),
        content: cleanKnowledgeInput(row.content),
      }));
      const totalChars = safeRows.reduce((sum, row) => sum + String(row.content || '').length, 0);
      const payload = {
        generated_at: new Date().toISOString(),
        source: 'PostgreSQL knowledge_sections export',
        notes: 'Exported from PostgreSQL. Review manually before replacing data/ecoco-knowledge-import.json and committing to Git.',
        summary: {
          section_count: safeRows.length,
          content_chars: totalChars,
        },
        sections: safeRows.map(row => ({
          category: row.category,
          content: row.content,
          source: 'PostgreSQL knowledge_sections',
          visibility: 'public_knowledge_or_agent_assist',
          updated_at: row.updated_at,
        })),
      };
      const filename = `ecoco-knowledge-export-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(payload);
    } catch (dbErr) {
      console.error('DB knowledge export error:', dbErr.message);
      res.status(500).json({ error: 'Failed to export knowledge.' });
    }
  });

  router.post('/sections', async (req, res) => {
    const category = cleanKnowledgeInput(req.body.category);
    const content = cleanKnowledgeInput(req.body.content);
    if (!category) return res.status(400).json({ error: 'Category is required.' });

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockCategoryForWrite(db, category);

      const duplicate = await findDuplicateCategory(db, category);
      if (duplicate) {
        await db.query('ROLLBACK');
        return res.status(409).json({ error: 'Duplicate active knowledge category.' });
      }

      const { rows } = await db.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM knowledge_sections');
      const sortOrder = Number(rows[0].next);
      const { rows: inserted } = await db.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [category, content, sortOrder, new Date().toISOString()]
      );

      await db.query('COMMIT');
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(inserted[0].id);
      res.json({ success: true, id: inserted[0].id });
    } catch (dbErr) {
      await rollbackQuietly(db);
      console.error('DB knowledge insert error:', dbErr.message);
      res.status(500).json({ error: 'Failed to create knowledge section.' });
    } finally {
      db.release();
    }
  });

  router.put('/sections/:id', async (req, res) => {
    const id = Number(req.params.id);
    const category = cleanKnowledgeInput(req.body.category);
    const content = cleanKnowledgeInput(req.body.content);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
    if (!category) return res.status(400).json({ error: 'Category is required.' });

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockCategoryForWrite(db, category);

      const duplicate = await findDuplicateCategory(db, category, id);
      if (duplicate) {
        await db.query('ROLLBACK');
        return res.status(409).json({ error: 'Duplicate active knowledge category.' });
      }

      const result = await db.query(
        'UPDATE knowledge_sections SET category = $1, content = $2, updated_at = $3 WHERE id = $4',
        [category, content, new Date().toISOString(), id]
      );
      if (result.rowCount === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Knowledge section not found.' });
      }

      await db.query('COMMIT');
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(id);
      res.json({ success: true });
    } catch (dbErr) {
      await rollbackQuietly(db);
      console.error('DB knowledge update error:', dbErr.message);
      res.status(500).json({ error: 'Failed to update knowledge section.' });
    } finally {
      db.release();
    }
  });

  router.delete('/sections/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    try {
      const result = await pool.query(
        "UPDATE knowledge_sections SET archived_at = $1, updated_at = $1 WHERE id = $2 AND COALESCE(archived_at, '') = ''",
        [new Date().toISOString(), id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Knowledge section not found.' });
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(id);
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB knowledge archive error:', dbErr.message);
      res.status(500).json({ error: 'Failed to archive knowledge section.' });
    }
  });

  router.patch('/sections/:id/restore', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const section = await db.query('SELECT category FROM knowledge_sections WHERE id = $1', [id]);
      if (section.rowCount === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Knowledge section not found.' });
      }

      const category = section.rows[0].category;
      await lockCategoryForWrite(db, category);
      const duplicate = await findDuplicateCategory(db, category, id);
      if (duplicate) {
        await db.query('ROLLBACK');
        return res.status(409).json({ error: 'Duplicate active knowledge category.' });
      }

      const result = await db.query(
        "UPDATE knowledge_sections SET archived_at = '', updated_at = $1 WHERE id = $2",
        [new Date().toISOString(), id]
      );
      if (result.rowCount === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Knowledge section not found.' });
      }

      await db.query('COMMIT');
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(id);
      res.json({ success: true });
    } catch (dbErr) {
      await rollbackQuietly(db);
      console.error('DB knowledge restore error:', dbErr.message);
      res.status(500).json({ error: 'Failed to restore knowledge section.' });
    } finally {
      db.release();
    }
  });

  router.get('/', (req, res) => {
    res.json({ content: getKnowledgeCache() });
  });

  return router;
}

module.exports = {
  cleanKnowledgeInput,
  createKnowledgeRouter,
  findDuplicateCategory,
  lockCategoryForWrite,
};
