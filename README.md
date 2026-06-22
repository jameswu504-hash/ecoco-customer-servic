# ECOCO AI 客服系統

基於 Claude API 的 ECOCO 智慧客服，整合官方知識庫、對話紀錄、滿意度評分、知識缺口追蹤與後台儀表板。

## 內部維護文件

給 ECOCO 內部同仁、客服、營運與維護者閱讀的文件請從這裡開始：

- [docs/README.md](docs/README.md)：內部文件入口與建議閱讀順序
- [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)：專案總覽與系統流程
- [docs/CUSTOMER_SUPPORT_GUIDE.md](docs/CUSTOMER_SUPPORT_GUIDE.md)：一般客服人員操作指南
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)：AI 客服目前使用的資料來源
- [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)：PostgreSQL 與 JSON 欄位說明
- [docs/MAINTENANCE_GUIDE.md](docs/MAINTENANCE_GUIDE.md)：每週維護、知識缺口、回覆品質檢查
- [docs/OPERATIONS_HANDOFF_GUIDE.md](docs/OPERATIONS_HANDOFF_GUIDE.md)：使用、SQL、部署、更新資料與檔案用途總整理
- [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md)：Render 部署與環境變數設定
- [docs/META_AI_INSTRUCTIONS.md](docs/META_AI_INSTRUCTIONS.md)：Meta AI 指令來源整理與維護方式
- [docs/RAG_WORKFLOW.md](docs/RAG_WORKFLOW.md)：RAG 第一版與 PostgreSQL chunks 檢索流程

## 功能

- AI 回答以後台分類知識庫為主，避免自行編造資訊
- AI 回答前會先從 PostgreSQL `knowledge_chunks` 檢索相關知識片段，再交給 Claude 回答
- 即時客服對話，支援 Markdown 回覆
- 每則 AI 回答可送出滿意度評分
- 後台可查看統計、對話紀錄、評分明細與知識缺口
- 後台可新增、修改、刪除知識庫分類，更新後立即生效
- PostgreSQL 持久化儲存對話、評分、知識缺口與知識庫內容
- Rate limiting、Admin Key、輸入驗證與前端 XSS 防護

## 技術

| 項目 | 技術 |
| --- | --- |
| 後端 | Node.js + Express |
| AI | Anthropic Claude API |
| 資料庫 | PostgreSQL (`pg`) |
| 前端 | HTML + CSS + JavaScript |
| Markdown | marked.js + DOMPurify |
| 安全 | express-rate-limit |

## 環境需求

- Node.js 18+
- npm
- PostgreSQL database URL, 例如 Neon / Supabase / Render Postgres
- Anthropic API Key

## 快速開始

```bash
npm install
cp .env.example .env
npm start
```

在 `.env` 填入：

| 變數 | 說明 | 必填 |
| --- | --- | :---: |
| `ANTHROPIC_API_KEY` | Anthropic API key | 是 |
| `ANTHROPIC_MODEL` | Claude model，未填時使用程式預設值 | 否 |
| `DATABASE_URL` | PostgreSQL 連線字串 | 是 |
| `PGSSL` | SSL 設定；雲端 Postgres 通常使用 `require`，內部連線可設 `disable` | 否 |
| `ADMIN_KEY` | 後台登入密鑰 | 是 |
| `PORT` | 伺服器 port，預設 `3000` | 否 |

啟動後：

| 頁面 | URL |
| --- | --- |
| 客服介面 | `http://localhost:3000` |
| 後台儀表板 | `http://localhost:3000/dashboard.html` |

## API

| 方法 | 路徑 | 說明 | 權限 |
| --- | --- | --- | --- |
| `POST` | `/api/chat` | 送出對話並取得 AI 回覆 | 無 |
| `POST` | `/api/rating` | 送出滿意度評分 | 無 |
| `GET` | `/api/stats` | 統計總覽 | Admin Key |
| `GET` | `/api/sessions` | 對話紀錄 | Admin Key |
| `GET` | `/api/top-questions` | 熱門關鍵字 | Admin Key |
| `GET` | `/api/ratings` | 評分明細 | Admin Key |
| `GET` | `/api/unanswered` | 知識缺口紀錄 | Admin Key |
| `PATCH` | `/api/unanswered/:id` | 更新知識缺口狀態與備註 | Admin Key |
| `GET` | `/api/knowledge/overview` | 知識庫資料來源與同步狀態總覽 | Admin Key |
| `GET` | `/api/knowledge/sections` | 取得知識庫分類 | Admin Key |
| `POST` | `/api/knowledge/sections` | 新增知識庫分類 | Admin Key |
| `PUT` | `/api/knowledge/sections/:id` | 更新知識庫分類 | Admin Key |
| `DELETE` | `/api/knowledge/sections/:id` | 刪除知識庫分類 | Admin Key |
| `GET` | `/api/search?q=...` | 搜尋對話紀錄 | Admin Key |

## 匯入 ECOCO FAQ / 回覆規則

已整理的 ECOCO FAQ 與回覆規則可透過 JSON 匯入 PostgreSQL：

```bash
npm run import:knowledge
```

若要清空現有分類並完全改用整理後資料：

```bash
npm run import:knowledge -- data/ecoco-knowledge-import.json --replace
```

整理來源與注意事項請見 `docs/knowledge-import.md`。

## 知識缺口如何判斷與記錄

系統 prompt 明確要求 AI：如果知識庫沒有明確答案，必須回覆「這個問題我沒有確切資料...」並引導使用者透過 ECOCO 客服表單或 App 聯絡專人。

後端收到 AI 回覆後，會用 `detectKnowledgeGap(reply)` 檢查回覆是否包含知識缺口標記，例如：

- `沒有確切資料`
- `沒有明確答案`
- `沒有相關資料`
- `建議您透過客服表單`
- `App 內「我的」>「聯絡我們」`

只要命中標記，就會寫入 `unanswered_questions`：

- `session_id`：這次對話 session
- `question`：使用者原始問題
- `reply`：AI 當時的回覆
- `reason`：命中的判斷原因
- `timestamp`：記錄時間

後台的「知識缺口列表」會顯示這些資料，方便管理者回頭補知識庫分類。

## 資料庫初始化

啟動時會自動建立需要的資料表：

- `conversations`
- `ratings`
- `unanswered_questions`
- `knowledge_sections`
- `knowledge_chunks`

如果 `knowledge_sections` 是空的，系統會從 `knowledge.js` 匯入初始分類，之後後台修改會寫回 PostgreSQL。

後台修改若要整理回 Git JSON，可用 Admin API `GET /api/knowledge/export` 匯出 PostgreSQL 目前知識庫，再人工檢查後回寫到 `data/ecoco-knowledge-import.json`。

目前建議的簡易維護模式是：日常只在後台修改知識庫，Render 設定 `KNOWLEDGE_AUTO_SYNC=disable`。大改版、交接或備份前，記得從後台下載 JSON，人工確認後放回 GitHub 並 commit / push。

## 專案結構

```text
.
├── server.js              # Express 後端入口
├── config/                # RAG 關鍵字、同義詞與設定
├── db/                    # PostgreSQL schema
├── middleware/            # Admin Key 等中介層
├── knowledge.js           # 初始知識庫分類種子資料
├── data/                  # AI 客服資料庫、匯入 JSON、回覆政策
├── docs/                  # 內部維護文件、PRD、Flow 圖規劃
├── scripts/               # 知識庫整理與匯入工具
├── package.json
├── .env.example
└── public/
    ├── index.html         # 客服對話介面
    └── dashboard.html     # 後台儀表板
```
