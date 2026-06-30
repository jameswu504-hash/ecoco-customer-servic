# ECOCO AI 客服部署與維護手冊

本文件給維護者確認 Render、PostgreSQL、Claude、OpenAI embedding 與知識庫同步狀態。
日常客服人員只需要使用後台；工程維護者才需要看本文件。

## 1. 系統組成

| 元件 | 用途 |
| --- | --- |
| Render Web Service | 部署 Node.js 後端與前台頁面 |
| PostgreSQL / Neon | 儲存對話紀錄、知識庫、RAG chunks、評分與知識缺口 |
| Claude / Anthropic API | 產生客服回覆 |
| OpenAI Embedding API | 將問題與知識庫轉成向量，提供 pgvector 語意檢索 |
| GitHub | 正式程式碼與知識庫 JSON 版本管理來源 |
| GitLab | 公司內部同步備份或審查分支 |

## 2. 必要環境變數

在 Render 進入：

```text
Service -> Environment -> Environment Variables
```

| 變數 | 必要性 | 說明 | 缺少時會怎樣 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 必填 | PostgreSQL 連線字串 | 服務無法啟動或無法讀寫資料 |
| `ANTHROPIC_API_KEY` | 必填 | Claude API key，用來產生客服回覆 | AI 無法回答 |
| `ADMIN_KEY` | 必填 | 後台與管理 API 的通行 key | 後台 API 會被拒絕 |
| `OPENAI_API_KEY` | 建議 | OpenAI embedding key，用來啟用 pgvector 語意檢索 | 系統仍可用，但只會 fallback 到關鍵字檢索 |
| `ANTHROPIC_MODEL` | 選填 | Claude 模型，預設由程式指定 | 未設定時使用預設模型 |
| `EMBEDDING_MODEL` | 選填 | 預設 `text-embedding-3-small` | 未設定時使用預設 embedding 模型 |
| `EMBEDDING_DIMENSIONS` | 選填 | 預設 `1536` | 不建議任意改，需和 embedding 模型維度一致 |
| `EMBEDDING_TIMEOUT_MS` | 選填 | 預設 `10000` | embedding API 太久會 timeout，系統 fallback 關鍵字檢索 |
| `KNOWLEDGE_AUTO_SYNC` | 選填 | 控制 Git JSON 是否在啟動時同步到 DB | 設錯可能覆蓋後台編輯 |
| `REBUILD_KNOWLEDGE_CHUNKS_ON_START` | 選填 | 設為 `always` 時，啟動時強制重建 RAG chunks | 只在換 embedding key、修復 chunks 或大改知識庫時使用 |
| `CONVERSATION_RETENTION_DAYS` | 選填 | 對話資料保存天數，`0` 代表不自動清除 | 未設定時對話會持續保存 |
| `PGSSL` | 選填 | 雲端 DB 通常用 `require` | 本機開發可視情況設 `disable` |

## 3. Claude API 與 OpenAI API 的差別

| Key | 用途 | 是否可互相取代 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 產生客服回答 | 不能取代 OpenAI embedding |
| `OPENAI_API_KEY` | 產生文字向量，讓 pgvector 找相似知識 | 不能取代 Claude 回答 |

也就是：

```text
Claude = 寫回答
OpenAI embedding = 找資料
PostgreSQL pgvector = 比對向量相似度
```

如果 Render 只有 `ANTHROPIC_API_KEY`，客服仍能回答，但 RAG 只會靠關鍵字與同義詞。
如果 Render 也有 `OPENAI_API_KEY`，重建 `knowledge_chunks` 時會補上 embedding，查詢時會使用語意檢索。為避免每次重啟都產生 embedding 成本，系統不會無條件重建 chunks。

## 4. 健康檢查

部署後可打開公開健康檢查：

```text
https://你的-render-domain/healthz
```

正常時會回傳類似：

```json
{
  "status": "ok",
  "service": "ecoco-customer-service",
  "checkedAt": "2026-07-01T00:00:00.000Z",
  "database": "ok"
}
```

詳細模型、RAG、同步模式與啟動警告屬於管理資訊，請用 Admin Key 查：

```text
GET /api/system/status
x-admin-key: <ADMIN_KEY>
```

欄位說明：

| 欄位 | 意思 |
| --- | --- |
| `status` | `ok` 代表服務與 DB 基本正常；`degraded` 代表至少 DB 檢查失敗 |
| `database` | PostgreSQL 連線是否正常 |
| `semanticRagEnabled` | 僅管理 API 顯示，代表是否同時具備 pgvector 與 `OPENAI_API_KEY` |
| `knowledgeCacheChars` | 僅管理 API 顯示，目前載入到 prompt cache 的知識庫字數 |
| `knowledgeAutoSyncMode` | 僅管理 API 顯示，啟動時知識庫同步模式 |

## 5. 知識庫同步原則

目前建議維持：

```text
KNOWLEDGE_AUTO_SYNC=disable
```

原因：後台修改會直接寫進 PostgreSQL。如果啟動時又用 Git JSON 自動覆蓋 DB，客服人員在後台做的臨時修正可能消失。

建議流程：

1. 日常小修：客服或維護者在後台修改，資料立即存進 PostgreSQL。
2. 大改版或交接前：在後台下載 JSON。
3. 人工確認 JSON 內容。
4. 放回 `data/ecoco-knowledge-import.json`。
5. commit / push 到 GitHub。

## 6. 新增 OpenAI Embedding Key 後要檢查什麼

1. Render 新增 `OPENAI_API_KEY`。
2. 暫時新增 `REBUILD_KNOWLEDGE_CHUNKS_ON_START=always`。
3. 手動 Redeploy。
4. 看 Render Logs 是否出現：

```text
pgvector enabled for semantic RAG search
Knowledge chunks rebuilt: ... chunks
```

5. 打開 `/api/system/status`，確認：

```json
"semanticRagEnabled": true
```

6. 確認 chunks 已重建後，移除 `REBUILD_KNOWLEDGE_CHUNKS_ON_START=always`，避免之後每次重啟都重新產生成本。

如果是 `false`，常見原因：

- 沒有設定 `OPENAI_API_KEY`
- PostgreSQL 不支援或未啟用 `vector` extension
- embedding API 呼叫失敗，系統 fallback 到關鍵字檢索

## 7. 安全注意事項

- 不要把 `.env`、API key、Render 環境變數截圖貼到 GitHub 或文件。
- GitHub repo 若曾公開，請先改 Private。
- `data/*.json` 與 `backups/*.json` 必須先跑個資掃描。
- 匯入或輸出知識庫前，應確認手機與 email 已匿名化。
- 大量改知識庫前，先從後台下載 JSON 備份。

## 8. 本地驗證指令

Windows PowerShell 可能會擋 `npm.ps1`，建議使用：

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run scan:pii
```

三個都通過後再 commit。

## 9. 部署流程

1. 確認本地測試通過。
2. `git status` 確認只包含本次要提交的檔案。
3. commit。
4. push 到 GitHub `main`。
5. Render 會依照 GitHub 設定自動部署，或由維護者手動 redeploy。
6. 部署後看 Render Logs。
7. 打開 `/healthz` 與 `/api/system/status`。
8. 測試前台問答與後台知識庫管理。

## 10. 常見故障

### AI 無法回答

檢查：

- `ANTHROPIC_API_KEY` 是否存在
- `ANTHROPIC_MODEL` 是否填了不存在的模型
- Render Logs 是否有 Claude API error

### 後台打不開或 API 401

檢查：

- `ADMIN_KEY` 是否設定
- 後台輸入的 admin key 是否正確

### PostgreSQL 連不上

檢查：

- `DATABASE_URL`
- DB 是否仍在運作
- SSL 設定是否正確
- Render Logs 是否有 connection error

### 語意檢索沒有啟用

檢查：

- `OPENAI_API_KEY`
- PostgreSQL 是否支援 `vector`
- `/api/system/status` 的 `semanticRagEnabled`
- Render Logs 是否有 embedding 或 pgvector 錯誤
