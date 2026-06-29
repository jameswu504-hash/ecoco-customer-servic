# ECOCO AI 客服系統維運與交接手冊

本文件提供 ECOCO AI 客服系統的維運、部署、資料流、權限、例行維護與交接標準。適用對象包含系統維護者、工程協作者、客服主管、營運窗口與接手專案的人員。

## 1. 系統定位

ECOCO AI 客服是一套結合前台客服頁、內部後台、PostgreSQL 知識庫、Claude 回覆模型與 RAG 檢索的客服輔助系統。

系統目的：

- 回答使用者常見客服問題。
- 統一 ECOCO 客服回覆口徑。
- 將知識缺口轉成可追蹤待辦。
- 讓客服與營運人員能持續維護知識庫。
- 提供主管查看客服量、問題分類與改善進度。
- 保留可交接的 Git 文件、JSON 與資料庫流程。

系統不是舊版 CommandCenter，也不是單純 FAQ 靜態頁。舊資料可作為參考，但正式回答應以目前 PostgreSQL 知識庫與 Git 版本資料為準。

## 2. 系統架構

```text
使用者
  -> public/index.html
  -> Express API
  -> PostgreSQL knowledge_sections / knowledge_chunks
  -> Claude API
  -> AI 回覆
  -> conversations / ratings / unanswered_questions
  -> public/dashboard.html
```

| 元件 | 用途 |
| --- | --- |
| `server.js` | 後端入口、服務啟動、資料庫初始化、route 註冊 |
| `routes/chat.routes.js` | AI 對話 API、評分 API、知識缺口判斷 |
| `routes/dashboard.routes.js` | 後台統計、對話紀錄與主管報表 API |
| `routes/knowledge.routes.js` | 知識庫新增、修改、封存、恢復與匯出 API |
| `routes/unanswered.routes.js` | 知識缺口查詢與狀態更新 API |
| `services/rag.service.js` | RAG 檢索、chunks 建立、pgvector embedding |
| `services/prompt.service.js` | System prompt 與品牌語氣組合 |
| `services/privacy.service.js` | 手機與 Email 等敏感資訊遮罩 |
| `public/index.html` | 使用者端 AI 客服頁 |
| `public/dashboard.html` | 內部客服後台 |
| PostgreSQL | 線上知識庫、對話、評分、知識缺口與 RAG chunks |
| Claude API | 產生客服回答 |
| OpenAI Embedding API | 產生向量，支援 pgvector 語意檢索 |

## 3. 權限與帳號

| 項目 | 用途 | 管理原則 |
| --- | --- | --- |
| GitHub repository | 正式程式碼、文件與 JSON 版本 | 應由公司或授權帳號控管 |
| Render service | 正式部署平台 | 只有維護者可改環境變數與部署設定 |
| PostgreSQL / Neon | 線上資料庫 | 連線字串不得公開 |
| `ANTHROPIC_API_KEY` | Claude 回覆模型 | 放在 Render Environment Variables |
| `OPENAI_API_KEY` | embedding 語意檢索 | 放在 Render Environment Variables |
| `ADMIN_KEY` | 後台與管理 API 權限 | 不得寫入文件或 Git |
| `.env` | 本機開發設定 | 不得提交 |

任何 API key、token、資料庫密碼、真實手機、Email 或會員資料都不得提交到 GitHub 或 GitLab。

## 4. 部署與健康檢查

目前正式服務由 Render 部署，Render 會從 GitHub main 分支拉取程式碼。

部署後應檢查：

1. Render deploy 狀態為 Live。
2. Logs 無啟動錯誤。
3. `/healthz` 可回傳服務狀態。
4. 前台可正常提問。
5. 後台可正常登入。
6. 知識庫分類與 RAG chunks 數量合理。

健康檢查網址：

```text
https://你的-render-domain/healthz
```

應關注欄位：

| 欄位 | 正常狀態 |
| --- | --- |
| `status` | `ok` |
| `database` | `ok` |
| `semanticRagEnabled` | 有 OpenAI key 且 pgvector 可用時為 `true` |
| `knowledgeAutoSyncMode` | 建議日常維護為 `disable` |

## 5. PostgreSQL 與 Git JSON 的關係

系統採用兩層資料管理。

| 層級 | 位置 | 說明 |
| --- | --- | --- |
| 線上執行資料 | PostgreSQL `knowledge_sections` | AI 目前實際讀取的知識 |
| 正式版本資料 | `data/ecoco-knowledge-import.json` | 可重新匯入、備份與交接的知識包 |
| 資料底稿 | `data/ecoco-ai-customer-service-database.json` | 來源整理與資料追蹤底稿 |

重要原則：

- 後台新增或修改知識會立即寫入 PostgreSQL。
- 後台修改不會自動寫回 GitHub。
- 重大更新、交接或備份前，需從後台下載 JSON，人工確認後覆蓋 `data/ecoco-knowledge-import.json`。
- `knowledge_chunks` 是由系統自動產生的 RAG 檢索資料，不應手動修改。

## 6. 知識更新流程

### 6.1 日常小修

適用於修正錯字、補充一筆 FAQ、封存過期內容。

```text
登入後台
  -> 搜尋既有分類
  -> 新增 / 修改 / 封存知識
  -> 儲存至 PostgreSQL
  -> 系統重建 chunks
  -> 前台測試相關問題
```

日常小修不一定需要立刻更新 Git，但應在重大整理或交接前匯出 JSON。

### 6.2 重大改版或交接

適用於大量整理知識、正式版本備份、交接前確認。

```text
後台下載 JSON
  -> 人工檢查內容與個資
  -> 覆蓋 data/ecoco-knowledge-import.json
  -> npm.cmd run scan:pii
  -> npm.cmd test
  -> commit / push 到 GitHub
  -> Render 部署
```

### 6.3 不建議操作

- 直接修改 PostgreSQL 但不留下備份。
- 把未確認個案結果寫成公開知識。
- 把 API key 或個資寫入 JSON。
- 手動修改 `knowledge_chunks`。
- 未確認就永久刪除知識，建議先封存。

## 7. 回覆風險控管

高風險問題包括：

- 點數未入帳
- 優惠券無法兌換
- 補點、退款、補償
- 帳號、會員資料、個資
- 機台異常、滿倉、清潔與客訴
- 未確認的新站點、新活動或合作方資訊

AI 可做：

- 說明公開規則。
- 收集必要查詢資訊。
- 引導客服表單或人工協助。
- 使用保守、親切、專業語氣。

AI 不可做：

- 承諾補點、退款、賠償或補償。
- 宣稱已完成處理或已派員。
- 查詢、推測或公開會員個資。
- 代表公司做客訴責任判定。

## 8. 例行維護清單

### 每日或每週

- 檢查知識缺口是否有待處理項目。
- 檢查使用者負評與低分回覆。
- 檢查是否有高風險問題被 AI 過度承諾。
- 補充已確認的常見問題。
- 封存過期或不確定知識。

### 每月或重大更新前

- 下載 PostgreSQL 知識庫 JSON。
- 檢查是否有個資或不該公開的內容。
- 更新 `data/ecoco-knowledge-import.json`。
- 執行 PII 掃描與 smoke test。
- 確認 GitHub、Render、PostgreSQL 權限仍由公司控管。

## 9. 測試與驗證

常用檢查指令：

```bash
npm.cmd run lint
npm.cmd test
npm.cmd run scan:pii
```

部署後人工驗證：

1. 前台輸入一般 FAQ，例如點數效期。
2. 前台輸入高風險問題，例如點數未入帳。
3. 確認 AI 不承諾補點或退款。
4. 後台確認對話有紀錄。
5. 後台確認知識缺口與評分功能正常。
6. 打開 `/healthz` 確認 database 狀態。

## 10. 故障排除

| 問題 | 可能原因 | 處理方式 |
| --- | --- | --- |
| AI 無法回答 | Claude key 失效、模型錯誤、API 額度問題 | 檢查 Render logs 與 `ANTHROPIC_API_KEY` |
| 語意 RAG 未啟用 | 沒有 `OPENAI_API_KEY`、OpenAI 額度不足、pgvector 不可用 | 檢查 logs、billing 與 `/healthz` |
| 後台無法登入 | `ADMIN_KEY` 錯誤 | 確認 Render Environment Variables |
| 知識更新後 AI 沒變 | 問法未命中、chunks 未重建、資料未儲存 | 檢查後台、logs，重新測試相近問法 |
| PostgreSQL 連不上 | `DATABASE_URL` 錯誤、SSL 設定錯誤 | 檢查 Render 與 DB provider |
| 部署後資料不一致 | PostgreSQL 與 Git JSON 不同步 | 確認最近是否下載 JSON 並回寫 Git |

## 11. 交接資料包

交接時應提供：

- GitHub repository URL。
- Render service URL。
- 後台 URL。
- PostgreSQL 管理位置與負責帳號。
- API key 管理位置，不提供明文 key。
- 最近一次部署 commit。
- 最近一次知識 JSON 備份。
- 尚未處理的知識缺口與資料衝突。
- 文件入口：`docs/README.md`。

## 12. 接手驗收流程

接手者應實際完成：

1. 開啟前台並送出測試問題。
2. 登入後台。
3. 查看一筆對話紀錄。
4. 查看知識缺口清單。
5. 新增或修改一筆測試知識。
6. 前台測試 AI 是否讀到新知識。
7. 封存或恢復一筆測試知識。
8. 下載 JSON，確認知道此動作不會自動寫回 GitHub。
9. 查看 `/healthz`。
10. 確認知道部署與 GitHub 更新流程。

## 13. 維護原則

本系統維護的核心目標是讓 AI 回答可控、資料可追蹤、流程可交接。

所有重大調整應符合：

- 來源清楚：知道資料從哪裡來。
- 權限清楚：知道誰能改資料、誰能部署。
- 風險清楚：高風險問題不讓 AI 過度承諾。
- 版本清楚：PostgreSQL 線上資料與 Git JSON 版本有明確同步流程。
- 文件清楚：接手者不需要依賴口頭說明才能維護系統。
