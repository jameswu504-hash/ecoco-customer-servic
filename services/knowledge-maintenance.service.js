const LEGACY_STATION_CATEGORY_PREFIX = 'AI客服知識：站點資料 / ';
const LIVE_STATION_GUIDANCE_CATEGORY = '站點資訊';
const LIVE_STATION_GUIDANCE_CONTENT = [
  '站點名稱、地址、距離、設備狀態、連線狀態與回收槽容量，一律以 Hive 同步至系統的最新站點資料為準。',
  '不得使用固定站點清單或歷史匯出檔回答站點是否存在、是否營運或目前狀態。',
  '查詢方式：可請使用者提供站點名稱、縣市、行政區、路名或地標；使用者也可傳送目前位置查詢附近站點。',
  '若同步資料逾時或沒有結果，應明確說明目前無法確認，不可引用舊資料補答。',
].join('\n');

async function purgeLegacyStationKnowledge(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      `SELECT id, category, content
       FROM knowledge_sections
       WHERE category LIKE $1 OR category = $2
       FOR UPDATE`,
      [`${LEGACY_STATION_CATEGORY_PREFIX}%`, LIVE_STATION_GUIDANCE_CATEGORY]
    );

    const legacyRows = rows.filter(row => (
      String(row.category || '').startsWith(LEGACY_STATION_CATEGORY_PREFIX)
    ));
    const guidanceRows = rows.filter(row => (
      row.category === LIVE_STATION_GUIDANCE_CATEGORY
      && row.content !== LIVE_STATION_GUIDANCE_CONTENT
    ));
    const affectedRows = [...legacyRows, ...guidanceRows];

    if (affectedRows.length === 0) {
      await db.query('COMMIT');
      return { deletedSections: 0, deletedChunks: 0, refreshedSectionIds: [] };
    }

    const affectedSectionIds = affectedRows.map(row => Number(row.id));
    const legacySectionIds = legacyRows.map(row => Number(row.id));
    const refreshedSectionIds = guidanceRows.map(row => Number(row.id));
    const chunks = await db.query(
      'DELETE FROM knowledge_chunks WHERE section_id = ANY($1::int[]) RETURNING id',
      [affectedSectionIds]
    );
    if (legacySectionIds.length > 0) {
      await db.query(
        'DELETE FROM knowledge_sections WHERE id = ANY($1::int[])',
        [legacySectionIds]
      );
    }
    if (refreshedSectionIds.length > 0) {
      await db.query(
        `UPDATE knowledge_sections
         SET content = $1, updated_at = $2
         WHERE id = ANY($3::int[])`,
        [LIVE_STATION_GUIDANCE_CONTENT, new Date().toISOString(), refreshedSectionIds]
      );
    }
    await db.query(
      `INSERT INTO admin_audit_logs
         (actor, action, target_type, target_id, details, timestamp)
       VALUES
         ('system', 'knowledge.legacy_station_purge', 'knowledge_section', $1, $2::jsonb, NOW())`,
      [
        affectedSectionIds.join(','),
        JSON.stringify({
          categories: affectedRows.map(row => row.category),
          deletedSections: legacyRows.length,
          deletedChunks: chunks.rowCount,
          refreshedSectionIds,
          replacementSource: 'iot_station_statuses (Hive synchronized mirror)',
        }),
      ]
    );
    await db.query('COMMIT');

    return {
      deletedSections: legacyRows.length,
      deletedChunks: chunks.rowCount,
      refreshedSectionIds,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

module.exports = {
  LEGACY_STATION_CATEGORY_PREFIX,
  LIVE_STATION_GUIDANCE_CATEGORY,
  LIVE_STATION_GUIDANCE_CONTENT,
  purgeLegacyStationKnowledge,
};
