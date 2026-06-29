const express = require('express');
const path = require('path');

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
      res.status(500).json({ error: '讀取知識庫總覽失敗' });
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
      res.status(500).json({ error: '讀取知識分類失敗' });
    }
  });

  router.get('/export', async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT category, content, sort_order, updated_at FROM knowledge_sections WHERE COALESCE(archived_at, '') = '' ORDER BY sort_order ASC, id ASC"
      );
      const totalChars = rows.reduce((sum, row) => sum + String(row.content || '').length, 0);
      const payload = {
        generated_at: new Date().toISOString(),
        source: 'PostgreSQL knowledge_sections export',
        notes: '這是從後台 PostgreSQL 匯出的知識庫資料。下載 JSON 不會自動寫回 GitHub；如需成為正式版本，請人工檢查後再更新 data/ecoco-knowledge-import.json 並 commit / push。',
        summary: {
          section_count: rows.length,
          content_chars: totalChars,
        },
        sections: rows.map(row => ({
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
      res.status(500).json({ error: '匯出知識庫失敗' });
    }
  });

  router.post('/sections', async (req, res) => {
    const { category, content } = req.body;
    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: '分類名稱不可空白' });
    }

    try {
      const { rows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM knowledge_sections');
      const sortOrder = Number(rows[0].next);
      const { rows: inserted } = await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [category.trim(), String(content || ''), sortOrder, new Date().toISOString()]
      );
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(inserted[0].id);
      res.json({ success: true, id: inserted[0].id });
    } catch (dbErr) {
      console.error('DB knowledge insert error:', dbErr.message);
      res.status(500).json({ error: '新增知識分類失敗' });
    }
  });

  router.put('/sections/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { category, content } = req.body;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 格式錯誤' });
    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: '分類名稱不可空白' });
    }

    try {
      const result = await pool.query(
        'UPDATE knowledge_sections SET category = $1, content = $2, updated_at = $3 WHERE id = $4',
        [category.trim(), String(content || ''), new Date().toISOString(), id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: '找不到這個知識分類' });
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(id);
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB knowledge update error:', dbErr.message);
      res.status(500).json({ error: '更新知識分類失敗' });
    }
  });

  router.delete('/sections/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 格式錯誤' });

    try {
      const result = await pool.query(
        "UPDATE knowledge_sections SET archived_at = $1, updated_at = $1 WHERE id = $2 AND COALESCE(archived_at, '') = ''",
        [new Date().toISOString(), id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: '找不到這個知識分類' });
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(id);
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB knowledge archive error:', dbErr.message);
      res.status(500).json({ error: '封存知識分類失敗' });
    }
  });

  router.patch('/sections/:id/restore', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 格式錯誤' });

    try {
      const result = await pool.query(
        "UPDATE knowledge_sections SET archived_at = '', updated_at = $1 WHERE id = $2",
        [new Date().toISOString(), id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: '找不到這個知識分類' });
      await refreshKnowledgeCache();
      await rebuildKnowledgeChunksForSection(id);
      res.json({ success: true });
    } catch (dbErr) {
      console.error('DB knowledge restore error:', dbErr.message);
      res.status(500).json({ error: '恢復知識分類失敗' });
    }
  });

  router.get('/', (req, res) => {
    res.json({ content: getKnowledgeCache() });
  });

  return router;
}

module.exports = { createKnowledgeRouter };
