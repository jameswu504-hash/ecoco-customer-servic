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
```

啟動需要 `.env`：

```
ANTHROPIC_API_KEY=...
ADMIN_KEY=...
DATABASE_URL=postgresql://...
KNOWLEDGE_AUTO_SYNC=insert_only   # 見下方說明
# PGSSL=disable                   # Render 內部連線時啟用
```

無測試指令、無 lint 設定。

## 架構

### 兩層知識資料

系統有兩個知識來源，必須理解兩者的關係才能正確維護：

| 層 | 檔案 | 說明 |
|---|---|---|
| Git JSON（版本控制層） | `data/ecoco-ai-customer-service-database.json` | 主要編輯來源，含版本、衝突追蹤、878 筆紀錄 |
| PostgreSQL（執行層） | `knowledge_sections` + `knowledge_chunks` | 伺服器實際讀取的資料 |

**正確更新流程：** 編輯 `data/` JSON → `audit` → `apply` → `build` → `import` → 部署後自動同步。  
**後台直接編輯** 只存進 PostgreSQL，不會回寫 Git JSON，需人工同步。

### `server.js` 的啟動順序

1. `initDb()` — 逐一執行 SCHEMA 建表（雲端 Postgres 不接受多語句，故分開執行）
2. `KNOWLEDGE_AUTO_SYNC` 決定是否從 Git JSON 同步進 PostgreSQL
3. `refreshKnowledgeCache()` — 把 `knowledge_sections` 全部載入記憶體字串 `knowledgeCache`
4. 開始接請求

### RAG 流程

`/api/chat` 收到問題後：
1. 對 `knowledge_chunks` 做 PostgreSQL 全文搜尋，取前 8 筆相關片段
2. 把片段嵌入 system prompt（標記 `cache_control: ephemeral` 啟用 prompt caching）
3. 呼叫 Claude（`claude-opus-4-7`，`max_tokens: 1024`）

`knowledge_chunks` 是從 `knowledge_sections` 自動切分的衍生資料，**不要手動編輯**。每次後台修改分類或伺服器重啟都會重建。

### 知識缺口偵測

若 Claude 回覆包含「沒有確切資料」，系統自動寫一筆到 `unanswered_questions`。DB 寫入失敗不中斷對話（內層獨立 try/catch）。

### KNOWLEDGE_AUTO_SYNC 模式

| 模式 | 行為 |
|---|---|
| `insert_only`（預設） | 只新增 Git JSON 裡沒有的分類，保留後台編輯 |
| `upsert` | 新增 + 更新已存在的分類 |
| `replace` | 清空 PostgreSQL 知識，完整以 Git JSON 取代 |
| `disable` | 不同步，PostgreSQL 完全由後台維護 |

### Admin 保護

`requireAdminKey` 用 `crypto.timingSafeEqual` 比較，防計時攻擊。後台所有 `/api/knowledge/*`、`/api/stats`、`/api/sessions`、`/api/unanswered` 等均需帶 `x-admin-key` header。

## 重要規則

**修改前先說明：** 任何影響 AI 回覆行為、資料同步邏輯、部署設定或 Git 歷史的變更，必須先向使用者解釋，再執行。

**高風險類別（response-policies）：** 點數、兌換券、機台錯誤、帳號、客訴等類別有保守回答規則。觸發條件是 chunks 被標記為 high-risk 或使用者明確提到補償意圖，不是「點數」「帳號」等字詞本身出現就觸發。

**知識庫稽核：** 重複項標記 `"status": "archived"` 而非刪除，保留原始紀錄供比對。

## 頁面

| 頁面 | 路徑 |
|---|---|
| 客服前台 | `public/index.html` |
| 後台儀表板 | `dashboard.html`（根目錄，非 public/） |

## 部署

Render 從 GitHub main 分支自動部署，執行 `npm start`。環境變數在 Render Dashboard 設定，不可 commit 進版本控制。
