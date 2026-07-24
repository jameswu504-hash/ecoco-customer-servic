const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
      id         SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      timestamp  TIMESTAMPTZ NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS ratings (
      id        SERIAL PRIMARY KEY,
      msg_id    TEXT NOT NULL,
      type      TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      question  TEXT DEFAULT '',
      reply     TEXT DEFAULT ''
    )`,
  `CREATE TABLE IF NOT EXISTS unanswered_questions (
      id         SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      question   TEXT NOT NULL,
      reply      TEXT DEFAULT '',
      reason     TEXT DEFAULT '',
      timestamp  TIMESTAMPTZ NOT NULL
    )`,
  `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS reply TEXT DEFAULT ''`,
  `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT ''`,
  `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
  `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS note TEXT DEFAULT ''`,
  `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS knowledge_sections (
      id         SERIAL PRIMARY KEY,
      category   TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
  `ALTER TABLE knowledge_sections ADD COLUMN IF NOT EXISTS archived_at TEXT DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id                SERIAL PRIMARY KEY,
      section_id        INTEGER,
      category          TEXT NOT NULL,
      title             TEXT NOT NULL DEFAULT '',
      content           TEXT NOT NULL DEFAULT '',
      search_text       TEXT NOT NULL DEFAULT '',
      risk_level        TEXT NOT NULL DEFAULT 'Low',
      sort_order        INTEGER NOT NULL DEFAULT 0,
      source_updated_at TEXT NOT NULL DEFAULT '',
      embedding_model   TEXT NOT NULL DEFAULT '',
      updated_at        TEXT NOT NULL
    )`,
  `ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'Low'`,
  `ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS idx_conv_session  ON conversations(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_session_ts ON conversations(session_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_role     ON conversations(role)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_role_timestamp ON conversations(role, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_type  ON ratings(type)`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_timestamp ON ratings(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_unanswered_ts ON unanswered_questions(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_unanswered_status ON unanswered_questions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ks_sort       ON knowledge_sections(sort_order, id)`,
  `CREATE INDEX IF NOT EXISTS idx_ks_archived   ON knowledge_sections(archived_at)`,
  `CREATE INDEX IF NOT EXISTS idx_kc_section    ON knowledge_chunks(section_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kc_sort       ON knowledge_chunks(sort_order, id)`,
  `CREATE INDEX IF NOT EXISTS idx_kc_risk       ON knowledge_chunks(risk_level)`,
  `CREATE TABLE IF NOT EXISTS chat_traces (
      id              SERIAL PRIMARY KEY,
      session_id      TEXT NOT NULL DEFAULT '',
      channel         TEXT NOT NULL DEFAULT 'web',
      question        TEXT NOT NULL DEFAULT '',
      question_category TEXT NOT NULL DEFAULT '',
      question_category_label TEXT NOT NULL DEFAULT '',
      question_category_confidence TEXT NOT NULL DEFAULT '',
      rag_scope       JSONB NOT NULL DEFAULT '[]'::jsonb,
      retrieval_mode  TEXT NOT NULL DEFAULT 'none',
      retrieved_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
      latency_ms      INTEGER NOT NULL DEFAULT 0,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      stop_reason     TEXT NOT NULL DEFAULT '',
      error           TEXT NOT NULL DEFAULT '',
      timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `ALTER TABLE chat_traces ADD COLUMN IF NOT EXISTS question_category TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE chat_traces ADD COLUMN IF NOT EXISTS question_category_label TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE chat_traces ADD COLUMN IF NOT EXISTS question_category_confidence TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE chat_traces ADD COLUMN IF NOT EXISTS rag_scope JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE INDEX IF NOT EXISTS idx_chat_traces_ts ON chat_traces(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_traces_session ON chat_traces(session_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_traces_channel ON chat_traces(channel, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_traces_question_category ON chat_traces(question_category, timestamp)`,
  `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id          SERIAL PRIMARY KEY,
      actor       TEXT NOT NULL DEFAULT 'admin',
      action      TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id   TEXT NOT NULL DEFAULT '',
      details     JSONB NOT NULL DEFAULT '{}'::jsonb,
      timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit_logs(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_logs(target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS internal_wiki_entries (
      id          SERIAL PRIMARY KEY,
      department  TEXT NOT NULL DEFAULT 'general',
      visibility  TEXT NOT NULL DEFAULT 'staff',
      title       TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ
    )`,
  `CREATE INDEX IF NOT EXISTS idx_internal_wiki_department ON internal_wiki_entries(department)`,
  `CREATE INDEX IF NOT EXISTS idx_internal_wiki_visibility ON internal_wiki_entries(visibility)`,
  `CREATE INDEX IF NOT EXISTS idx_internal_wiki_archived ON internal_wiki_entries(archived_at)`,
  `CREATE INDEX IF NOT EXISTS idx_internal_wiki_sort ON internal_wiki_entries(sort_order, id)`,
  `CREATE TABLE IF NOT EXISTS iot_station_statuses (
      station_code              TEXT NOT NULL,
      station_name              TEXT NOT NULL DEFAULT '',
      address                   TEXT NOT NULL DEFAULT '',
      area_name                 TEXT NOT NULL DEFAULT '',
      district_name             TEXT NOT NULL DEFAULT '',
      place_name                TEXT NOT NULL DEFAULT '',
      longitude                 TEXT NOT NULL DEFAULT '',
      latitude                  TEXT NOT NULL DEFAULT '',
      service_hours             TEXT NOT NULL DEFAULT '',
      station_status            TEXT NOT NULL DEFAULT '',
      station_status_updated_at TIMESTAMPTZ,
      asset_id                  TEXT NOT NULL DEFAULT '',
      machine_type              TEXT NOT NULL DEFAULT '',
      machine_kind              TEXT NOT NULL DEFAULT '',
      machine_status            TEXT NOT NULL DEFAULT '',
      machine_status_at         TIMESTAMPTZ,
      last_conn_status          TEXT NOT NULL DEFAULT '',
      last_conn_status_at       TIMESTAMPTZ,
      last_heartbeat_at         TIMESTAMPTZ,
      alarm_code                TEXT NOT NULL DEFAULT '',
      alarm_description         TEXT NOT NULL DEFAULT '',
      bin1_count                INTEGER,
      bin1_max_capacity         INTEGER,
      bin1_remain_capacity      INTEGER,
      bin1_full_at              TIMESTAMPTZ,
      bin2_count                INTEGER,
      bin2_max_capacity         INTEGER,
      bin2_remain_capacity      INTEGER,
      bin2_full_at              TIMESTAMPTZ,
      source_synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (station_code, asset_id)
    )`,
  `ALTER TABLE iot_station_statuses DROP CONSTRAINT IF EXISTS iot_station_statuses_pkey`,
  `ALTER TABLE iot_station_statuses ADD PRIMARY KEY (station_code, asset_id)`,
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS longitude TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS latitude TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS source_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_iot_station_statuses_name ON iot_station_statuses(station_name)`,
  `CREATE INDEX IF NOT EXISTS idx_iot_station_statuses_area ON iot_station_statuses(area_name, district_name)`,
  `CREATE INDEX IF NOT EXISTS idx_iot_station_statuses_synced_at ON iot_station_statuses(source_synced_at)`,
  `CREATE INDEX IF NOT EXISTS idx_iot_station_statuses_machine_status ON iot_station_statuses(machine_status)`,
];

const TIMESTAMP_COLUMNS = [
  { tableName: 'conversations', columnName: 'timestamp' },
  { tableName: 'ratings', columnName: 'timestamp' },
  { tableName: 'unanswered_questions', columnName: 'timestamp' },
];

async function migrateTimestampColumns(pool) {
  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
         ('conversations', 'timestamp'),
         ('ratings', 'timestamp'),
         ('unanswered_questions', 'timestamp')
       )`
  );

  const typeByColumn = new Map(
    rows.map(row => [`${row.table_name}.${row.column_name}`, row.data_type])
  );

  const pending = TIMESTAMP_COLUMNS.filter(({ tableName, columnName }) => (
    typeByColumn.get(`${tableName}.${columnName}`) !== 'timestamp with time zone'
  ));

  if (pending.length === 0) {
    console.log('Timestamp column migration skipped: already TIMESTAMPTZ');
    return { migrated: [] };
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `CREATE OR REPLACE FUNCTION ecoco_safe_timestamptz(value TEXT)
       RETURNS TIMESTAMPTZ AS $$
       BEGIN
         RETURN NULLIF(value, '')::timestamptz;
       EXCEPTION WHEN OTHERS THEN
         RETURN NOW();
       END;
       $$ LANGUAGE plpgsql`
    );

    for (const { tableName, columnName } of pending) {
      await db.query(
        `ALTER TABLE ${tableName}
         ALTER COLUMN ${columnName} TYPE TIMESTAMPTZ
         USING CASE
           WHEN NULLIF(${columnName}::text, '') IS NULL THEN NOW()
           ELSE ecoco_safe_timestamptz(${columnName}::text)
         END`
      );
    }

    await db.query('COMMIT');
    console.log(`Timestamp column migration complete: ${pending.map(item => `${item.tableName}.${item.columnName}`).join(', ')}`);
    return { migrated: pending };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

module.exports = {
  SCHEMA,
  TIMESTAMP_COLUMNS,
  migrateTimestampColumns,
};
