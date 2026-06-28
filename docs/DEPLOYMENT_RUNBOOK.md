# ECOCO AI 客服部署與環境變數手冊

本文件說明 ECOCO AI 客服如何部署在 Render、需要哪些環境變數，以及如何確認 pgvector / embedding RAG 是否真正啟用。

## 一、目前部署方式

目前正式服務由 Render 部署，Render 會從 GitHub `main` 分支拉取程式碼並執行：

```bash
npm start
```

Render 讀取的是 GitHub 上的程式碼，不會自動讀取本機檔案。若本機修改沒有 commit / push 到 GitHub，Render 不會更新。

## 二、本地啟動方式

```bash
npm install
npm start
```

本地預設網址：

| 頁面 | URL |
| --- | --- |
| 客服前台 | `http://localhost:3000` |
| 後台 dashboard | `http://localhost:3000/dashboard.html` |

## 三、Render 必要環境變數

在 Render Dashboard 進入：

```text
Service → Environment → Environment Variables
```

檢查以下設定：

| 變數 | 必要性 | 用途 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 必要 | 呼叫 Claude 產生客服回答 |
| `ANTHROPIC_MODEL` | 建議 | 指定 Claude 模型，預設為 Sonnet |
| `DATABASE_URL` | 必要 | 連接 PostgreSQL / Neon 資料庫 |
| `ADMIN_KEY` | 必要 | 保護後台 API |
| `KNOWLEDGE_AUTO_SYNC` | 建議 | 控制是否開機同步 Git JSON |
| `OPENAI_API_KEY` | 選用但建議 | 啟用 embedding 與 pgvector 語意 RAG |
| `EMBEDDING_MODEL` | 選用 | 預設 `text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS` | 選用 | 預設 `1536` |
| `PGSSL` | 視資料庫設定 | 部分本地資料庫可設 `disable`，Render/Neon 通常不需要 |
| `PORT` | Render 自動 | Render 會自動提供 |

## 四、如何確認 Render 有沒有設定 `OPENAI_API_KEY`

### 方法 1：從 Render 介面確認

1. 打開 Render Dashboard。
2. 進入 ECOCO AI 客服的 Web Service。
3. 左側點 `Environment`。
4. 在 Environment Variables 找 `OPENAI_API_KEY`。
5. 如果看到 key 名稱，而且 value 是一串被遮住的圓點，代表有設定。
6. 如果完全沒有 `OPENAI_API_KEY` 這一列，代表尚未設定。

注意：Render 會把 value 遮住是正常的，不需要也不應該把 key 貼到文件或 GitHub。

### 方法 2：從 Render Logs 判斷

重新部署後看 Render Logs：

- 如果 pgvector / embedding 設定成功，系統會嘗試建立 embedding 欄位與索引。
- 如果沒有 `OPENAI_API_KEY`，系統仍會正常運作，但會退回關鍵字 RAG。
- 如果資料庫不支援 pgvector，系統也會正常運作，但會退回關鍵字 RAG。

### 方法 3：從功能理解判斷

沒有 `OPENAI_API_KEY` 時：

- AI 客服仍可回答。
- PostgreSQL 知識庫仍可使用。
- 但 RAG 主要依靠關鍵字與同義詞搜尋，不是真正的 embedding 語意檢索。

有 `OPENAI_API_KEY` 時：

- 系統可以把知識 chunk 轉成 embedding。
- 使用者問題也會轉成 embedding。
- PostgreSQL pgvector 會用語意相似度找相關知識。

## 五、`KNOWLEDGE_AUTO_SYNC` 建議設定

| 設定 | 行為 | 建議 |
| --- | --- | --- |
| `disable` | 開機不自動用 Git JSON 覆蓋 PostgreSQL | 日常維護建議 |
| `insert_only` | 只新增 Git JSON 中不存在的分類 | 可用於補新資料 |
| `upsert` | 同名分類會被 Git JSON 更新覆蓋 | 謹慎使用 |
| `replace` | 清空 PostgreSQL 後完全以 Git JSON 重建 | 只適合重建環境 |

目前簡化維護原則：

- 日常新增或修改知識：直接在後台做，資料會存在 PostgreSQL。
- 大改版或交接前：從後台下載 JSON，人工確認後覆蓋 `data/ecoco-knowledge-import.json`，再 commit / push。
- 不要在不確定的情況下使用 `replace`，避免覆蓋後台臨時更新。

## 六、部署流程

1. 在本機完成修改。
2. 執行基本檢查，例如 `node --check server.js`。
3. `git status` 確認要上傳的檔案。
4. `git add`、`git commit`。
5. `git push origin main`。
6. Render 會自動部署 GitHub `main`。
7. 部署完成後測試前台與後台。
8. 若涉及知識庫或 RAG，確認 Render Logs 是否有錯誤。

## 七、常見問題排查

### AI 沒有回答

檢查：

- Render 是否部署成功。
- `ANTHROPIC_API_KEY` 是否存在。
- `ANTHROPIC_MODEL` 是否為可用模型。
- Render Logs 是否有 Claude API 錯誤。

### 後台打不開或 API 失敗

檢查：

- `ADMIN_KEY` 是否存在。
- 前端請求是否帶有正確的 admin key。
- Render Logs 是否有 401 或 403。

### 資料庫連不上

檢查：

- `DATABASE_URL` 是否存在。
- Neon / PostgreSQL 是否正常。
- SSL 設定是否正確。
- Render Logs 是否有 connection error。

### 語意 RAG 沒有生效

檢查：

- Render 是否有 `OPENAI_API_KEY`。
- PostgreSQL 是否支援 `vector` extension。
- Render Logs 是否出現 pgvector 或 embedding 錯誤。
- `knowledge_chunks` 是否已重建並產生 embedding。

## 八、安全原則

- 不要把 `.env` push 到 GitHub。
- 不要把 API key 貼在文件、截圖或聊天訊息。
- Render Environment Variables 是放正式 key 的地方。
- GitHub 只放程式碼、文件與非機密設定範例。
- 如果 key 曾經被貼出或外流，應立即撤銷並重新產生。
