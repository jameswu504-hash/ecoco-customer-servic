async function getKnowledgeEmbeddingStatus(pool) {
  const { rows: columnRows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'knowledge_chunks'
         AND column_name = 'embedding'
     ) AS exists`
  );
  const hasEmbeddingColumn = Boolean(columnRows[0]?.exists);

  const { rows } = hasEmbeddingColumn
    ? await pool.query(
      `SELECT
         COUNT(*) AS chunk_count,
         COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_count
       FROM knowledge_chunks`
    )
    : await pool.query(
      `SELECT COUNT(*) AS chunk_count, 0 AS embedded_count
       FROM knowledge_chunks`
    );

  return {
    chunkCount: Number(rows[0]?.chunk_count || 0),
    embeddedCount: Number(rows[0]?.embedded_count || 0),
  };
}

module.exports = {
  getKnowledgeEmbeddingStatus,
};
