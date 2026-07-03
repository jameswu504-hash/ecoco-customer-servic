const express = require('express');
const {
  cleanWikiEntryInput,
  normalizeDepartment,
  normalizeSearchQuery,
  normalizeVisibility,
  rowToWikiEntry,
  validateWikiEntry,
} = require('../services/internal-wiki.service');

function createInternalRouter({ pool, requireStaffKey }) {
  const router = express.Router();

  router.use(requireStaffKey);

  router.get('/status', async (req, res) => {
    const [{ rows: entryCounts }, { rows: departmentCounts }] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM internal_wiki_entries WHERE archived_at IS NULL'),
      pool.query(
        `SELECT department, COUNT(*) AS count
         FROM internal_wiki_entries
         WHERE archived_at IS NULL
         GROUP BY department
         ORDER BY count DESC, department ASC`
      ),
    ]);

    res.json({
      mode: 'internal',
      activeEntries: Number(entryCounts[0].count || 0),
      departments: departmentCounts.map(row => ({
        department: row.department,
        count: Number(row.count || 0),
      })),
    });
  });

  router.get('/wiki', async (req, res) => {
    const includeArchived = String(req.query.include_archived || '').toLowerCase() === 'true';
    const department = normalizeDepartment(req.query.department);
    const params = [];
    const conditions = [];

    if (!includeArchived) conditions.push('archived_at IS NULL');
    if (req.query.department) {
      params.push(department);
      conditions.push(`department = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, department, visibility, title, content, tags, sort_order, updated_at, archived_at
       FROM internal_wiki_entries
       ${where}
       ORDER BY department ASC, sort_order ASC, id ASC`,
      params
    );
    res.json(rows.map(rowToWikiEntry));
  });

  router.get('/wiki/search', async (req, res) => {
    const q = normalizeSearchQuery(req.query.q);
    const department = normalizeDepartment(req.query.department);
    const visibility = normalizeVisibility(req.query.visibility);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 20);
    if (!q) return res.status(400).json({ error: 'Search query is required.' });

    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const params = [department, visibility, limit];
    const textConditions = [];
    for (const term of terms) {
      params.push(`%${term.replace(/[%_]/g, '')}%`);
      textConditions.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length} OR tags ILIKE $${params.length})`);
    }

    const { rows } = await pool.query(
      `SELECT id, department, visibility, title, content, tags, sort_order, updated_at, archived_at
       FROM internal_wiki_entries
       WHERE archived_at IS NULL
         AND (department = $1 OR department = 'general')
         AND visibility IN ('staff', $2)
         AND (${textConditions.join(' OR ')})
       ORDER BY
         CASE WHEN department = $1 THEN 0 ELSE 1 END,
         sort_order ASC,
         id ASC
       LIMIT $3`,
      params
    );

    res.json({
      query: q,
      department,
      visibility,
      results: rows.map(rowToWikiEntry),
    });
  });

  router.post('/wiki', async (req, res) => {
    const entry = cleanWikiEntryInput(req.body);
    const validationError = validateWikiEntry(entry);
    if (validationError) return res.status(400).json({ error: validationError });

    const { rows: sortRows } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM internal_wiki_entries WHERE department = $1',
      [entry.department]
    );
    const { rows } = await pool.query(
      `INSERT INTO internal_wiki_entries
       (department, visibility, title, content, tags, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [
        entry.department,
        entry.visibility,
        entry.title,
        entry.content,
        entry.tags,
        Number(sortRows[0].next || 0),
      ]
    );
    res.json({ success: true, id: rows[0].id });
  });

  router.put('/wiki/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    const entry = cleanWikiEntryInput(req.body);
    const validationError = validateWikiEntry(entry);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = await pool.query(
      `UPDATE internal_wiki_entries
       SET department = $1, visibility = $2, title = $3, content = $4, tags = $5, updated_at = NOW()
       WHERE id = $6 AND archived_at IS NULL`,
      [entry.department, entry.visibility, entry.title, entry.content, entry.tags, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Wiki entry not found.' });
    res.json({ success: true });
  });

  router.delete('/wiki/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    const result = await pool.query(
      'UPDATE internal_wiki_entries SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 AND archived_at IS NULL',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Wiki entry not found.' });
    res.json({ success: true });
  });

  router.patch('/wiki/:id/restore', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

    const result = await pool.query(
      'UPDATE internal_wiki_entries SET archived_at = NULL, updated_at = NOW() WHERE id = $1',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Wiki entry not found.' });
    res.json({ success: true });
  });

  return router;
}

module.exports = {
  createInternalRouter,
};
