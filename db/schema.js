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
  `CREATE OR REPLACE FUNCTION ecoco_safe_timestamptz(value TEXT)
     RETURNS TIMESTAMPTZ AS $$
     BEGIN
       RETURN NULLIF(value, '')::timestamptz;
     EXCEPTION WHEN OTHERS THEN
       RETURN NOW();
     END;
     $$ LANGUAGE plpgsql`,
  `ALTER TABLE conversations
     ALTER COLUMN timestamp TYPE TIMESTAMPTZ
     USING CASE
       WHEN NULLIF(timestamp::text, '') IS NULL THEN NOW()
       ELSE ecoco_safe_timestamptz(timestamp::text)
     END`,
  `ALTER TABLE ratings
     ALTER COLUMN timestamp TYPE TIMESTAMPTZ
     USING CASE
       WHEN NULLIF(timestamp::text, '') IS NULL THEN NOW()
       ELSE ecoco_safe_timestamptz(timestamp::text)
     END`,
  `ALTER TABLE unanswered_questions
     ALTER COLUMN timestamp TYPE TIMESTAMPTZ
     USING CASE
       WHEN NULLIF(timestamp::text, '') IS NULL THEN NOW()
       ELSE ecoco_safe_timestamptz(timestamp::text)
     END`,
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
  `CREATE INDEX IF NOT EXISTS idx_conv_role     ON conversations(role)`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_type  ON ratings(type)`,
  `CREATE INDEX IF NOT EXISTS idx_unanswered_ts ON unanswered_questions(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_unanswered_status ON unanswered_questions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ks_sort       ON knowledge_sections(sort_order, id)`,
  `CREATE INDEX IF NOT EXISTS idx_ks_archived   ON knowledge_sections(archived_at)`,
  `CREATE INDEX IF NOT EXISTS idx_kc_section    ON knowledge_chunks(section_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kc_sort       ON knowledge_chunks(sort_order, id)`,
  `CREATE INDEX IF NOT EXISTS idx_kc_risk       ON knowledge_chunks(risk_level)`,
];

module.exports = { SCHEMA };
