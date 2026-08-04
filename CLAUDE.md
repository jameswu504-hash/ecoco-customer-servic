# CLAUDE.md

本文件提供 AI 與工程協作者處理此 repository 時的必要規則。產品與維運文件由 [`docs/README.md`](docs/README.md) 進入。

## 驗證指令

```bash
npm run lint
npm test
npm run eval:validate
npm run scan:pii
git diff --check
```

修改功能後必須執行與風險相稱的測試；提交前至少完成上述檢查。測試範圍以 `tests/*.test.js` 為準，不在文件硬寫檔案數量。

## 常用指令

```bash
npm start
npm run dev
npm run build:knowledge
npm run import:knowledge
npm run audit:knowledge
npm run knowledge:backfill-embeddings
npm run iot:sync
npm run eval
```

## 系統邊界

- B2C：官網與 LINE 一對一聊天，使用 ECOCO 共用知識及 Hive 站點同步鏡像。
- B2B：LINE 群組先通過綁定 gate，再使用共用知識與相同 `company_id` 的公司私有知識。
- 未綁定群組不得退回 B2C 回答。
- B2C 不得檢索 `partner_*` 公司私有資料。
- 站點資料不放入靜態 B2C 知識；由 Hive／Azure MySQL 同步到 `iot_station_statuses`。

詳細架構見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，B2B 規則見 [`docs/b2b/README.md`](docs/b2b/README.md)。

## 知識資料

- PostgreSQL `knowledge_sections`、`knowledge_chunks` 是線上 B2C 共用知識來源。
- `partner_knowledge_sections`、`partner_knowledge_chunks` 必須在 SQL 層依 `company_id` 隔離。
- `data/ecoco-knowledge-import.json` 是備份與明確匯入檔，不會因 Git push 自動成為正式資料。
- 封存或刪除 section 時，必須同步處理 chunks。
- B2B LINE 對話不是知識；需整理為候選並經人工核准。
- 品牌文件清洗依 `skills/ecoco-clean-brand-knowledge/SKILL.md`，原始檔不送外部 AI。

## RAG

- 有 pgvector 與 `OPENAI_API_KEY` 時可用語意檢索。
- embedding 不可用時必須安全退回關鍵字檢索。
- 風險控制以資料欄位與程式規則為準，不可只依賴 prompt。
- 只把本次問題命中的必要 chunks 交給 Claude，不可傳送整個資料庫。

## 安全

- 不得提交 `.env`、API key、Database URL、`ADMIN_KEY`、`IOT_SYNC_KEY` 或 LINE token。
- 管理 API 必須通過管理驗證與 rate limit。
- IoT 同步使用 `x-iot-sync-key`；正式環境應設定獨立 `IOT_SYNC_KEY`。
- LINE webhook 必須驗證 `X-Line-Signature`。
- 使用參數化 SQL，不可將使用者輸入直接拼入查詢。
- 管理操作與 webhook 問題應留下可追查紀錄，但不得在 log 印出密鑰或完整敏感資料。

## 文件規則

- 現行文件依 `docs/b2c/`、`docs/b2b/`、`docs/operations/`、`docs/reference/` 分類。
- 不新增日期型 handoff；把有效內容更新到現行文件。
- `docs/archive/` 只供追溯，`docs/future/` 只放未實作規劃。
- 功能、路徑或資料規則改變時，同步更新 `docs/README.md` 與對應現行文件。

## 部署

Render 由 GitHub `main` 自動部署，啟動指令為 `npm start`。部署與環境設定見 [`docs/operations/DEPLOYMENT_RUNBOOK.md`](docs/operations/DEPLOYMENT_RUNBOOK.md)。
