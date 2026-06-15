# ECOCO AI 客服資料來源清單

## 主要資料底稿

| 檔案 | 用途 |
| --- | --- |
| `data/ecoco-ai-customer-service-database.json` | 完整 ECOCO AI 客服資料庫底稿，保留來源、分類、風險、衝突與自動化等級 |
| `data/ecoco-knowledge-import.json` | 給 PostgreSQL `knowledge_sections` 使用的匯入檔 |
| `data/ecoco-response-policies.json` | 高風險問題的回覆政策，例如點數、優惠券、機台、帳號、客訴 |
| `knowledge.js` | 首次部署時的初始知識庫種子資料，後續以 PostgreSQL 為主 |
| `docs/META_AI_INSTRUCTIONS.md` | Meta AI 指令的內部查閱文件；正式匯入仍以 JSON 資料庫為準 |

## 已整理進資料庫的來源類型

目前整合的資料包含：

- ECOCO 官網常見問題。
- Excel FAQ。
- Meta AI 指令與品牌語氣。
- 內部資源文件。
- ECOCO VI 品牌規範。
- 社群回覆範本。
- 客訴報告與常見問題整理。
- 舊 CommandCenter 的可用流程概念。
- 舊系統中可參考但需審核的知識主題。

## 不應直接餵給 AI 的資料

以下資料不能直接丟進 AI 知識庫：

- `.env`、API key、token、資料庫連線字串。
- 舊 CommandCenter 的 `config.json` 機密欄位。
- 舊 AI 草稿中未確認的事實。
- 舊站點名稱或舊合作方名稱。
- 內部抱怨、個資、測試對話。
- 尚未由內部確認的新站點名稱。
- `conflicts_pending_review` 內尚未確認的衝突資料。

## 目前資料量摘要

以 `data/ecoco-knowledge-import.json` 的摘要為準，目前資料規模約為：

| 類型 | 數量 |
| --- | ---: |
| knowledge records | 878 |
| social reply templates | 81 |
| response policies | 5 |
| internal ops signals | 27 |
| brand guidelines | 9 |
| source documents | 9 |
| conflicts | 5 |
| old ticket examples | 7 |

## 資料更新原則

1. 新資料先進 `data/ecoco-ai-customer-service-database.json`。
2. 重新執行 `npm run build:knowledge` 產生 `data/ecoco-knowledge-import.json`。
3. Commit 並 push 到 GitHub。
4. Render 部署後，系統啟動時同步到 PostgreSQL。
5. 若資料有衝突，先放入待確認，不要直接變成正式回答。

## 特別注意：站點與合作方名稱

目前已知規則：

- 對客回覆內容不要出現 `家樂福`、`家福`。
- 回覆內容改用 `康達盛通`。
- 站點名稱若包含 `家樂福`，目前先去除 `家樂福`。
- 新站點名稱要等內部確認後再正式更新。
