const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
      id         SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      timestamp  TIMESTAMPTZ NOT NULL
    )`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_id TEXT NOT NULL DEFAULT ''`,
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
  `CREATE INDEX IF NOT EXISTS idx_conv_session_message ON conversations(session_id, message_id)`,
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
  `CREATE TABLE IF NOT EXISTS line_webhook_events (
      event_id     TEXT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'processing',
      attempts     INTEGER NOT NULL DEFAULT 1,
      is_redelivery BOOLEAN NOT NULL DEFAULT FALSE,
      last_error   TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_line_webhook_events_updated ON line_webhook_events(updated_at)`,
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
  `CREATE TABLE IF NOT EXISTS partner_companies (
      id         SERIAL PRIMARY KEY,
      slug       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_companies_status ON partner_companies(status, name)`,
  `CREATE TABLE IF NOT EXISTS partner_line_groups (
      id                 SERIAL PRIMARY KEY,
      company_id         INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      group_key          TEXT NOT NULL UNIQUE,
      group_id_last4     TEXT NOT NULL DEFAULT '',
      label              TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'active',
      bound_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_line_groups_company ON partner_line_groups(company_id, status)`,
  `CREATE TABLE IF NOT EXISTS partner_binding_codes (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      code_hash   TEXT NOT NULL UNIQUE,
      code_hint   TEXT NOT NULL DEFAULT '',
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_binding_codes_company ON partner_binding_codes(company_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS partner_source_documents (
      id                     SERIAL PRIMARY KEY,
      company_id             INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      source_type            TEXT NOT NULL,
      original_filename      TEXT NOT NULL,
      content_hash           TEXT NOT NULL,
      original_size          INTEGER NOT NULL DEFAULT 0,
      storage_mode           TEXT NOT NULL DEFAULT 'browser_local_only',
      preserve_personal_data BOOLEAN NOT NULL DEFAULT TRUE,
      raw_content_stored     BOOLEAN NOT NULL DEFAULT FALSE,
      status                 TEXT NOT NULL DEFAULT 'uploaded',
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      imported_at            TIMESTAMPTZ,
      UNIQUE(company_id, content_hash)
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_source_documents_company
     ON partner_source_documents(company_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS partner_cleaning_jobs (
      id                 SERIAL PRIMARY KEY,
      company_id         INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      source_document_id INTEGER NOT NULL REFERENCES partner_source_documents(id) ON DELETE CASCADE,
      skill_name         TEXT NOT NULL,
      skill_version      TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending_review',
      report             JSONB NOT NULL DEFAULT '{}'::jsonb,
      approved_by        TEXT NOT NULL DEFAULT '',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at       TIMESTAMPTZ,
      approved_at        TIMESTAMPTZ
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_cleaning_jobs_company
     ON partner_cleaning_jobs(company_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS partner_knowledge_sections (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      category    TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      archived_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `ALTER TABLE partner_knowledge_sections
     ADD COLUMN IF NOT EXISTS source_document_id INTEGER REFERENCES partner_source_documents(id) ON DELETE SET NULL`,
  `ALTER TABLE partner_knowledge_sections
     ADD COLUMN IF NOT EXISTS cleaning_job_id INTEGER REFERENCES partner_cleaning_jobs(id) ON DELETE SET NULL`,
  `ALTER TABLE partner_knowledge_sections ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE partner_knowledge_sections ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE partner_knowledge_sections ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE partner_knowledge_sections ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'`,
  `ALTER TABLE partner_knowledge_sections ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_partner_knowledge_company ON partner_knowledge_sections(company_id, archived_at, sort_order)`,
  `CREATE TABLE IF NOT EXISTS partner_knowledge_chunks (
      id                 SERIAL PRIMARY KEY,
      company_id         INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      section_id         INTEGER NOT NULL REFERENCES partner_knowledge_sections(id) ON DELETE CASCADE,
      source_document_id INTEGER REFERENCES partner_source_documents(id) ON DELETE SET NULL,
      chunk_index        INTEGER NOT NULL DEFAULT 0,
      topic              TEXT NOT NULL DEFAULT '',
      content            TEXT NOT NULL DEFAULT '',
      search_text        TEXT NOT NULL DEFAULT '',
      content_hash       TEXT NOT NULL DEFAULT '',
      metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_references  JSONB NOT NULL DEFAULT '[]'::jsonb,
      embedding_model    TEXT NOT NULL DEFAULT '',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(section_id, chunk_index)
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_knowledge_chunks_company
     ON partner_knowledge_chunks(company_id, topic, id)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_knowledge_chunks_section
     ON partner_knowledge_chunks(section_id, chunk_index)`,
  `CREATE TABLE IF NOT EXISTS partner_conversations (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      line_group_id INTEGER REFERENCES partner_line_groups(id) ON DELETE SET NULL,
      session_id    TEXT NOT NULL,
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  `ALTER TABLE partner_conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_partner_conversations_scope ON partner_conversations(company_id, session_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_conversations_group ON partner_conversations(line_group_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_conversations_company_day
     ON partner_conversations(company_id, timestamp DESC)
     WHERE line_group_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_partner_conversations_archive
     ON partner_conversations(company_id, archived_at, timestamp DESC)
     WHERE line_group_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS partner_conversation_batches (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      line_group_id        INTEGER NOT NULL REFERENCES partner_line_groups(id) ON DELETE CASCADE,
      conversation_day     DATE NOT NULL,
      status               TEXT NOT NULL DEFAULT 'completed',
      skill_name           TEXT NOT NULL,
      skill_version        TEXT NOT NULL,
      source_message_count INTEGER NOT NULL DEFAULT 0,
      content_hash         TEXT NOT NULL,
      report               JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at         TIMESTAMPTZ,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, line_group_id, conversation_day, content_hash)
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_conversation_batches_company
     ON partner_conversation_batches(company_id, conversation_day DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS partner_knowledge_candidates (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
      batch_id             INTEGER NOT NULL REFERENCES partner_conversation_batches(id) ON DELETE CASCADE,
      line_group_id        INTEGER NOT NULL REFERENCES partner_line_groups(id) ON DELETE CASCADE,
      title                TEXT NOT NULL,
      category             TEXT NOT NULL,
      content              TEXT NOT NULL,
      summary              TEXT NOT NULL DEFAULT '',
      facts                JSONB NOT NULL DEFAULT '[]'::jsonb,
      pending_items        JSONB NOT NULL DEFAULT '[]'::jsonb,
      todos                JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_message_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
      risk_flags           JSONB NOT NULL DEFAULT '[]'::jsonb,
      content_hash         TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending_review',
      reviewed_by          TEXT NOT NULL DEFAULT '',
      reviewed_at          TIMESTAMPTZ,
      approved_section_id  INTEGER REFERENCES partner_knowledge_sections(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, content_hash)
    )`,
  `CREATE INDEX IF NOT EXISTS idx_partner_knowledge_candidates_review
     ON partner_knowledge_candidates(company_id, status, created_at DESC)`,
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
  `DO $$
   DECLARE
     primary_key_name TEXT;
     primary_key_columns TEXT[];
   BEGIN
     SELECT
       constraint_info.conname,
       ARRAY_AGG(attribute_info.attname::TEXT ORDER BY key_info.ordinality)
     INTO primary_key_name, primary_key_columns
     FROM pg_constraint constraint_info
     JOIN UNNEST(constraint_info.conkey) WITH ORDINALITY AS key_info(attnum, ordinality) ON TRUE
     JOIN pg_attribute attribute_info
       ON attribute_info.attrelid = constraint_info.conrelid
      AND attribute_info.attnum = key_info.attnum
     WHERE constraint_info.conrelid = 'iot_station_statuses'::regclass
       AND constraint_info.contype = 'p'
     GROUP BY constraint_info.conname;

     IF primary_key_columns IS DISTINCT FROM ARRAY['station_code', 'asset_id']::TEXT[] THEN
       IF primary_key_name IS NOT NULL THEN
         EXECUTE FORMAT(
           'ALTER TABLE iot_station_statuses DROP CONSTRAINT %I',
           primary_key_name
         );
       END IF;
       ALTER TABLE iot_station_statuses ADD PRIMARY KEY (station_code, asset_id);
     END IF;
   END $$`,
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS longitude TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS latitude TEXT NOT NULL DEFAULT ''`,
  // 由文字座標衍生的數值欄位。CASE + regex 守衛讓髒資料（非數字字串）
  // 產生 NULL 而不是讓整個啟動遷移失敗；GENERATED 讓它永遠跟同步寫入的文字欄位一致。
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS lat_num DOUBLE PRECISION
     GENERATED ALWAYS AS (
       CASE WHEN latitude ~ '^-?[0-9]{1,3}(\\.[0-9]+)?$'
            THEN latitude::DOUBLE PRECISION END
     ) STORED`,
  `ALTER TABLE iot_station_statuses ADD COLUMN IF NOT EXISTS lng_num DOUBLE PRECISION
     GENERATED ALWAYS AS (
       CASE WHEN longitude ~ '^-?[0-9]{1,3}(\\.[0-9]+)?$'
            THEN longitude::DOUBLE PRECISION END
     ) STORED`,
  `CREATE INDEX IF NOT EXISTS idx_iot_station_coords
     ON iot_station_statuses (lat_num, lng_num)
     WHERE lat_num IS NOT NULL AND lng_num IS NOT NULL`,
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

async function migrateUniqueMessageIndexes(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('ecoco_unique_message_indexes'))");

    const { rows: conversationRows } = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM conversations duplicate
         JOIN conversations keeper
           ON duplicate.session_id = keeper.session_id
          AND duplicate.role = keeper.role
          AND duplicate.message_id = keeper.message_id
          AND duplicate.id < keeper.id
         WHERE duplicate.message_id <> ''
       ) AS exists`
    );
    const hasConversationDuplicates = Boolean(conversationRows[0]?.exists);
    if (hasConversationDuplicates) {
      await db.query(
        `DELETE FROM conversations duplicate
         USING conversations keeper
         WHERE duplicate.message_id <> ''
           AND duplicate.session_id = keeper.session_id
           AND duplicate.role = keeper.role
           AND duplicate.message_id = keeper.message_id
           AND duplicate.id < keeper.id`
      );
    }
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_session_role_message
       ON conversations(session_id, role, message_id)
       WHERE message_id <> ''`
    );

    const { rows: ratingRows } = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM ratings duplicate
         JOIN ratings keeper
           ON duplicate.msg_id = keeper.msg_id
          AND duplicate.id < keeper.id
         WHERE duplicate.msg_id <> ''
       ) AS exists`
    );
    const hasRatingDuplicates = Boolean(ratingRows[0]?.exists);
    if (hasRatingDuplicates) {
      await db.query(
        `DELETE FROM ratings duplicate
         USING ratings keeper
         WHERE duplicate.msg_id <> ''
           AND duplicate.msg_id = keeper.msg_id
           AND duplicate.id < keeper.id`
      );
    }
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_ratings_msg_id
       ON ratings(msg_id)
       WHERE msg_id <> ''`
    );

    await db.query('COMMIT');
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
  migrateUniqueMessageIndexes,
};
