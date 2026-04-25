# ECOCO 宜可可 AI 客服系統

> 基於 Claude AI 的智慧客服，整合官方知識庫、對話紀錄、滿意度評分與後台儀表板

---

## 功能特色

- 🤖 AI 回答完全基於官方知識庫，不編造資訊
- 💬 即時對話，支援 Markdown 格式回覆（表格、條列、粗體）
- 👍👎 每則回答都可評分，後台即時統計滿意率
- 📊 後台儀表板：對話紀錄、熱門關鍵字排行、滿意度長條圖
- 🗄️ SQLite 資料庫持久化儲存所有對話與評分
- 🔒 Rate Limiting、Admin API 保護、XSS 防護、輸入驗證

---

## 技術架構

| 層級 | 技術 |
|------|------|
| 後端 | Node.js + Express |
| AI | Anthropic Claude API（`claude-opus-4-7`）|
| 資料庫 | SQLite（better-sqlite3）|
| 前端 | 原生 HTML + CSS + JavaScript |
| Markdown | marked.js + DOMPurify |
| 安全 | express-rate-limit |

---

## 快速開始

### 環境需求

- Node.js 18+
- npm
- [Anthropic API Key](https://console.anthropic.com/)

### 安裝步驟

```bash
# 1. 安裝套件
npm install

# 2. 設定環境變數
cp .env.example .env
# 用文字編輯器開啟 .env，填入 ANTHROPIC_API_KEY 和 ADMIN_KEY

# 3. 啟動伺服器
npm start
```

### 開啟瀏覽器

| 頁面 | 網址 |
|------|------|
| 客服介面 | http://localhost:3000 |
| 後台儀表板 | http://localhost:3000/dashboard.html |

> 後台需輸入 `.env` 裡設定的 `ADMIN_KEY` 才能登入

---

## 環境變數

複製 `.env.example` 為 `.env` 並填入以下變數：

| 變數 | 說明 | 必填 |
|------|------|:----:|
| `ANTHROPIC_API_KEY` | Anthropic 平台的 API 金鑰 | ✅ |
| `ADMIN_KEY` | 後台儀表板登入密鑰（自訂任意字串） | ✅ |
| `PORT` | 伺服器 Port（預設 3000） | ❌ |

---

## API 文件

| 方法 | 路由 | 說明 | 認證 |
|------|------|------|------|
| `POST` | `/api/chat` | 送出問題，取得 AI 回答 | 無 |
| `POST` | `/api/rating` | 送出滿意度評分 | 無 |
| `GET` | `/api/stats` | 統計總覽 | Admin Key |
| `GET` | `/api/sessions` | 對話詳細紀錄 | Admin Key |
| `GET` | `/api/top-questions` | 熱門關鍵字排行 | Admin Key |

### `/api/chat` 請求格式

```json
POST /api/chat
Headers: { "x-session-id": "session_xxx" }

{
  "history": [
    { "role": "user", "content": "點數有效期限是多久？" }
  ]
}
```

限制：對話歷史最多 **20 則**，每則訊息最多 **2000 字**，每個 IP 每分鐘最多 **10 次**請求。

### Admin API 請求格式

```bash
curl http://localhost:3000/api/stats \
  -H "x-admin-key: 你的ADMIN_KEY"
```

---

## 安全性設計

| 機制 | 實作方式 |
|------|---------|
| Rate Limiting | 每 IP 每分鐘上限 10 次 `/api/chat` 請求 |
| Admin 保護 | `/api/stats`、`/api/sessions`、`/api/top-questions` 需帶 `x-admin-key` header |
| XSS 防護 | AI 回覆用 DOMPurify 清洗；後台用 escapeHtml 跳脫 |
| 輸入驗證 | 限制 history 長度、訊息字數、role 格式 |

---

## 專案結構

```
ecoco-customer-service/
├── server.js           # 後端主程式（Express + Claude API + SQLite）
├── migrate.js          # 一次性遷移腳本（JSON → SQLite）
├── package.json
├── .env.example        # 環境變數範本
├── .gitignore
└── public/
    ├── index.html      # 客服對話介面
    └── dashboard.html  # 後台儀表板
```

---

## 授權

MIT
