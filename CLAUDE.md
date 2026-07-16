# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 指令

```bash
npm start                   # 啟動伺服器（production）
npm run dev                 # 開發模式（node --watch 熱重載）

npm run audit:knowledge     # 掃描 data/ 知識庫，找出重複與衝突
npm run apply:knowledge-audit  # 將稽核結果套用（把重複項標為 archived，不刪除）
npm run build:knowledge     # 從 data/ 組出 ecoco-knowledge-import.json
npm run import:knowledge    # 把 ecoco-knowledge-import.json 匯入 PostgreSQL

npm run lint                # 語法檢查（scripts/lint.mjs 自動掃描所有 .js/.mjs）
npm test                    # 執行 tests/smoke.test.js（node --test）
npm run eval:validate       # 驗證 evals/golden-set.json 格式
npm run eval                # 對線上服務跑 golden set（需設 ECOCO_BASE_URL、ADMIN_KEY）
npm run scan:pii            # 掃描 repo 是否含個資
```

**修改程式碼後必須執行 `npm run lint` 與 `npm test`，全數通過才能 commit。**CI（.github/workflows/ci.yml）會再跑一次 lint、test、eval:validate、scan:pii。

啟動需要 `.env`：

```
ANTHROPIC_API_KEY=...
ADMIN_KEY=...
DATABASE_URL=postgresql://...
KNOWLEDGE_AUTO_SYNC=disable       # 日常維護只用後台 PostgreSQL；大改版才匯出 JSON 回 Git
# PGSSL=disable                   # Render 內部連線時啟用
```

## 架構

### 兩層知識資料

系統有兩個知識來源，必須理解兩者的關係才能正確維護：

| 層 | 檔案 | 說明 |
|---|---|---|
| Git JSON（版本控制層） | `data/ecoco-ai-customer-service-database.json` | 主要編輯來源，含版本、衝突追蹤、878 筆紀錄 |
| PostgreSQL（執行層） | `knowledge_sections` + `knowledge_chunks` | 伺服器實際讀取的資料 |

**日常更新流程：** 在後台新增、修改、封存或恢復知識，資料直接寫入 PostgreSQL。  
**正式版本流程：** 大改版、交接或備份前，從後台下載 JSON，人工確認後覆蓋 `data/ecoco-knowledge-import.json`，再 commit / push。  
**注意：** 後台直接編輯不會回寫 Git JSON，Render 預設也不會自動用 Git JSON 覆蓋 PostgreSQL。

### `server.js` 的啟動順序

1. `validateRuntimeConfig()` — 檢查必要環境變數，缺 `DATABASE_URL`／`ANTHROPIC_API_KEY`／`ADMIN_KEY` 直接啟動失敗
2. `initDb()` — 逐一執行 SCHEMA 建表（雲端 Postgres 不接受多語句，故分開執行），並跑 timestamp 欄位遷移與 pgvector 初始化
3. `KNOWLEDGE_AUTO_SYNC` 決定是否從 Git JSON 同步進 PostgreSQL
4. `refreshKnowledgeCache()` — 把 `knowledge_sections` 載入記憶體（僅供後台檢視，不進 prompt）
5. `ensureKnowledgeChunksReady()` — chunks 為空或同步有變更時重建 `knowledge_chunks`
6. `purgeExpiredConversationData()` — 依 `CONVERSATION_RETENTION_DAYS` 清除過期對話
7. 開始接請求

### RAG 流程

`/api/chat` 收到問題後：
1. 檢索 `knowledge_chunks`：主要走 pgvector 語意檢索（需 `vector` extension + `OPENAI_API_KEY`），關鍵字／同義詞 `ILIKE` 檢索作為備援或混合來源，排序後取前 8 筆片段（`MAX_RAG_CHUNKS`）
2. 靜態 system prompt 標記 `cache_control: ephemeral` 啟用 prompt caching；RAG 片段放在動態區塊
3. 呼叫 Claude（預設 `claude-sonnet-4-6`，可用 `ANTHROPIC_MODEL` 環境變數覆蓋，`max_tokens: 1024`）

`knowledge_chunks` 是從 `knowledge_sections` 自動切分的衍生資料，**不要手動編輯**。每次後台修改分類或伺服器重啟都會重建。

### 知識缺口偵測

偵測順序：優先解析回覆結尾的 `<meta>{"gap":...}</meta>` JSON 標記，其次是 `[KNOWLEDGE_GAP]` 機器標記，最後才是「沒有確切資料」等字串比對（見 `routes/chat.routes.js` 的 `detectKnowledgeGap`）。命中即寫一筆到 `unanswered_questions`；標記在送給使用者前會被移除。DB 寫入失敗不中斷對話（內層獨立 try/catch）。

### KNOWLEDGE_AUTO_SYNC 模式

| 模式 | 行為 |
|---|---|
| `disable`（預設） | 不同步 Git JSON；日常以後台 PostgreSQL 為準 |
| `insert_only` | 只新增 Git JSON 裡沒有的分類，保留後台編輯 |
| `upsert` | 新增 + 更新已存在的分類 |
| `replace` | 清空 PostgreSQL 知識，完整以 Git JSON 取代 |

### Admin 保護

`requireAdminKey` 用 `crypto.timingSafeEqual` 比較，防計時攻擊。後台所有 `/api/knowledge/*`、`/api/stats`、`/api/sessions`、`/api/unanswered` 等均需帶 `x-admin-key` header。

### Dashboard API 與知識編輯

- `/api/sessions` 已分頁，回傳 `{ total, limit, offset, sessions }`，其中 `sessions` 只含對話摘要與訊息數；單場訊息由 `/api/session-messages?session_id=` 懶載入。`/api/search` 維持舊行為，仍回傳含 `messages` 的完整搜尋結果。
- `public/kb-parser.js` 是後台知識庫分題解析器，以 `### ` 行切割題目，並保證 `assembleKbContent(parseKbContent(x)) === x`。儲存流程仍以完整 `knowledge_sections.content` 字串為準，不改資料庫 schema。

## 重要規則

**修改前先說明：** 任何影響 AI 回覆行為、資料同步邏輯、部署設定或 Git 歷史的變更，必須先向使用者解釋，再執行。

**高風險類別（response-policies）：** 點數、兌換券、機台錯誤、帳號、客訴等類別有保守回答規則。觸發條件是 chunks 被標記為 high-risk 或使用者明確提到補償意圖，不是「點數」「帳號」等字詞本身出現就觸發。

**知識庫稽核：** 重複項標記 `"status": "archived"` 而非刪除，保留原始紀錄供比對。

## 頁面

| 頁面 | 路徑 |
|---|---|
| 客服前台 | `public/index.html` |
| 後台儀表板 | `public/dashboard.html` |

## 部署

Render 從 GitHub main 分支自動部署，執行 `npm start`。環境變數在 Render Dashboard 設定，不可 commit 進版本控制。

## RAG Implementation Note

- Primary retrieval: pgvector semantic search on `knowledge_chunks.embedding`, enabled only when PostgreSQL has the `vector` extension and `OPENAI_API_KEY` is configured.
- Fallback retrieval: keyword/synonym search through `search_text ILIKE`, so the service still works without embeddings.
- Chunk risk control: `knowledge_chunks.risk_level` is the source of truth for high-risk guardrails. Do not rely on matching prompt text such as `風險：High`.
- Embedding defaults: `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIMENSIONS=1536`.
