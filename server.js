require('dotenv').config();
const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const { Pool }  = require('pg');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic();

// ── PostgreSQL 連線池 ─────────────────────────────────────
// DATABASE_URL 由環境變數提供（Neon / Supabase / Render Postgres）
// 雲端 Postgres 外部連線一律需要 SSL；若用 Render 內部連線報 SSL 錯，
// 可在環境變數加 PGSSL=disable 關閉。
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

// ── 安全性：Rate Limiting ─────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁，請稍後再試（每分鐘限 10 次）' },
});

// ── 安全性：Admin API 保護（timing-safe 比較，防計時攻擊）─
function requireAdminKey(req, res, next) {
  const key      = req.headers['x-admin-key'] || '';
  const expected = process.env.ADMIN_KEY       || '';
  if (!key || !expected) {
    return res.status(401).json({ error: '未授權' });
  }
  const len = Math.max(Buffer.byteLength(key), Buffer.byteLength(expected));
  const a   = Buffer.alloc(len); Buffer.from(key).copy(a);
  const b   = Buffer.alloc(len); Buffer.from(expected).copy(b);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: '未授權' });
  }
  next();
}

// ── 資料庫初始化（建表 + 索引），啟動時跑一次 ──────────────
// 注意：每條指令分開執行（雲端 Postgres 連線池不接受一次多語句）
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
      id         SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      timestamp  TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS ratings (
      id        SERIAL PRIMARY KEY,
      msg_id    TEXT NOT NULL,
      type      TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      question  TEXT DEFAULT '',
      reply     TEXT DEFAULT ''
    )`,
  `CREATE TABLE IF NOT EXISTS unanswered_questions (
      id         SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      question   TEXT NOT NULL,
      reply      TEXT DEFAULT '',
      reason     TEXT DEFAULT '',
      timestamp  TEXT NOT NULL
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
  `CREATE INDEX IF NOT EXISTS idx_conv_session  ON conversations(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_role     ON conversations(role)`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_type  ON ratings(type)`,
  `CREATE INDEX IF NOT EXISTS idx_unanswered_ts ON unanswered_questions(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_unanswered_status ON unanswered_questions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ks_sort       ON knowledge_sections(sort_order, id)`,
];

async function initDb() {
  for (const stmt of SCHEMA) {
    await pool.query(stmt);
  }

  // 首次部署：若 knowledge_sections 為空，從 knowledge.js 匯入初始分類
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM knowledge_sections');
  if (Number(rows[0].count) === 0) {
    const seed = require('./knowledge'); // 分類陣列 [{category, content}]
    const now  = new Date().toISOString();
    let i = 0;
    for (const s of seed) {
      await pool.query(
        'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4)',
        [s.category, s.content, i++, now]
      );
    }
    console.log(`知識庫初始化：從 knowledge.js 匯入 ${seed.length} 個分類`);
  }
}

// ── 知識庫：用記憶體快取，避免每次對話都查 DB ──────────────
async function syncKnowledgeFromImportFile() {
  if (process.env.KNOWLEDGE_AUTO_SYNC === 'disable') {
    console.log('Knowledge auto-sync skipped: KNOWLEDGE_AUTO_SYNC=disable');
    return;
  }

  const importPath = path.join(__dirname, 'data', 'ecoco-knowledge-import.json');
  if (!fs.existsSync(importPath)) {
    console.log('Knowledge auto-sync skipped: import file not found');
    return;
  }

  const payload = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  if (sections.length === 0) {
    console.log('Knowledge auto-sync skipped: no sections found');
    return;
  }

  const mode = process.env.KNOWLEDGE_AUTO_SYNC === 'replace' ? 'replace' : 'upsert';
  if (mode === 'replace') {
    await pool.query('DELETE FROM knowledge_sections');
  }

  const now = new Date().toISOString();
  let sortOrder = 0;
  let inserted = 0;
  let updated = 0;
  for (const section of sections) {
    const category = String(section.category || '').trim();
    const content = String(section.content || '').trim();
    if (!category || !content) continue;

    if (mode === 'replace') {
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
  console.log(`Knowledge auto-sync complete: mode=${mode} inserted=${inserted} updated=${updated}`);
}

function readJsonFile(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

let knowledgeCache = '';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-7';
const KNOWLEDGE_GAP_MARKERS = [
  '沒有確切資料',
  '沒有明確答案',
  '沒有相關資料',
  '建議您透過客服表單',
  'App 內「我的」>「聯絡我們」',
];

async function refreshKnowledgeCache() {
  const { rows } = await pool.query(
    'SELECT category, content FROM knowledge_sections ORDER BY sort_order ASC, id ASC'
  );
  knowledgeCache = rows.map(r => `【${r.category}】\n${r.content}`).join('\n\n');
  console.log('知識庫快取已更新，長度：', knowledgeCache.length);
}

function buildSystemPrompt() { return `你是 ECOCO 宜可可循環經濟的官方 AI 客服助理。

## 你的任務
根據以下知識庫，用友善、簡潔的方式回答用戶問題。

## 知識庫
${knowledgeCache}

## 回答規則

### 語言與語氣
- 永遠使用繁體中文回答
- 語氣溫暖、謙遜、負責任，像真人客服而非機器人
- emoji 每則最多 2 個，放在句尾，不放在句首（常用：🙏 🫡 😢）
- 用「建議您」而非「你應該」；用「歡迎」而非「請你」
- 不用誇張語氣，不說「非常非常」「超級」等過度用詞

### 回覆結構（依情境）
一般問題：直接回答，簡潔為主。
用戶抱怨／遇到問題時，依序：
1. 同理開頭：先道歉並確認用戶的困擾（「很抱歉讓您…」「很抱歉造成不便」）
2. 解釋原因：給合理說明，語氣中立不推卸
3. 具體建議：告訴用戶現在可以怎麼做（如何用 App 確認機台、去附近站點等）
4. 引導聯繫：若問題需要進一步處理，請用戶透過客服表單回報（https://ecoco.tw/kWqgW）
5. 感謝結尾：感謝回饋或體諒，加 1 個 emoji

### 品牌語氣參考範例
以下是 ECOCO 官方真實客服回覆風格，請模仿這個語氣：

範例一（機台退瓶）：
「很抱歉讓您多次嘗試卻未能順利回收。寶特瓶因材質、外型或投瓶速度不同，可能影響機台判定穩定度。建議操作時依畫面指示逐一投放，讓系統完成判定後再進行下一次投放。若仍反覆無法回收，歡迎透過客服表單提供相關站點資訊或拒收寶特瓶照片，我們將協助確認並作為後續優化參考。」

範例二（機台滿袋）：
「出發前可以先打開 ECOCO App，點選「機台」，就能查看該站是否滿袋。如果顯示已滿袋，也可以去附近的站點投瓶，省時又不會白跑一趟喔 🫡」

範例三（用戶不滿）：
「很抱歉造成您不好的體驗，也謝謝您的回饋。機台滿袋後系統會自動回報並安排清運，但實際清運仍需依排程執行，可能無法立刻處理。我們也會再加強說明與改善。」

### 格式（使用 Markdown 語法，介面會自動渲染）
- 段落式回答為主，抱怨類不要用條列（顯得冷漠）
- 純資訊查詢（點數規則、操作步驟）用條列 \`-\` 或表格
- 數字與重點用粗體 **粗體** 標示
- 多步驟操作用編號 \`1.\` \`2.\` \`3.\`
- 不要在抱怨／安慰類回覆使用條列，改用自然段落

### 最重要的規則：不確定就說不確定
- 只根據知識庫內容回答
- 如果知識庫沒有明確答案，請說：
  「這個問題我沒有確切資料，建議您透過客服表單讓專人協助：https://ecoco.tw/kWqgW（或 App 內「我的」>「聯絡我們」）」
- 絕對不要猜測或編造答案

### 特定情境處理
- 用戶抱怨或情緒激動：一定先道歉同理，再解釋，再給解法，不要急著解釋
- 用戶問競爭對手：只介紹 ECOCO，不評論其他品牌
- 用戶問優惠或折扣：說明現有點數兌換制度，不承諾額外優惠`; }

// ── API 路由 ──────────────────────────────────────────────

function detectKnowledgeGap(reply) {
  if (typeof reply !== 'string') {
    return { isGap: false, reason: '' };
  }

  const marker = KNOWLEDGE_GAP_MARKERS.find(text => reply.includes(text));
  if (!marker) {
    return { isGap: false, reason: '' };
  }

  return {
    isGap: true,
    reason: `AI 回覆包含知識缺口標記：「${marker}」`,
  };
}

app.post('/api/chat', chatLimiter, async (req, res) => {
  const { history } = req.body;

  const MAX_HISTORY = 20;
  const MAX_MSG_LEN = 2000;

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: '缺少對話紀錄' });
  }
  if (history.length > MAX_HISTORY) {
    return res.status(400).json({ error: `對話歷史超過 ${MAX_HISTORY} 則上限` });
  }
  if (!history.every(m => ['user', 'assistant'].includes(m.role))) {
    return res.status(400).json({ error: '訊息格式錯誤' });
  }
  if (history.some(m => typeof m.content !== 'string' || m.content.length > MAX_MSG_LEN)) {
    return res.status(400).json({ error: `訊息長度超過 ${MAX_MSG_LEN} 字上限` });
  }

  try {
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: history,
    });

    const reply = response.content.find(b => b.type === 'text')?.text
      ?? '抱歉，我暫時無法回應，請稍後再試。';

    // 寫入對話紀錄（DB 錯誤不影響回覆）
    try {
      const sessionId = req.headers['x-session-id'] || 'unknown';
      const userMsg   = history[history.length - 1];
      const ts        = new Date().toISOString();
      await pool.query(
        'INSERT INTO conversations (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)',
        [sessionId, 'user', userMsg.content, ts]
      );
      await pool.query(
        'INSERT INTO conversations (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)',
        [sessionId, 'assistant', reply, ts]
      );
      // 未被回答的問題歸檔（知識缺口）
      const gap = detectKnowledgeGap(reply);
      if (gap.isGap) {
        await pool.query(
          'INSERT INTO unanswered_questions (session_id, question, reply, reason, timestamp) VALUES ($1, $2, $3, $4, $5)',
          [sessionId, userMsg.content, reply, gap.reason, ts]
        );
      }
    } catch (dbErr) {
      console.error('DB 寫入失敗（不影響回覆）:', dbErr.message);
    }

    res.json({ reply });
  } catch (err) {
    console.error('Claude API 錯誤:', err.message);
    res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
  }
});

app.post('/api/rating', async (req, res) => {
  const { msgId, type, question, reply } = req.body;
  if (!msgId || !type) return res.status(400).json({ error: '缺少參數' });
  try {
    await pool.query(
      'INSERT INTO ratings (msg_id, type, timestamp, question, reply) VALUES ($1, $2, $3, $4, $5)',
      [String(msgId), type, new Date().toISOString(),
       String(question || '').substring(0, 300),
       String(reply    || '').substring(0, 300)]
    );
    res.json({ success: true });
  } catch (dbErr) {
    console.error('DB 寫入失敗:', dbErr.message);
    res.status(500).json({ error: '儲存失敗，請稍後再試' });
  }
});

app.get('/api/ratings', requireAdminKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT type, question, reply, timestamp FROM ratings WHERE question <> '' ORDER BY timestamp DESC LIMIT 50"
    );
    res.json(rows);
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.get('/api/stats', requireAdminKey, async (req, res) => {
  try {
    const [s, m, p, n, u] = await Promise.all([
      pool.query('SELECT COUNT(DISTINCT session_id) AS count FROM conversations'),
      pool.query('SELECT COUNT(*) AS count FROM conversations'),
      pool.query("SELECT COUNT(*) AS count FROM ratings WHERE type = 'positive'"),
      pool.query("SELECT COUNT(*) AS count FROM ratings WHERE type = 'negative'"),
      pool.query('SELECT COUNT(*) AS count FROM unanswered_questions'),
    ]);
    res.json({
      totalSessions:   Number(s.rows[0].count),
      totalMessages:   Number(m.rows[0].count),
      positiveRatings: Number(p.rows[0].count),
      negativeRatings: Number(n.rows[0].count),
      unansweredCount: Number(u.rows[0].count),
    });
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.get('/api/knowledge/overview', requireAdminKey, async (req, res) => {
  try {
    const importPayload = readJsonFile(path.join('data', 'ecoco-knowledge-import.json')) || {};
    const databasePayload = readJsonFile(path.join('data', 'ecoco-ai-customer-service-database.json')) || {};

    const [{ rows: dbCounts }, { rows: latestRows }] = await Promise.all([
      pool.query('SELECT COUNT(*) AS section_count, COALESCE(SUM(LENGTH(content)), 0) AS content_chars FROM knowledge_sections'),
      pool.query('SELECT MAX(updated_at) AS latest_update FROM knowledge_sections'),
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
      dbContentChars: Number(dbCounts[0].content_chars),
      latestDbUpdate: latestRows[0].latest_update || '',
      autoSyncMode: process.env.KNOWLEDGE_AUTO_SYNC || 'enabled',
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      counts: summary.counts || {},
      topCategories: Array.isArray(summary.category_counts) ? summary.category_counts.slice(0, 10) : [],
      sourceDocuments,
    });
  } catch (err) {
    console.error('Knowledge overview error:', err.message);
    res.status(500).json({ error: '知識庫總覽讀取失敗' });
  }
});

app.get('/api/sessions', requireAdminKey, async (req, res) => {
  try {
    const { rows: sessions } = await pool.query(`
      SELECT session_id,
             COUNT(*)       AS message_count,
             MIN(timestamp) AS started_at,
             MAX(timestamp) AS last_at
      FROM conversations
      GROUP BY session_id
      ORDER BY started_at DESC
    `);
    const result = [];
    for (const s of sessions) {
      const { rows: messages } = await pool.query(
        'SELECT role, content, timestamp FROM conversations WHERE session_id = $1 ORDER BY timestamp ASC',
        [s.session_id]
      );
      result.push({ ...s, message_count: Number(s.message_count), messages });
    }
    res.json(result);
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.get('/api/top-questions', requireAdminKey, async (req, res) => {
  try {
    const { rows: userMessages } = await pool.query("SELECT content FROM conversations WHERE role = 'user'");
    const keywordList = ['點數', '兌換', '寶特瓶', '電池', '全聯', '全家', '康達盛通',
                         '站點', 'App', '帳號', '密碼', '壓扁', '期限', '合作'];
    const keywords = {};
    userMessages.forEach(({ content }) => {
      keywordList.forEach(kw => {
        if (content.includes(kw)) keywords[kw] = (keywords[kw] || 0) + 1;
      });
    });
    res.json(
      Object.entries(keywords)
        .sort((a, b) => b[1] - a[1])
        .map(([keyword, count]) => ({ keyword, count }))
    );
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

// 知識缺口列表
app.get('/api/unanswered', requireAdminKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, session_id, question, reply, reason, timestamp,
              COALESCE(status, 'pending') AS status,
              COALESCE(note, '') AS note,
              COALESCE(updated_at, '') AS updated_at
       FROM unanswered_questions
       ORDER BY timestamp DESC LIMIT 100`
    );
    res.json(rows);
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.patch('/api/unanswered/:id', requireAdminKey, async (req, res) => {
  const id = Number(req.params.id);
  const allowedStatuses = new Set(['pending', 'resolved', 'ignored', 'manual']);
  const status = String(req.body.status || '').trim();
  const note = String(req.body.note || '').trim();

  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 格式錯誤' });
  if (!allowedStatuses.has(status)) return res.status(400).json({ error: '狀態格式錯誤' });

  try {
    const result = await pool.query(
      'UPDATE unanswered_questions SET status = $1, note = $2, updated_at = $3 WHERE id = $4',
      [status, note, new Date().toISOString(), id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: '找不到知識缺口紀錄' });
    res.json({ success: true });
  } catch (dbErr) {
    console.error('DB 更新知識缺口狀態失敗:', dbErr.message);
    res.status(500).json({ error: '知識缺口狀態更新失敗' });
  }
});

// ── 知識庫（分類版）─────────────────────────────────────────

// 取得所有分類（後台用）
app.get('/api/knowledge/sections', requireAdminKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, category, content, sort_order, updated_at FROM knowledge_sections ORDER BY sort_order ASC, id ASC'
    );
    res.json(rows);
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

// 新增一個分類
app.post('/api/knowledge/sections', requireAdminKey, async (req, res) => {
  const { category, content } = req.body;
  if (!category || typeof category !== 'string' || !category.trim())
    return res.status(400).json({ error: '分類名稱不可為空' });
  try {
    const { rows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM knowledge_sections');
    const sortOrder = Number(rows[0].next);
    const { rows: inserted } = await pool.query(
      'INSERT INTO knowledge_sections (category, content, sort_order, updated_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [category.trim(), String(content || ''), sortOrder, new Date().toISOString()]
    );
    await refreshKnowledgeCache();
    res.json({ success: true, id: inserted[0].id });
  } catch (dbErr) {
    console.error('DB 寫入失敗:', dbErr.message);
    res.status(500).json({ error: '新增失敗，請稍後再試' });
  }
});

// 修改一個分類
app.put('/api/knowledge/sections/:id', requireAdminKey, async (req, res) => {
  const id = Number(req.params.id);
  const { category, content } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 錯誤' });
  if (!category || typeof category !== 'string' || !category.trim())
    return res.status(400).json({ error: '分類名稱不可為空' });
  try {
    const result = await pool.query(
      'UPDATE knowledge_sections SET category = $1, content = $2, updated_at = $3 WHERE id = $4',
      [category.trim(), String(content || ''), new Date().toISOString(), id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: '找不到此分類' });
    await refreshKnowledgeCache();
    res.json({ success: true });
  } catch (dbErr) {
    console.error('DB 寫入失敗:', dbErr.message);
    res.status(500).json({ error: '儲存失敗，請稍後再試' });
  }
});

// 刪除一個分類
app.delete('/api/knowledge/sections/:id', requireAdminKey, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID 錯誤' });
  try {
    const result = await pool.query('DELETE FROM knowledge_sections WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: '找不到此分類' });
    await refreshKnowledgeCache();
    res.json({ success: true });
  } catch (dbErr) {
    console.error('DB 寫入失敗:', dbErr.message);
    res.status(500).json({ error: '刪除失敗，請稍後再試' });
  }
});

// （相容用）回傳整包知識庫文字
app.get('/api/knowledge', requireAdminKey, (req, res) => {
  res.json({ content: knowledgeCache });
});

// 對話紀錄搜尋
app.get('/api/search', requireAdminKey, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: '請輸入至少 2 個字' });
  try {
    const { rows: sessions } = await pool.query(`
      SELECT session_id, MIN(timestamp) AS started_at, COUNT(*) AS message_count
      FROM conversations WHERE content LIKE $1 GROUP BY session_id ORDER BY started_at DESC LIMIT 30
    `, [`%${q}%`]);
    const result = [];
    for (const s of sessions) {
      const { rows: messages } = await pool.query(
        'SELECT role, content, timestamp FROM conversations WHERE session_id = $1 ORDER BY timestamp ASC',
        [s.session_id]
      );
      result.push({ ...s, message_count: Number(s.message_count), messages });
    }
    res.json(result);
  } catch (dbErr) {
    console.error('搜尋失敗:', dbErr.message);
    res.status(500).json({ error: '搜尋失敗' });
  }
});

// ── 啟動伺服器（先建表 + 載入知識庫，再開始接請求）──────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await initDb();
    await syncKnowledgeFromImportFile();
    await refreshKnowledgeCache();
    app.listen(PORT, () => {
      console.log(`✅ ECOCO 客服伺服器啟動：http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ 啟動失敗：', err.message);
    console.error('請確認 DATABASE_URL 環境變數是否正確設定。');
    process.exit(1);
  }
})();
