require('dotenv').config();
const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');
const fs        = require('fs');
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
  CREATE TABLE IF NOT EXISTS unanswered_questions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    question   TEXT NOT NULL,
    timestamp  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_session  ON conversations(session_id);
  CREATE INDEX IF NOT EXISTS idx_conv_role     ON conversations(role);
  CREATE INDEX IF NOT EXISTS idx_ratings_type  ON ratings(type);
  CREATE INDEX IF NOT EXISTS idx_unanswered_ts ON unanswered_questions(timestamp);
`);

// 舊資料庫遷移：ratings 補上 question / reply 欄位
try { db.exec("ALTER TABLE ratings ADD COLUMN question TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE ratings ADD COLUMN reply TEXT DEFAULT ''");    } catch {}

// ── Fix 1：Prepared statements 啟動時建立一次，不在 request 內重複 prepare ──
const stmts = {
  insertConv:       db.prepare('INSERT INTO conversations (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)'),
  insertRating:     db.prepare('INSERT INTO ratings (msg_id, type, timestamp, question, reply) VALUES (?, ?, ?, ?, ?)'),
  listRatings:      db.prepare("SELECT type, question, reply, timestamp FROM ratings WHERE question != '' ORDER BY timestamp DESC LIMIT 50"),
  insertUnanswered: db.prepare('INSERT INTO unanswered_questions (session_id, question, timestamp) VALUES (?, ?, ?)'),
  countUnanswered:  db.prepare('SELECT COUNT(*) AS count FROM unanswered_questions'),
  listUnanswered:   db.prepare('SELECT session_id, question, timestamp FROM unanswered_questions ORDER BY timestamp DESC LIMIT 100'),
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

// ── 知識庫（let 讓後台可動態更新）────────────────────────
let KNOWLEDGE_BASE = require('./knowledge');

function buildSystemPrompt() { return `你是 ECOCO 宜可可循環經濟的官方 AI 客服助理。

## 你的任務
根據以下知識庫，用友善、簡潔的方式回答用戶問題。

## 知識庫
${KNOWLEDGE_BASE}

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
- 純資訊查詢（點數規則、操作步驟）用條列 `-` 或表格
- 數字與重點用粗體 **粗體** 標示
- 多步驟操作用編號 `1.` `2.` `3.`
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
      system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
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

      // 未被回答問題歸檔
      if (reply.includes('沒有確切資料')) {
        stmts.insertUnanswered.run(sessionId, userMsg.content, ts);
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

app.post('/api/rating', (req, res) => {
  const { msgId, type, question, reply } = req.body;
  if (!msgId || !type) return res.status(400).json({ error: '缺少參數' });
  try {
    stmts.insertRating.run(
      String(msgId),
      type,
      new Date().toISOString(),
      String(question || '').substring(0, 300),
      String(reply    || '').substring(0, 300),
    );
    res.json({ success: true });
  } catch (dbErr) {
    console.error('DB 寫入失敗:', dbErr.message);
    res.status(500).json({ error: '儲存失敗，請稍後再試' });
  }
});

app.get('/api/ratings', requireAdminKey, (req, res) => {
  try {
    res.json(stmts.listRatings.all());
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

app.get('/api/stats', requireAdminKey, (req, res) => {
  // Fix 1 + Fix 4
  try {
    const { count: totalSessions   } = stmts.countSessions.get();
    const { count: totalMessages   } = stmts.countMessages.get();
    const { count: positiveRatings } = stmts.countPositive.get();
    const { count: negativeRatings } = stmts.countNegative.get();
    const { count: unansweredCount } = stmts.countUnanswered.get();
    res.json({ totalSessions, totalMessages, positiveRatings, negativeRatings, unansweredCount });
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

// 知識缺口列表
app.get('/api/unanswered', requireAdminKey, (req, res) => {
  try {
    res.json(stmts.listUnanswered.all());
  } catch (dbErr) {
    console.error('DB 查詢失敗:', dbErr.message);
    res.status(500).json({ error: '資料庫查詢失敗' });
  }
});

// 知識庫讀取
app.get('/api/knowledge', requireAdminKey, (req, res) => {
  res.json({ content: KNOWLEDGE_BASE });
});

// 知識庫儲存（立即生效，不需重啟）
app.post('/api/knowledge', requireAdminKey, express.text({ limit: '500kb' }), (req, res) => {
  const content = req.body;
  if (typeof content !== 'string' || content.trim().length === 0)
    return res.status(400).json({ error: '內容不可為空' });

  const knowledgePath = path.join(__dirname, 'knowledge.js');
  const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const newFile = `// ECOCO 官方知識庫\n// 後台儲存後立即生效\n\nmodule.exports = \`${escaped}\`;\n`;

  try {
    fs.writeFileSync(knowledgePath, newFile, 'utf-8');
    delete require.cache[require.resolve('./knowledge')];
    KNOWLEDGE_BASE = require('./knowledge');
    console.log('知識庫已更新，長度：', KNOWLEDGE_BASE.length);
    res.json({ success: true });
  } catch (err) {
    console.error('知識庫更新失敗:', err.message);
    res.status(500).json({ error: '儲存失敗，請稍後再試' });
  }
});

// 對話紀錄搜尋
const searchStmt = db.prepare(`
  SELECT DISTINCT session_id, MIN(timestamp) AS started_at, COUNT(*) AS message_count
  FROM conversations WHERE content LIKE ? GROUP BY session_id ORDER BY started_at DESC LIMIT 30
`);
app.get('/api/search', requireAdminKey, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: '請輸入至少 2 個字' });
  try {
    const sessions = searchStmt.all(`%${q}%`);
    res.json(sessions.map(s => ({ ...s, messages: stmts.listMessages.all(s.session_id) })));
  } catch (dbErr) {
    console.error('搜尋失敗:', dbErr.message);
    res.status(500).json({ error: '搜尋失敗' });
  }
});

// ── 啟動伺服器 ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ ECOCO 客服伺服器啟動：http://localhost:${PORT}`);
});
