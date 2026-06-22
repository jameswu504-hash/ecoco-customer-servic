# ECOCO AI 客服系統維運與交接手冊

本文件提供 ECOCO AI 客服系統的維護、部署、資料流與交接標準。適用對象為系統維護者、專案交接人員、營運窗口與需要理解系統架構的管理者。

## 1. 系統定位

ECOCO AI 客服是一套以 Node.js、Claude API 與 PostgreSQL 組成的 AI 客服系統。它的核心目標是：

- 讓使用者可以即時詢問 ECOCO 相關問題。
- 讓 AI 依照已整理的 ECOCO 知識庫回答。
- 讓內部人員能追蹤對話、評分與知識缺口。
- 讓客服知識可以持續維護、備份與版本管理。

系統不是舊版 CommandCenter，也不是單純 FAQ 靜態頁。舊資料可作為比對來源，但正式回答應以目前 PostgreSQL 知識庫與 Git 版本資料為準。

## 2. 系統架構

```text
使用者
  ↓
public/index.html
  ↓
Express API / server.js
  ↓
PostgreSQL knowledge_sections / knowledge_chunks
  ↓
Claude API
  ↓
AI 回覆 + 對話紀錄 + 評分 + 知識缺口
  ↓
public/dashboard.html
```

| 元件 | 用途 |
| --- | --- |
| `server.js` | 後端入口，負責啟動服務、初始化資料庫與註冊 API routes |
| `routes/dashboard.routes.js` | 後台統計、對話紀錄、營運報表 API |
| `routes/knowledge.routes.js` | 知識庫新增、修改、封存、恢復、匯出 API |
| `routes/unanswered.routes.js` | 知識缺口查詢與狀態更新 API |
| `public/index.html` | 使用者端 AI 客服頁面 |
| `public/dashboard.html` | 內部客服後台 |
| PostgreSQL | 線上執行資料庫，AI 實際讀取資料的位置 |
| Claude API | 產生客服回覆的 AI 模型 |

## 3. 環境與部署

目前正式部署由 Render 執行，主要來源為 GitHub repository。

| 項目 | 說明 |
| --- | --- |
| GitHub | 正式程式碼與文件版本來源 |
| Render | Web Service 部署平台 |
| PostgreSQL | 線上資料庫，由 `DATABASE_URL` 指向 |
| GitLab | 公司備份或協作倉庫，依權限與流程同步 |

Render 會讀取以下環境變數：

| 變數 | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key |
| `ADMIN_KEY` | 後台管理 API 權限 |
| `DATABASE_URL` | PostgreSQL 連線字串 |
| `KNOWLEDGE_AUTO_SYNC` | Git JSON 與 PostgreSQL 的啟動同步模式 |
| `PGSSL` | PostgreSQL SSL 設定，依部署環境調整 |

機密資料只能放在 Render Environment Variables 或本機 `.env`，不得提交到 GitHub 或 GitLab。

## 4. PostgreSQL 資料表

PostgreSQL 是線上執行資料庫，可以理解為 AI 客服正在使用的正式資料庫。它不是 GitHub 檔案，也不是 Excel，需要透過後台、程式或 DBeaver 查看。

| 資料表 | 用途 |
| --- | --- |
| `knowledge_sections` | 知識庫分類與內容，AI 回答的主要來源 |
| `knowledge_chunks` | 由知識庫自動切分的 RAG 檢索片段 |
| `conversations` | 使用者與 AI 的對話紀錄 |
| `ratings` | 使用者對 AI 回覆的評分 |
| `unanswered_questions` | AI 不確定或資料不足的問題 |

`knowledge_chunks` 是系統自動產生的衍生資料，不應手動編輯。維護者應修改 `knowledge_sections`，再由系統重建 chunks。

## 5. 知識資料的兩層管理

本系統採用「線上執行資料庫」與「Git 版本資料」分層管理。

| 層級 | 位置 | 用途 |
| --- | --- | --- |
| 執行層 | PostgreSQL `knowledge_sections` | AI 目前實際使用的知識 |
| 版本層 | `data/ecoco-knowledge-import.json` | 可匯入 PostgreSQL 的正式知識包 |
| 底稿層 | `data/ecoco-ai-customer-service-database.json` | 完整資料整理與來源追蹤底稿 |

日常修改以 PostgreSQL 後台為主，方便客服或維護者即時補資料。重大改版、交接或備份時，應從後台下載 JSON，人工確認後放回 Git。

## 6. 知識更新流程

### 6.1 日常小修

適用於修正錯字、補充單一問題、封存過期知識。

```text
登入後台
  ↓
搜尋既有分類
  ↓
新增 / 修改 / 封存知識
  ↓
前台測試同類問題
  ↓
必要時於知識缺口更新狀態
```

此流程會立即寫入 PostgreSQL，AI 可以使用最新內容，但不會自動寫回 GitHub。

### 6.2 重大改版或交接

適用於大量整理知識、交接前備份、正式版本更新。

```text
後台下載 JSON
  ↓
人工檢查內容
  ↓
覆蓋 data/ecoco-knowledge-import.json
  ↓
commit / push 到 GitHub
  ↓
Render 部署
```

注意：下載 JSON 只是產生檔案，不會自動更新 GitHub。必須由維護者人工放回 repo、commit 並 push。

### 6.3 不建議的做法

- 直接修改 PostgreSQL 但完全不備份。
- 把未確認的個案結果寫成公開知識。
- 將 API key、token 或使用者個資寫入 JSON。
- 手動修改 `knowledge_chunks`。
- 未確認就刪除知識；建議先封存。

## 7. RAG 與回答流程

系統回答問題時，會先從 PostgreSQL 找出相關知識片段，再交給 Claude 產生回答。

```text
使用者問題
  ↓
PostgreSQL 全文搜尋 knowledge_chunks
  ↓
取出相關 chunks
  ↓
組成 system prompt
  ↓
Claude 產生回覆
  ↓
儲存對話與可能的知識缺口
```

RAG 的重點不是讓 AI 自由發揮，而是讓 AI 依照公司可控、可維護的知識回答。若資料庫缺少內容，AI 應保守回覆並留下知識缺口。

## 8. 回覆風險控管

系統已接入 `data/ecoco-response-policies.json`，用於控制高風險問題的回答方式。

高風險情境包含：

- 點數未入帳
- 優惠券無法兌換
- 帳號或會員資料
- 機台異常與客訴
- 退款、補償、補點要求

原則如下：

- 可以說明規則與收集必要資訊。
- 可以引導客服表單或人工協助。
- 不得承諾補點、退款、賠償或已完成處理。
- 不得推測使用者個資或帳號狀態。

## 9. 重要檔案用途

| 檔案 / 資料夾 | 用途 |
| --- | --- |
| `server.js` | 後端入口、Claude 呼叫、資料庫初始化、主要服務啟動 |
| `routes/` | 後台、知識庫、知識缺口等 API 模組 |
| `db/schema.js` | PostgreSQL 資料表 schema |
| `middleware/admin-auth.js` | 後台 API 權限驗證 |
| `public/index.html` | 使用者端 AI 客服頁 |
| `public/dashboard.html` | 內部後台 |
| `data/ecoco-knowledge-import.json` | 可匯入 PostgreSQL 的正式知識包 |
| `data/ecoco-ai-customer-service-database.json` | 完整知識底稿與來源紀錄 |
| `data/ecoco-response-policies.json` | 回覆風險政策 |
| `data/knowledge-quality-audit.json` | 重複與衝突稽核結果 |
| `scripts/build-ecoco-knowledge-data.js` | 從底稿產生匯入 JSON |
| `scripts/audit-knowledge-quality.js` | 檢查重複與衝突 |
| `scripts/apply-knowledge-audit.js` | 將建議剔除資料標記為 archived |
| `scripts/import-knowledge-json.js` | 手動匯入知識 JSON 到 PostgreSQL |
| `CLAUDE.md` | AI coding agent 維護本專案時的工作規則 |
| `.env.example` | 環境變數範例 |
| `.gitignore` | 防止 `.env`、log、node_modules 等不該進 Git 的檔案被提交 |

## 10. 例行維護清單

建議每週檢查：

- 是否有未處理知識缺口。
- 是否有低評分或負面回饋。
- 是否有重複或過期知識。
- 是否有高風險問題被 AI 過度承諾。
- 後台是否能正常登入。
- Render 是否正常部署。
- GitHub 文件是否符合目前流程。

建議每月或交接前檢查：

- 從後台下載 JSON 備份。
- 確認 `data/ecoco-knowledge-import.json` 是否需要更新。
- 確認 API key 與資料庫權限仍由公司帳號控管。
- 確認文件與實際操作流程一致。

## 11. 故障排除

| 問題 | 可能原因 | 處理方式 |
| --- | --- | --- |
| AI 無法回答 | 知識庫缺少資料、Claude API 失敗 | 檢查後台知識缺口與 Render logs |
| 後台無法存知識 | `ADMIN_KEY` 錯誤或 API 失敗 | 確認登入 key 與 Render logs |
| 修改後 AI 沒變 | 修改的分類未命中、chunks 尚未重建 | 重新測試相近問法，必要時重啟服務 |
| 資料庫連不上 | `DATABASE_URL` 錯誤、SSL 設定錯誤 | 檢查 Render Environment 與 DBeaver SSL |
| 部署後資料不一致 | Git JSON 與 PostgreSQL 沒同步 | 確認 `KNOWLEDGE_AUTO_SYNC` 與更新流程 |

## 12. 交接標準

交接時應提供：

- GitHub repository 位置。
- Render service 位置。
- PostgreSQL 連線資訊由公司帳號保管。
- 後台登入方式與 `ADMIN_KEY` 管理方式。
- 最近一次知識 JSON 備份。
- 尚待確認的知識缺口或衝突清單。
- 最近一次部署 commit。
- 文件入口：`docs/README.md`。

交接完成前，應由接手者實際完成一次：

1. 登入後台。
2. 查看對話紀錄。
3. 新增或修改一筆測試知識。
4. 前台測試 AI 回覆。
5. 封存或恢復一筆非正式資料。
6. 下載 JSON，確認知道它不會自動寫回 GitHub。

## 13. 維護原則

本系統的長期維護重點是讓 AI 回答「可追蹤、可修正、可交接」。

因此所有重大調整應符合三個原則：

- 來源清楚：知道資料從哪裡來。
- 風險可控：高風險問題不讓 AI 過度承諾。
- 流程可交接：下一位維護者能依文件完成操作。
