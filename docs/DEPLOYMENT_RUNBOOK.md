# ECOCO AI 客服部署與環境設定手冊

## 部署平台

目前線上環境使用 Render 部署。

Render 會從 GitHub main 分支抓最新程式，部署完成後啟動 `npm start`。

## 本機啟動

```bash
npm install
npm start
```

啟動後：

| 頁面 | URL |
| --- | --- |
| 客服前台 | `http://localhost:3000` |
| 後台 dashboard | `http://localhost:3000/dashboard.html` |

## Render 需要的環境變數

這些變數放在 Render Dashboard 的 Environment，不要寫進 GitHub。

| 變數 | 必填 | 說明 |
| --- | :---: | --- |
| `ANTHROPIC_API_KEY` | 是 | Claude API key |
| `ANTHROPIC_MODEL` | 否 | Claude 模型名稱，不填會用程式預設 |
| `DATABASE_URL` | 是 | PostgreSQL 連線字串 |
| `PGSSL` | 否 | 雲端 Postgres 通常用 `require`，若內部連線報 SSL 錯可設 `disable` |
| `ADMIN_KEY` | 是 | 後台 API 驗證 key |
| `KNOWLEDGE_AUTO_SYNC` | 否 | 控制啟動時是否同步知識庫 |
| `PORT` | 否 | Render 通常會自動提供 |

## `KNOWLEDGE_AUTO_SYNC` 模式

| 值 | 行為 |
| --- | --- |
| 未設定或 `disable` | 簡易維護模式：不自動同步 Git JSON，日常以後台 PostgreSQL 為準 |
| `insert_only` | 只新增缺少的分類，不覆寫後台已編輯的分類 |
| `upsert` | 讀取 `data/ecoco-knowledge-import.json`，更新同名分類並新增新分類，會覆寫後台同名分類 |
| `disable` | 不自動同步 Git 裡的知識 JSON |
| `replace` | 清空 PostgreSQL `knowledge_sections`，再完全用 JSON 重建 |

一般建議：

- 平常使用 `disable`，讓客服只需要在後台維護 PostgreSQL。
- 大改版、交接或備份時，才從後台下載 JSON，人工確認後放回 GitHub。
- 只有確認要用 Git JSON 覆蓋同名分類時，才用 `upsert`。
- 若後台是唯一主要編輯入口，可用 `disable` 完全停止開機同步。
- 只有確認要以 Git 資料為唯一正式版本時，才用 `replace`。

## 正式更新流程

1. 修改資料或程式。
2. 本機檢查語法與基本功能。
3. Commit。
4. Push 到 GitHub main。
5. Render 自動部署。
6. 打開線上客服前台測試。
7. 打開 dashboard 確認對話與知識缺口正常。

## 常見問題

### AI 客服不能回覆

優先檢查：

- Render 是否部署成功。
- `ANTHROPIC_API_KEY` 是否存在。
- Claude API key 是否有效。
- Render log 是否出現 API 錯誤。

### 後台進不去

優先檢查：

- `ADMIN_KEY` 是否和前端輸入一致。
- API request 是否有帶 `x-admin-key`。

### 資料庫連不上

優先檢查：

- `DATABASE_URL` 是否正確。
- PostgreSQL 服務是否還在。
- `PGSSL` 是否需要調整。
- Render log 是否出現 SSL 或 connection error。

### 更新資料後 AI 沒變

優先檢查：

- 是否有重新產生 `data/ecoco-knowledge-import.json`。
- 是否已 push 到 GitHub。
- Render 是否已重新部署。
- `KNOWLEDGE_AUTO_SYNC` 是否被設成 `disable`。
- PostgreSQL `knowledge_sections` 是否有更新。

## 不可以做的事

- 不把 `.env` push 到 GitHub。
- 不把 API key 寫在 `server.js`。
- 不把 Render 的環境變數截圖公開。
- 不用舊系統資料直接覆蓋新版資料。
- 不在未確認時使用新的站點名稱。
