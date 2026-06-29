const {
  MAX_RAG_CHUNKS,
  MAX_CHUNK_CHARS,
  CHUNK_OVERLAP_CHARS,
  RAG_KEYWORDS,
  RAG_SYNONYM_GROUPS,
} = require('../config/rag-config');

function normalizeRiskLevel(value) {
  const risk = String(value || '').trim().toLowerCase();
  if (risk === 'high') return 'High';
  if (risk === 'medium') return 'Medium';
  return 'Low';
}

function extractRiskLevel(text) {
  const value = String(text || '');
  const match = value.match(/(?:風險|risk(?:_level)?)[\s:：-]*(High|Medium|Low)/i);
  return normalizeRiskLevel(match ? match[1] : 'Low');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKnowledgeContent(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:^|\n)\s*(?:ECOCO\s*)?(?:客服團隊|ECOCO Team)\s*$/gim, '')
    .trim();
}

function splitLongText(text, maxChars = MAX_CHUNK_CHARS) {
  const normalized = normalizeKnowledgeContent(text);
  if (normalized.length <= maxChars) return [normalized].filter(Boolean);

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks.filter(Boolean);
}

function buildSearchTerms(question) {
  const text = normalizeText(question);
  const terms = new Set();

  for (const keyword of RAG_KEYWORDS) {
    const normalizedKeyword = normalizeText(keyword);
    if ([...normalizedKeyword].length >= 2 && text.includes(normalizedKeyword)) {
      terms.add(normalizedKeyword);
    }
  }

  const lowerText = text.toLowerCase();
  for (const group of RAG_SYNONYM_GROUPS) {
    if (group.some(term => lowerText.includes(String(term).toLowerCase()))) {
      group.forEach(term => {
        const normalizedTerm = normalizeText(term);
        if ([...normalizedTerm].length >= 2) terms.add(normalizedTerm);
      });
    }
  }

  text
    .split(/[^0-9A-Za-z\u4e00-\u9fff]+/g)
    .map(term => term.trim())
    .filter(term => term.length >= 2 && term.length <= 24)
    .forEach(term => terms.add(term));

  return [...terms].slice(0, 12);
}

function scoreChunk(chunk, terms) {
  const category = String(chunk.category || '');
  const title = String(chunk.title || '');
  const content = String(chunk.content || '');
  let score = 0;
  for (const term of terms) {
    if (category.includes(term)) score += 8;
    if (title.includes(term)) score += 6;
    if (content.includes(term)) score += 2;
  }
  return score;
}

function rankKnowledgeRows(rows, terms) {
  return rows
    .map(row => ({
      ...row,
      score: scoreChunk(row, terms) + (Number(row.semantic_score || 0) * 100),
    }))
    .sort((a, b) => b.score - a.score || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .slice(0, MAX_RAG_CHUNKS);
}

function buildChunksFromSection(section) {
  const category = String(section.category || '').trim();
  const content = String(section.content || '').trim();
  if (!category || !content) return [];

  const parts = content.split(/\n(?=###\s+)/g);
  const chunks = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const titleMatch = trimmed.match(/^###\s*(.+)$/m);
    const baseTitle = titleMatch ? titleMatch[1].trim() : category;
    splitLongText(trimmed).forEach((chunk, idx) => {
      chunks.push({
        sectionId: section.id,
        category,
        title: idx === 0 ? baseTitle : `${baseTitle} (${idx + 1})`,
        content: chunk,
        searchText: normalizeText(`${category} ${baseTitle} ${chunk}`),
        riskLevel: extractRiskLevel(chunk),
        sourceUpdatedAt: section.updated_at || '',
      });
    });
  }
  return chunks;
}

function hasHighRiskChunk(rag) {
  return Array.isArray(rag?.chunks) && rag.chunks.some(chunk => normalizeRiskLevel(chunk.risk_level) === 'High');
}

function buildRuntimeGuardrails(question, rag) {
  const text = `${question || ''}\n${rag?.context || ''}`;
  const highRiskKeywords = [
    '補點',
    '退款',
    '帳號',
    '個資',
    '客訴',
    '人工審核',
    '工程師',
    '機台故障',
    '滿倉',
    '異常',
  ];
  const needsGuardrail = hasHighRiskChunk(rag) || highRiskKeywords.some(keyword => text.includes(keyword));
  if (!needsGuardrail) return '';

  return `## 高風險客服規則
- 遇到點數、優惠券、帳號、個資、退款、客訴、機台異常等問題，要保守回答。
- 不可承諾已補點、已退款、已人工審核、工程師已到場、問題已完成處理。
- 應先收集必要資訊，例如註冊手機、回收時間、站點、截圖、交易或兌換資訊。
- 若知識庫沒有確切資料，請引導使用者填寫客服表單：https://ecoco.tw/kWqgW`;
}

function toVectorLiteral(embedding) {
  return `[${embedding.map(value => Number(value).toFixed(8)).join(',')}]`;
}

function buildEmbeddingInput(row) {
  return normalizeText(`${row.category}\n${row.title}\n${row.content}`).slice(0, 6000);
}

function createRagService({ pool, env = process.env }) {
  const embeddingModel = env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const embeddingDimensions = Number(env.EMBEDDING_DIMENSIONS || 1536);
  const embeddingBatchSize = Number(env.EMBEDDING_BATCH_SIZE || 80);
  const embeddingTimeoutMs = Number(env.EMBEDDING_TIMEOUT_MS || 10000);
  let pgVectorAvailable = false;

  function shouldUseSemanticSearch() {
    return pgVectorAvailable && Boolean(env.OPENAI_API_KEY);
  }

  async function ensurePgVector() {
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await pool.query(`ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(${embeddingDimensions})`);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_kc_embedding_cosine
         ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
         WHERE embedding IS NOT NULL`
      );
      pgVectorAvailable = true;
      console.log('pgvector enabled for semantic RAG search');
    } catch (err) {
      pgVectorAvailable = false;
      console.warn(`pgvector unavailable; falling back to keyword RAG: ${err.message}`);
    }
  }

  async function embedTexts(inputs) {
    if (!env.OPENAI_API_KEY || inputs.length === 0) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), embeddingTimeoutMs);

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: embeddingModel,
          input: inputs,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Embedding API failed: ${response.status} ${detail.slice(0, 200)}`);
      }

      const payload = await response.json();
      return Array.isArray(payload.data) ? payload.data.map(item => item.embedding) : [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async function attachEmbeddings(rows) {
    if (!shouldUseSemanticSearch() || rows.length === 0) return rows;

    try {
      for (let i = 0; i < rows.length; i += embeddingBatchSize) {
        const batch = rows.slice(i, i + embeddingBatchSize);
        const embeddings = await embedTexts(batch.map(buildEmbeddingInput));
        embeddings.forEach((embedding, index) => {
          if (Array.isArray(embedding) && embedding.length > 0) {
            batch[index].embedding = toVectorLiteral(embedding);
            batch[index].embeddingModel = embeddingModel;
          }
        });
      }
    } catch (err) {
      console.warn(`Embedding backfill skipped; keyword RAG remains available: ${err.message}`);
    }

    return rows;
  }

  async function insertKnowledgeChunkRows(db, insertRows) {
    const batchSize = 400;
    for (let i = 0; i < insertRows.length; i += batchSize) {
      const batch = insertRows.slice(i, i + batchSize);
      const values = [];
      if (pgVectorAvailable) {
        const placeholders = batch.map((row, rowIndex) => {
          const base = rowIndex * 11;
          values.push(row.sectionId, row.category, row.title, row.content, row.searchText, row.riskLevel, row.sortOrder, row.sourceUpdatedAt, row.embeddingModel, row.updatedAt, row.embedding);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, CASE WHEN $${base + 11}::text IS NULL THEN NULL ELSE $${base + 11}::vector END)`;
        });
        await db.query(
          `INSERT INTO knowledge_chunks
            (section_id, category, title, content, search_text, risk_level, sort_order, source_updated_at, embedding_model, updated_at, embedding)
           VALUES ${placeholders.join(', ')}`,
          values
        );
      } else {
        const placeholders = batch.map((row, rowIndex) => {
          const base = rowIndex * 10;
          values.push(row.sectionId, row.category, row.title, row.content, row.searchText, row.riskLevel, row.sortOrder, row.sourceUpdatedAt, row.embeddingModel, row.updatedAt);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        });
        await db.query(
          `INSERT INTO knowledge_chunks
            (section_id, category, title, content, search_text, risk_level, sort_order, source_updated_at, embedding_model, updated_at)
           VALUES ${placeholders.join(', ')}`,
          values
        );
      }
    }
  }

  function buildInsertRowsFromSections(sections, now, initialSortOrder = 0) {
    let sortOrder = initialSortOrder;
    const insertRows = [];
    for (const section of sections) {
      for (const chunk of buildChunksFromSection(section)) {
        insertRows.push({
          sectionId: chunk.sectionId,
          category: chunk.category,
          title: chunk.title,
          content: chunk.content,
          searchText: chunk.searchText,
          riskLevel: chunk.riskLevel,
          sortOrder: sortOrder++,
          sourceUpdatedAt: chunk.sourceUpdatedAt,
          updatedAt: now,
          embedding: null,
          embeddingModel: '',
        });
      }
    }
    return insertRows;
  }

  async function rebuildKnowledgeChunks() {
    const { rows } = await pool.query(
      "SELECT id, category, content, sort_order, updated_at FROM knowledge_sections WHERE COALESCE(archived_at, '') = '' ORDER BY sort_order ASC, id ASC"
    );

    const now = new Date().toISOString();
    const insertRows = buildInsertRowsFromSections(rows, now);

    await attachEmbeddings(insertRows);

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM knowledge_chunks');
      await insertKnowledgeChunkRows(db, insertRows);
      await db.query('COMMIT');
      console.log(`Knowledge chunks rebuilt: ${insertRows.length} chunks`);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function rebuildKnowledgeChunksForSection(sectionId) {
    const id = Number(sectionId);
    if (!Number.isInteger(id)) return;

    const { rows } = await pool.query(
      `SELECT id, category, content, sort_order, updated_at, COALESCE(archived_at, '') AS archived_at
       FROM knowledge_sections
       WHERE id = $1`,
      [id]
    );

    const section = rows[0];
    const activeSections = section && !section.archived_at ? [section] : [];
    const now = new Date().toISOString();
    const baseSortResult = await pool.query(
      `SELECT COALESCE(
          MIN(sort_order),
          (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM knowledge_chunks)
        ) AS base_sort_order
       FROM knowledge_chunks
       WHERE section_id = $1`,
      [id]
    );
    const baseSortOrder = Number(baseSortResult.rows[0].base_sort_order || 0);
    const insertRows = buildInsertRowsFromSections(activeSections, now, baseSortOrder);

    await attachEmbeddings(insertRows);

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM knowledge_chunks WHERE section_id = $1', [id]);
      await insertKnowledgeChunkRows(db, insertRows);
      await db.query('COMMIT');
      console.log(`Knowledge chunks refreshed for section ${id}: ${insertRows.length} chunks`);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function retrieveSemanticRows(question) {
    if (!shouldUseSemanticSearch()) return [];
    try {
      const [embedding] = await embedTexts([normalizeText(question).slice(0, 6000)]);
      if (!Array.isArray(embedding) || embedding.length === 0) return [];

      const vector = toVectorLiteral(embedding);
      const { rows } = await pool.query(
        `SELECT id, category, title, content, risk_level, sort_order,
                1 - (embedding <=> $1::vector) AS semantic_score
         FROM knowledge_chunks
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 60`,
        [vector]
      );
      return rows;
    } catch (err) {
      console.warn(`Semantic RAG skipped; using keyword RAG: ${err.message}`);
      return [];
    }
  }

  async function retrieveKnowledgeForQuestion(question) {
    const terms = buildSearchTerms(question);
    let rows = await retrieveSemanticRows(question);

    if (terms.length > 0) {
      const clauses = terms.map((_, idx) => `search_text ILIKE $${idx + 1}`).join(' OR ');
      const values = terms.map(term => `%${term}%`);
      const result = await pool.query(
        `SELECT id, category, title, content, risk_level, sort_order
         FROM knowledge_chunks
         WHERE ${clauses}
         ORDER BY sort_order ASC
         LIMIT 120`,
        values
      );
      const byId = new Map(rows.map(row => [row.id, row]));
      result.rows.forEach(row => {
        if (!byId.has(row.id)) byId.set(row.id, row);
      });
      rows = [...byId.values()];
    }

    const ranked = rankKnowledgeRows(rows, terms);

    return {
      terms,
      chunks: ranked,
      context: ranked.map((row, idx) => (
        `[RAG-${idx + 1}] ${row.category} / ${row.title}\n風險：${normalizeRiskLevel(row.risk_level)}\n${row.content}`
      )).join('\n\n'),
    };
  }

  return {
    ensurePgVector,
    rebuildKnowledgeChunks,
    rebuildKnowledgeChunksForSection,
    retrieveKnowledgeForQuestion,
    buildRuntimeGuardrails,
    shouldUseSemanticSearch,
  };
}

module.exports = {
  buildChunksFromSection,
  buildRuntimeGuardrails,
  buildSearchTerms,
  createRagService,
  extractRiskLevel,
  hasHighRiskChunk,
  normalizeRiskLevel,
  normalizeText,
  rankKnowledgeRows,
  scoreChunk,
};
