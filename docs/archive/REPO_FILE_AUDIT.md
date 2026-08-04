# ECOCO 客服專案檔案稽核

本文件說明 repository 內各類檔案的現行用途。稽核以實際 `server.js`、`package.json`、route 掛載、測試與部署流程為準；新增檔案時應更新分類，而不是只維護一份容易失真的逐檔數量。

## 一、線上執行入口

| 檔案 | 用途 |
| --- | --- |
| `server.js` | Express 啟動、環境檢查、PostgreSQL、健康檢查、route 掛載與關閉流程 |
| `db/schema.js` | 線上資料表、索引與相容性 migration |
| `middleware/` | 管理員、IoT upload-only 與 staff API 驗證 |
| `routes/` | 網站聊天、LINE、後台、知識庫、報表、知識缺口與 internal API |
| `services/` | RAG、prompt、站點查詢、隱私遮罩、trace、報表與內部 Wiki 邏輯 |

## 二、前端檔案

| 檔案 | 用途 |
| --- | --- |
| `public/index.html`, `public/index.js`, `public/index.css` | 對外客服頁 |
| `public/dashboard-v2.html`, `public/dashboard-v2.css` | 管理後台實際 shell 與 v2 樣式 |
| `public/dashboard.js`, `public/dashboard.css` | 後台共用互動與基礎樣式 |
| `public/dashboard.html` | 舊 shell，相容性保留；公開 `/dashboard.html` 由 `server.js` 直接送出 v2 shell |
| `public/kb-parser.js` | 後台知識分題與組回工具 |
| `public/ecoco-logo.png`, `public/ecoco-mark.png` | 官方品牌圖 |

不要直接把 `public/dashboard.html` 當成線上實際畫面修改。後台功能與結構優先檢查 `dashboard-v2.html`、`dashboard.js` 與 server rewrite。

## 三、資料與知識

| 檔案 | 用途 |
| --- | --- |
| `knowledge.js` | 空資料庫首次初始化 fallback |
| `data/ecoco-ai-customer-service-database.json` | 完整知識底稿、來源與衝突追蹤 |
| `data/ecoco-knowledge-import.json` | 可匯入 PostgreSQL 的正式知識包 |
| `data/ecoco-response-policies.json` | 高風險回覆政策 |
| `data/knowledge-quality-audit.json` | 去重與衝突稽核結果 |
| `data/iot-station-snapshot.json` | IoT 查詢 fallback 快照；不是線上即時主資料 |
| `evals/golden-set.json` | AI 回覆品質測試案例 |

線上回答的正式執行資料仍是 PostgreSQL：固定 FAQ/SOP 在 `knowledge_sections` / `knowledge_chunks`，站點與機台狀態在 `iot_station_statuses`。

## 四、維護與同步腳本

| 類型 | 主要檔案 |
| --- | --- |
| 知識建置與稽核 | `build-ecoco-knowledge-data.js`、`audit-knowledge-quality.js`、`apply-knowledge-audit.js` |
| 匯入、備份、漂移 | `import-knowledge-json.js`、`backup.mjs`、`check-knowledge-drift.mjs` |
| AI 評測與分析 | `run-evals.mjs`、`ai-analysis.mjs`、`suggest-synonyms.mjs` |
| 安全與品質 | `lint.mjs`、`scan-pii.js`、`anonymize-pii.js` |
| IoT 同步 | `sync-iot-stations-to-postgres.js`、`export-iot-station-snapshot.js` |
| Embedding 修復 | `backfill-knowledge-embeddings.js` |
| Windows 隱藏排程 | `tools/iot-sync/run-hidden.vbs`、`run-once.ps1`、`install-scheduled-task.ps1` |

IoT 正式資料流為：本機或 VPN 環境以唯讀帳號查 Azure MySQL，再以 `IOT_SYNC_KEY` 經 Render 同步 API 寫入 Neon/PostgreSQL。Render 客服查詢雲端副本，不需要直接穿越 Azure firewall。

## 五、測試與 CI

`npm test` 執行 `tests/*.test.js`（目前 5 個測試檔），涵蓋 smoke、IoT、B2B、dashboard routes 與知識 parser。`.github/workflows/` 負責 CI、dependency audit、備份與例行分析；修改程式後至少執行：

```bash
npm run lint
npm test
npm run scan:pii
git diff --check
```

## 六、文件

`docs/README.md` 是正式索引；架構、部署、客服操作、日常維護、IoT、資料字典與評測文件都應從該索引進入。`docs/archive/` 只供歷史參考，不代表目前線上行為；`docs/future/` 是尚未正式啟用的模組。

已移除的 `docs/RAG_WORKFLOW.md` 不再列為現行或待處理檔案。RAG 現況以 `CLAUDE.md`、`docs/ARCHITECTURE.md`、`docs/EVAL_OBSERVABILITY_GUIDE.md` 與程式為準。

## 七、不得提交的 local-only 資料

| 路徑 | 原因 |
| --- | --- |
| `.env`、`.env.*`（範例檔除外） | API key、token、資料庫密碼 |
| `.local-iot-sync/` | Windows 排程的本機設定、secrets 與 logs；無機密 runner template 已放在 `tools/iot-sync/` |
| `node_modules/` | 可由 lockfile 還原 |
| 暫存匯出、備份與真實個資 | 資安與版本庫污染風險 |

上述規則由 `.gitignore` 防呆；新增本機執行資料時也應同步補 ignore 規則。

## 八、結論

目前 repository 已包含完整客服服務、LINE、RAG、後台、IoT 雲端副本同步、測試與維運文件。不要再以「單一 `server.js` + 舊 dashboard」理解架構，也不要把本機同步程式或 `.local-iot-sync/` 當成 Render 線上檔案。
