require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic();

// ── JSON 檔案儲存（純 JS，不需要 native 套件）────────────
const DB_PATH = path.join(__dirname, 'ecoco_chat.json');

let db = { conversations: [], ratings: [] };
if (fs.existsSync(DB_PATH)) {
  try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) {}
}

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── 完整 ECOCO 知識庫 ──────────────────────────────────────
const KNOWLEDGE_BASE = `
【公司基本資訊】
品牌名稱：ECOCO 宜可可循環經濟
母公司：凡立橙股份有限公司（FUN LEAD CHANGE CO., LTD.）
品牌創立：2018年6月 | 公司登記：2022年
地址：台南市東區崇學路5號（No.5, Chongxue Rd., East Dist., Tainan City 701016, Taiwan）
品牌意涵：ECO（環保）+ Coin（貨幣）
核心口號：Play for home earth
官方網站：https://www.ecocogroup.com

【聯絡與客服資訊】
一般聯絡：App 內「我的」>「聯絡我們」填寫表單
Email：info@ecoco.xyz
FB Messenger：ECOCO 宜可可循環經濟官方粉絲頁
合作洽談：ecoco.mkt@ecocogroup.com
無對外客服電話
一般問題回覆時間：5～7 個工作日（特殊情況更長）
帳號轉換專線：週一至五 09:00-12:30 及 13:30-17:30

【服務數據】
服務次數：超過 170 萬次
全台站點：突破 1,000 站
瓶罐辨識再生率：95%
回收總量：超過 1,190 萬支寶特瓶
合作品牌：70+ 公益商家

【點數計算規則】
收瓶機：
- PET 寶特瓶（360~2000ml）= 2點
- 鋁罐（CAN）= 2點
- HDPE 牛奶瓶（高度25cm x 直徑12cm以內）= 2點
- PP 透明塑膠杯（360~1000ml）= 1點
電池機：
- 1號/2號/9V 方形乾電池 = 10點
- 3~6號乾電池 = 5點
點數有效期限：12個月，次年同月最後一日 23:59 到期，逾期自動歸零不補發不延長
點數不可轉讓、不可轉贈
不當獲取：首次警告停權，再犯永久註銷

【投瓶規則】
可投品項：PET 寶特瓶、CAN 鋁罐、PP 透明塑膠杯、HDPE 牛奶瓶
不可投：酒瓶、汽油桶、鋰電池、鐵罐（有磁性）
注意事項：
- 不可壓扁或切割（首次警告，再犯永久停權）
- 需清洗乾淨無殘液
- 需完全去除膠膜和封膜
- 瓶蓋分開投入機台右下方專用回收孔
- 依燈號一次投一瓶：綠燈投、藍燈停
- 每日投瓶無數量上限
- 正常入帳：即時
- 機台異常（黑屏/滿袋）：3～5 個工作天內補發，超過請聯絡客服

【投電池規則】
可投：1~6號及9V方形乾電池
不收：鋰電池、鈕扣電池、手機電池
投入前：外觀完整無凹陷、無鏽蝕、無漏液，擦拭乾淨
操作：一次投一顆，等螢幕顯示點數才繼續

【如何辨別鋁罐與鐵罐】
底部：鋁罐凹弧狀，鐵罐平面
軟硬：鋁罐軟易壓扁，鐵罐硬
磁性：鋁罐無磁性，鐵罐有磁性

【機台操作方式（不需手機）】
在機台螢幕輸入帳號（手機號碼）登入 → 依燈號投遞 → 點擊「完成」

【App 使用教學】
下載：App Store / Google Play 搜尋「ECOCO循環經濟」
註冊：輸入手機號碼 → 驗證碼 → 設定密碼（8~20字元，含英文字母及數字）+ Email
修改密碼：我的 > 帳號與安全 > 修改密碼（成功後需重新登入）
修改資料：我的 > 編輯個人資料（性別與生日僅可修改一次）
開啟定位 iOS：設定 > ECOCO > 位置 > 使用App期間 + 準確位置
開啟定位 Android：設定 > 應用程式管理 > ECOCO > 應用程式權限 > 位置 > 使用時允許
開啟推播：我的 > 通知設定，或點右上小鈴鐺 > 前往設定
帳號轉換（手機號碼停用）：聯絡我們填寫表單 → 客服致電核對
註銷帳號：我的 > 帳號與安全 > 申請刪除帳號（點數、優惠券永久歸零，不可復原）
收不到驗證碼：確認號碼正確、加入企業簡訊白名單、關閉攔截App

【公益商家兌換規則】
兌換方式：App 底部「兌換」> 選擇優惠 > 前往兌換 > 確認兌換
使用方式：現場掃碼 / 輸入核銷碼 / 外部連結（依各商家規定）
優惠券使用期限：各商家自訂，兌換前請詳閱注意事項

零售通路：
- 全聯福利中心：1,000點 = 50元折價券
- 全家便利商店：50點 = 500點 Fa點序號
- 家樂福：500點 = 50元現金抵用券
- 特力屋：250點 = 50元優惠序號
- 小北百貨：6點 = 1元折價
- 昇恆昌免稅店：200點 = 50元

餐飲：
- 迷客夏：2點 = 1元（最多折5元）
- 三商巧福、拿坡里披薩、福勝亭：20~30點 = 套餐折價券
- 必勝客、肯德基：20點 = 套餐折價券序號
- MR.拉麵（台南）：4點 = 1元

其他：
- 車麻吉停車：20點 = 30元停車折抵券
- Q哥3C：50點 = 折價券

【站點查詢】
即時查詢：App 底部「站點」頁面
非即時查詢：官網「服務」> 站點地圖（非即時，請以App為準）
已確認有站縣市：台南（首站城市）、新北、台北、台中、新竹、高雄、花蓮、澎湖、台東

【產品規格】
ECOCO Hub（收瓶機）：42支/分鐘，壓縮1/8，PET+PP 256L，鋁罐 139L，21.5吋觸控，1.1㎡
Battery Hub（電池機）：30顆/分鐘，約1,300顆容量，15吋觸控，0.192㎡
Multi Hub（整合機）：結合收瓶+電池，1.2㎡
ECOCO 循環方舟：大型城市資源循環站，2023年12月首站開放（家樂福仁德店）

【機台認養】
認養費：NT$693,000 含稅，合約 5 年
預估月收入：NT$11,880～39,600，回本年限 1.39～4.63 年
安裝工期：6～10 週
ECOCO負責：維護保養、回收物清運、App點數系統管理
適合場域：企業、學校、購物中心、社區（周邊2~3km無競爭機台）

【回收物去向】
寶特瓶：與南亞塑膠合作，再生為聚酯纖維（機能衣、環保袋等）
電池：由合法廠商處理，避免重金屬污染

【服務條款重點】
點數效期：12個月，次年同月最後一日23:59到期，逾期歸零不補發
禁止行為：投不可回收物、使用自動化軟體刷點、壓扁切割容器
損壞賠償：使用者須負擔全額維修費及營業損失
司法管轄：台灣法律，台南地方法院
交易紀錄保留：最近13個月，之後可能永久刪除

【紀念幣】
DAKA寶石幣：在花蓮縣台泥DAKA園區站點取得，限定指定商家兌換
計算方式與ECOCO點數相同，僅幣別不同

【公益捐款】
每年將會員捐贈點數以「每20點=1元」換算後捐出
114年（2025）：花蓮縣富里國中、國風國中
113年（2024）：台南市白河區白河國小
112年（2023）：國立台南大學附屬高級中學
111年（2022）：烏克蘭國際援助、伊甸社福基金會、國立新營高中
110年（2021）：台南市安南區安佃國小
109年（2020）：國立白河高級商工職業學校

【常見問題精選】
Q: 投瓶時機台一直退瓶怎麼辦？
A: 確認材質符合規則、瓶身完整無損液、去除膠膜，依燈號一次投一瓶。確認無誤仍被退5~10次，應停止並聯絡客服。

Q: 投瓶到一半機台出現黑屏或滿袋，點數會消失嗎？
A: 不會。3~5天內自動補發至帳號，超過時間請聯絡客服。

Q: 點數可以轉讓給朋友嗎？
A: 目前未提供轉移或轉贈點數服務。

Q: 瓶蓋要怎麼回收？
A: 在ECOCO應分開回收，將蓋放在機台右下方專用回收孔。

Q: 可以回收紙杯嗎？
A: 不收，紙杯屬「紙容器類」回收成本高，ECOCO目前未支援。

Q: 可以回收鈕扣電池或手機鋰電池嗎？
A: 不提供此服務，請交由便利商店或電信業者。

Q: 如何成為ECOCO公益商家？
A: 寄信至 ecoco.mkt@ecocogroup.com，說明合作意願。

Q: 如何成為ECOCO站點夥伴？
A: 企業、學校等有興趣合作，可來信至 ecoco.mkt@ecocogroup.com，ECOCO一週內回覆。
`;

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
app.post('/api/chat', async (req, res) => {
  const { history } = req.body;

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: '缺少對話紀錄' });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      // 系統提示詞含完整知識庫，啟用 prompt cache 節省成本
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: history
    });

    const reply = response.content.find(b => b.type === 'text')?.text
      ?? '抱歉，我暫時無法回應，請稍後再試。';

    // 儲存對話紀錄
    const sessionId = req.headers['x-session-id'] || 'unknown';
    const userMsg = history[history.length - 1];
    const ts = new Date().toISOString();
    db.conversations.push({ session_id: sessionId, role: 'user',      content: userMsg.content, timestamp: ts });
    db.conversations.push({ session_id: sessionId, role: 'assistant', content: reply,            timestamp: ts });
    saveDB();

    res.json({ reply });
  } catch (err) {
    console.error('Claude API 錯誤:', err.message);
    res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
  }
});

// ── 評分 API ─────────────────────────────────────────────
app.post('/api/rating', (req, res) => {
  const { msgId, type } = req.body;
  if (!msgId || !type) return res.status(400).json({ error: '缺少參數' });
  db.ratings.push({ msg_id: String(msgId), type, timestamp: new Date().toISOString() });
  saveDB();
  res.json({ success: true });
});

// ── 統計總覽 ─────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const sessionIds = new Set(db.conversations.map(c => c.session_id));
  res.json({
    totalSessions:   sessionIds.size,
    totalMessages:   db.conversations.length,
    positiveRatings: db.ratings.filter(r => r.type === 'positive').length,
    negativeRatings: db.ratings.filter(r => r.type === 'negative').length,
  });
});

// ── 每次對話的詳細紀錄 ───────────────────────────────────
app.get('/api/sessions', (req, res) => {
  const sessionMap = {};
  for (const conv of db.conversations) {
    if (!sessionMap[conv.session_id]) {
      sessionMap[conv.session_id] = {
        session_id: conv.session_id,
        messages:   [],
        started_at: conv.timestamp,
        last_at:    conv.timestamp,
      };
    }
    const s = sessionMap[conv.session_id];
    s.messages.push({ role: conv.role, content: conv.content, timestamp: conv.timestamp });
    if (conv.timestamp < s.started_at) s.started_at = conv.timestamp;
    if (conv.timestamp > s.last_at)    s.last_at    = conv.timestamp;
  }

  const result = Object.values(sessionMap)
    .map(s => ({ ...s, message_count: s.messages.length }))
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  res.json(result);
});

// ── 最常被問的關鍵字 Top 10 ──────────────────────────────
app.get('/api/top-questions', (req, res) => {
  const userMessages = db.conversations.filter(c => c.role === 'user');
  const keywordList  = ['點數', '兌換', '寶特瓶', '電池', '全聯', '全家', '家樂福',
                        '站點', 'App', '帳號', '密碼', '壓扁', '期限', '合作'];

  const keywords = {};
  userMessages.forEach(msg => {
    keywordList.forEach(kw => {
      if (msg.content.includes(kw)) keywords[kw] = (keywords[kw] || 0) + 1;
    });
  });

  const sorted = Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .map(([keyword, count]) => ({ keyword, count }));

  res.json(sorted);
});

// ── 啟動伺服器 ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ ECOCO 客服伺服器啟動：http://localhost:${PORT}`);
});
