require('dotenv').config();
const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');
const crypto    = require('crypto');
const Database  = require('better-sqlite3');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic();

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

// ── Fix 2：資料庫初始化 + Index 加速查詢 ──────────────────
const db = new Database(path.join(__dirname, 'ecoco_chat.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    timestamp  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    msg_id    TEXT NOT NULL,
    type      TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
  CREATE INDEX IF NOT EXISTS idx_conv_role    ON conversations(role);
  CREATE INDEX IF NOT EXISTS idx_ratings_type ON ratings(type);
`);

// ── Fix 1：Prepared statements 啟動時建立一次，不在 request 內重複 prepare ──
const stmts = {
  insertConv:       db.prepare('INSERT INTO conversations (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)'),
  insertRating:     db.prepare('INSERT INTO ratings (msg_id, type, timestamp) VALUES (?, ?, ?)'),
  countSessions:    db.prepare('SELECT COUNT(DISTINCT session_id) AS count FROM conversations'),
  countMessages:    db.prepare('SELECT COUNT(*) AS count FROM conversations'),
  countPositive:    db.prepare("SELECT COUNT(*) AS count FROM ratings WHERE type = 'positive'"),
  countNegative:    db.prepare("SELECT COUNT(*) AS count FROM ratings WHERE type = 'negative'"),
  listSessions:     db.prepare(`
    SELECT session_id,
           COUNT(*)       AS message_count,
           MIN(timestamp) AS started_at,
           MAX(timestamp) AS last_at
    FROM conversations
    GROUP BY session_id
    ORDER BY started_at DESC
  `),
  listMessages:     db.prepare('SELECT role, content, timestamp FROM conversations WHERE session_id = ? ORDER BY timestamp ASC'),
  listUserMessages: db.prepare("SELECT content FROM conversations WHERE role = 'user'"),
};

// ── Fix 5：知識庫獨立成 knowledge.js，方便更新，不污染本檔 ─
const KNOWLEDGE_BASE = require('./knowledge');

const SYSTEM_PROMPT = `你是 ECOCO 宜可可循環經濟的官方 AI 客服助理。

## 你的任務
根據以下知識庫，用友善、簡潔的方式回答用戶問題。

## 知識庫
${KNOWLEDGE_BASE}

## 回答規則

### 語言
- 永遠使用繁體中文回答
- 語氣友善，適當使用 emoji（每則回答最多 2 個）

### 格式
- 簡短問題：1-3 句話回答即可
- 複雜問題（如點數規則、操作步驟）：使用條列式或表格
- 數字資訊（點數、費用、時間）：用粗體標示 **重點**

### 最重要的規則：不確定就說不確定
- 只根據知識庫內容回答
- 如果知識庫沒有明確答案，請說：
  「這個問題我沒有確切資料，建議您直接聯絡 ECOCO 官方客服：
   📧 info@ecoco.xyz（5-7 個工作日內回覆）
   或透過 App 內「我的」>「聯絡我們」提交表單」
- 絕對不要猜測或編造答案

### 特定情境處理
- 用戶抱怨或情緒激動：先表達同理心，再提供解決方案
- 用戶問競爭對手：只介紹 ECOCO，不評論其他品牌
- 用戶問優惠或折扣：說明現有點數兌換制度，不承諾額外優惠`;

// ── API 路由 ──────────────────────────────────────────────

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
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: history,
    });

    const reply = response.content.find(b => b.type === 'text')?.text
      ?? '抱歉，我暫時無法回應，請稍後再試。';

    // Fix 1 + Fix 4：使用 stmts，並加 try/catch 避免 DB 錯誤 crash server
    try {
      const sessionId = req.headers['x-session-id'] || 'unknown';
      const userMsg   = history[history.length - 1];
      const ts        = new Date().toISOString();
      stmts.insertConv.run(sessionId, 'user',      userMsg.content, ts);
      stmts.insertConv.run(sessionId, 'assistant', reply,           ts);
    } catch (dbErr) {
      console.error('DB 寫入失敗（不影響回覆）:', dbErr.message);
    }

    res.json({ reply });
  } catch (err) {
    console.error('Claude API 錯誤:', err.message);
    res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
  }
});

app.post('/api/rating', (req, res) => {
  const { msgId, type } = req.body;
  if (!msgId || !type) return res.status(400).json({ error: '缺少參數' });
  // Fix 4：DB error handling
  try {
    stmts.insertRating.run(String(msgId), type, new Date().toISOString());
    res.json({ success: true });
  } catch (dbErr) {
    console.error('DB 寫入失敗:', dbErr.message);
    res.status(500).json({ error: '儲存失敗，請稍後再試' });
  }
});

app.get('/api/stats', requireAdminKey, (req, res) => {
  // Fix 1 + Fix 4
  try {
    const { count: totalSessions   } = stmts.countSessions.get();
    const { count: totalMessages   } = stmts.countMessages.get();
    const { count: positiveRatings } = stmts.countPositive.get();
    const { count: negativeRatings } = stmts.countNegative.get();
    res.json({ totalSessions, totalMessages, positiveRatings, negativeRatings });
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.get('/api/sessions', requireAdminKey, (req, res) => {
  // Fix 1 + Fix 4
  try {
    const sessions = stmts.listSessions.all();
    const result   = sessions.map(s => ({
      ...s,
      messages: stmts.listMessages.all(s.session_id),
    }));
    res.json(result);
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.get('/api/top-questions', requireAdminKey, (req, res) => {
  // Fix 1 + Fix 4
  try {
    const userMessages = stmts.listUserMessages.all();
    const keywordList  = ['點數', '兌換', '寶特瓶', '電池', '全聯', '全家', '家樂福',
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

// ── 啟動伺服器 ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ ECOCO 客服伺服器啟動：http://localhost:${PORT}`);
});
