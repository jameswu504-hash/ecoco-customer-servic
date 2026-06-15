# ECOCO AI 客服資料庫匯入說明

本專案目前以 `data/ecoco-ai-customer-service-database.json` 作為 AI 客服主資料庫底稿，再由 `scripts/build-ecoco-knowledge-data.js` 產出可匯入 PostgreSQL `knowledge_sections` 的 `data/ecoco-knowledge-import.json`。

## 最新資料來源

目前採用 2026-06-12 整合版資料，只保留可用且標記為 active 的資料。舊 CommandCenter 只抽品牌脈絡與流程概念，不匯入舊憑證、舊信箱設定或舊 AI 草稿中的錯誤事實。

| 檔案 | 用途 |
| --- | --- |
| `data/ecoco-ai-customer-service-database.json` | 完整 AI 客服資料庫，保留細項、來源、風險、自動化等級與衝突標記 |
| `data/ecoco-knowledge-import.json` | 給 PostgreSQL `knowledge_sections` 匯入用，已依主分類整理成 53 個 section |
| `data/ecoco-response-policies.json` | 點數、優惠券、機台、帳號等高風險問題的處理規則 |

## 這次和 Git 舊資料的差異

| 項目 | Git 舊資料 | 新版資料 |
| --- | --- | --- |
| 主資料格式 | 只有 `sections` 大段文字 | 新增完整細項資料庫，含 878 筆 knowledge records |
| 匯入 section 數 | 42 個 section | 53 個 section，依主分類整理 |
| 社群回覆資料 | 只放 Meta 指令與部分回覆問答 | 新增線上 reply helper 的 81 筆社群範本 |
| FAQ 資料 | 主要來自 Excel | 同時整合 Excel 最新官網 FAQ 與線上 FAQ API |
| 舊系統資料 | 容易混入舊草稿與舊設定 | 只保留品牌脈絡，不保留舊憑證與錯誤草稿 |
| 衝突管理 | 沒有獨立欄位 | 新增 `conflicts_pending_review`，例如點數效期、App 版本、客服時間 |
| AI 使用控制 | 較難分辨可否自動回覆 | 每筆資料都有 `automation_level` 與 `risk` |

## 重產資料

如果 `data/ecoco-ai-customer-service-database.json` 更新，可重產 PostgreSQL 匯入檔：

```bash
npm run build:knowledge
```

匯入 PostgreSQL：

```bash
npm run import:knowledge
```

若要清空後重新匯入：

```bash
npm run import:knowledge -- data/ecoco-knowledge-import.json --replace
```

## 線上自動同步

後端啟動時會自動讀取 `data/ecoco-knowledge-import.json`，並同步到 PostgreSQL 的 `knowledge_sections`。目前預設安全模式為 `enabled`，實際行為等同 `insert_only`：只新增 Git JSON 裡有、PostgreSQL 尚未存在的分類，不覆寫後台已編輯的同名分類。因此在 Render 這類會自動部署 GitHub main 分支的環境中，流程會變成：

1. 更新 AI 客服資料。
2. 執行 `npm run build:knowledge` 重產匯入 JSON。
3. Commit 並 push 到 GitHub。
4. Render 重新部署後，server 啟動時自動補入 PostgreSQL 缺少的知識分類。

如果未來想改成只在後台手動編輯知識庫，不希望每次部署都同步 Git 資料，可在環境變數設定：

```bash
KNOWLEDGE_AUTO_SYNC=disable
```

如果確定要以 Git 內的 JSON 更新同名分類並新增新分類，可設定：

```bash
KNOWLEDGE_AUTO_SYNC=upsert
```

如果確定要以 Git 內的 JSON 完全覆蓋 PostgreSQL 知識庫，可設定：

```bash
KNOWLEDGE_AUTO_SYNC=replace
```

## 使用原則

1. 低風險 FAQ 可讓 AI 直接回答。
2. 點數、優惠券、帳號、客訴、機台異常屬高風險，但仍採全自動回覆；AI 只能用保守話術、收集必要資訊、引導 App 或客服表單，不可承諾補點、退款或已完成人工處理。
3. `conflicts_pending_review` 內的資料不可直接變成正式答案，必須由主管或官方來源確認。

## PostgreSQL 匯出回 JSON

後台編輯會寫入 PostgreSQL。若要把後台新增或修改的資料整理回 Git，可以呼叫：

```text
GET /api/knowledge/export
```

此 API 需要 Admin Key，輸出格式包含：

- `generated_at`
- `source`
- `notes`
- `summary`
- `sections`

`sections` 內容可作為回寫 `data/ecoco-knowledge-import.json` 的人工整理來源。這不是自動覆蓋 Git 的功能，目的是避免後台資料遺失，同時保留人工審核與版本控管。

## 回覆政策接入

`data/ecoco-response-policies.json` 已接入後端 system prompt。AI 回答高風險問題時，會使用政策中的：

- 必收資料
- 可說內容
- 不可說內容
- 自動化等級

若問題涉及點數、優惠券、帳號、客訴或機台異常，後端也會動態加入更嚴格的保守回答限制。
4. `internal_ops_signals` 只供客服後台提示，不建議對客戶逐字揭露。
5. 舊 CommandCenter ticket 只做流程理解，不匯入 AI 對客知識庫。
