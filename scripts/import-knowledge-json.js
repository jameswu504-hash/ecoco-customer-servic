require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const inputPath = process.argv[2] || path.join(__dirname, '..', 'data', 'ecoco-knowledge-import.json');
const shouldReplace = process.argv.includes('--replace');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Please set it in .env before importing knowledge.');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Knowledge import file not found: ${inputPath}`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sections = Array.isArray(payload.sections) ? payload.sections : [];

if (sections.length === 0) {
  console.error('No sections found. Expected JSON shape: { "sections": [{ "category": "...", "content": "..." }] }');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

async function ensureKnowledgeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_sections (
      id         SERIAL PRIMARY KEY,
      category   TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ks_sort ON knowledge_sections(sort_order, id)');
}

async function importSections() {
  await ensureKnowledgeTable();

  if (shouldReplace) {
    await pool.query('DELETE FROM knowledge_sections');
  }

  let inserted = 0;
  let updated = 0;
  let sortOrder = 0;
  const now = new Date().toISOString();

  for (const section of sections) {
    const category = String(section.category || '').trim();
    const content = String(section.content || '').trim();

    if (!category || !content) {
      continue;
    }

    if (shouldReplace) {
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
      await pool.query(
        'UPDATE knowledge_sections SET content = $1, updated_at = $2 WHERE id = $3',
        [content, now, existing.rows[0].id]
      );
      updated++;
    } else {
      const nextSort = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM knowledge_sections');
      await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
        [category, content, Number(nextSort.rows[0].next), now]
      );
      inserted++;
    }
  }

  console.log(`Knowledge import complete. inserted=${inserted} updated=${updated} replace=${shouldReplace}`);
}

importSections()
  .catch(err => {
    console.error('Knowledge import failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

