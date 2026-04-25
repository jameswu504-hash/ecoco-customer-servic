/**
 * 一次性遷移腳本：將 ecoco_chat.json → ecoco_chat.db
 * 執行方式：node migrate.js
 */
const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const JSON_PATH = path.join(__dirname, 'ecoco_chat.json');
const DB_PATH   = path.join(__dirname, 'ecoco_chat.db');

// ── 1. 讀取 JSON ─────────────────────────────────────────
if (!fs.existsSync(JSON_PATH)) {
  console.log('找不到 ecoco_chat.json，略過遷移。');
  process.exit(0);
}

const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const conversations = json.conversations || [];
const ratings       = json.ratings       || [];

// ── 2. 建立 SQLite 資料庫 ─────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    timestamp  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    msg_id    TEXT NOT NULL,
    type      TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
`);

// ── 3. 插入舊資料 ─────────────────────────────────────────
const insertConv   = db.prepare('INSERT INTO conversations (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)');
const insertRating = db.prepare('INSERT INTO ratings (msg_id, type, timestamp) VALUES (?, ?, ?)');

const migrateAll = db.transaction(() => {
  for (const c of conversations) {
    insertConv.run(c.session_id, c.role, c.content, c.timestamp);
  }
  for (const r of ratings) {
    insertRating.run(r.msg_id, r.type, r.timestamp);
  }
});

migrateAll();

console.log(`✅ 遷移完成`);
console.log(`   conversations：${conversations.length} 筆`);
console.log(`   ratings：${ratings.length} 筆`);
console.log(`   資料庫位置：${DB_PATH}`);
