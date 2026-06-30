# ECOCO AI Customer Service

ECOCO AI Customer Service 是一套提供 ECOCO 使用者即時客服回覆、內部知識庫維護、知識缺口追蹤與營運報表的 AI 客服系統。

系統以 Node.js、Express、PostgreSQL、Claude API 與 RAG 檢索流程組成。客服回答會先查詢 ECOCO 知識庫，再由模型依照品牌語氣與風險規則產生回覆。

## 文件入口

| 文件 | 對象 | 用途 |
| --- | --- | --- |
| [內部文件索引](docs/README.md) | 所有人 | 快速找到對應文件 |
| [客服人員操作指南](docs/CUSTOMER_SUPPORT_GUIDE.md) | 客服、營運 | 日常後台操作、知識缺口、回覆風險 |
| [PRD](docs/PRD_ECOCO_AI_CUSTOMER_SERVICE.md) | 主管、PM、維護者 | 產品目標、功能範圍、成功指標 |
| [客服 Flow 圖底稿](docs/CUSTOMER_SERVICE_FLOW.md) | PM、主管、維護者 | Whimsical 流程圖繪製依據 |
| [維運與交接手冊](docs/OPERATIONS_HANDOFF_GUIDE.md) | 維護者、工程協作者 | 部署、資料庫、交接與例行維護 |
| [部署與環境手冊](docs/DEPLOYMENT_RUNBOOK.md) | 維護者 | Render、API key、PostgreSQL、健康檢查 |
| [資料字典](docs/DATA_DICTIONARY.md) | 維護者、工程協作者 | PostgreSQL 資料表與 JSON 檔案說明 |
| [資料來源清單](docs/DATA_SOURCES.md) | 維護者、客服主管 | 知識來源、使用限制與更新原則 |

## 系統功能

- 使用者可在前台詢問 ECOCO 服務、點數、站點、回收規則與 App 使用問題。
- AI 會根據 PostgreSQL 知識庫與 RAG chunks 產生回答。
- 高風險問題會套用保守回答規則，避免承諾補點、退款、補償或已完成處理。
- 後台可查看對話紀錄、使用者評分、知識缺口與主管報表。
- 後台可新增、修改、封存知識，並匯出目前 PostgreSQL 知識庫為 JSON。
- 知識庫資料可透過 Git JSON 保存正式版本，方便交接與回復。

## 系統架構

```text
使用者前台
  -> Express API
  -> PostgreSQL knowledge_sections / knowledge_chunks
  -> Claude API
  -> AI 回覆
  -> conversations / ratings / unanswered_questions
  -> 後台 dashboard
```

| 元件 | 說明 |
| --- | --- |
| `server.js` | 後端入口、服務啟動、資料庫初始化與 route 註冊 |
| `routes/` | API 模組，包含聊天、後台、知識庫、報表與知識缺口 |
| `services/` | RAG、prompt、隱私遮罩與報表邏輯 |
| `db/schema.js` | PostgreSQL 資料表 schema |
| `public/index.html` | 使用者端 AI 客服前台 |
| `public/dashboard.html` | 內部客服後台 |
| `data/ecoco-knowledge-import.json` | 可匯入 PostgreSQL 的正式知識包 |
| `data/ecoco-ai-customer-service-database.json` | 知識整合底稿與來源紀錄 |

## 環境需求

- Node.js 20+
- npm
- PostgreSQL database URL
- Anthropic API key
- Admin key
- OpenAI API key，選填，用於 embedding 語意檢索

## 本地啟動

```bash
npm install
copy .env.example .env
npm start
```

本地預設網址：

| 頁面 | URL |
| --- | --- |
| 客服前台 | `http://localhost:3000` |
| 後台 | `http://localhost:3000/dashboard.html` |
| 健康檢查 | `http://localhost:3000/healthz` |
| 管理者詳細狀態 | `http://localhost:3000/api/system/status`，需 `x-admin-key` |

## 環境變數

| 變數 | 必要性 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | 必填 | PostgreSQL 連線字串 |
| `ANTHROPIC_API_KEY` | 必填 | Claude API key |
| `ADMIN_KEY` | 必填 | 後台與管理 API 權限 |
| `OPENAI_API_KEY` | 建議 | 啟用 embedding 與 pgvector 語意檢索 |
| `KNOWLEDGE_AUTO_SYNC` | 選填 | 控制 Git JSON 是否於啟動時同步到 PostgreSQL |
| `REBUILD_KNOWLEDGE_CHUNKS_ON_START` | 選填 | 設為 `always` 時強制重建 RAG chunks |
| `CONVERSATION_RETENTION_DAYS` | 選填 | 對話紀錄保存天數 |
| `PGSSL` | 視環境 | PostgreSQL SSL 設定 |

機密資料不得提交到 GitHub 或 GitLab，只能放在 Render Environment Variables 或本機 `.env`。

## 常用指令

```bash
npm.cmd run lint
npm.cmd test
npm.cmd run scan:pii
npm.cmd run build:knowledge
npm.cmd run audit:knowledge
```

## 知識庫維護原則

PostgreSQL 是線上實際執行資料庫，AI 會讀取其中的 `knowledge_sections` 與 `knowledge_chunks`。

Git 裡的 `data/ecoco-knowledge-import.json` 是正式版本備份，不會因為後台修改而自動更新。重大改版、交接或備份前，請從後台下載 JSON，人工確認後放回 Git 並 commit / push。

日常小修可直接在後台進行；重大版本更新需回寫 Git。

## 安全原則

- 不提交 API key、token、資料庫密碼或 `.env`。
- 不提交真實手機、Email、會員資料或可識別個資。
- 高風險客服問題不可讓 AI 承諾補點、退款、賠償或已完成處理。
- 對話紀錄與使用者輸入需進行個資遮罩與保存期限評估。

## 專案狀態

目前系統已具備可運作的客服前台、內部後台、PostgreSQL 知識庫、RAG 檢索、知識缺口紀錄、使用者評分、主管報表與部署文件。後續重點為知識品質維護、語意檢索穩定性、資料保存政策與正式營運流程。
