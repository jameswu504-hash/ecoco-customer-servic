# ECOCO AI 客服

[![CI](https://github.com/jameswu504-hash/ecoco-customer-servic/actions/workflows/ci.yml/badge.svg)](https://github.com/jameswu504-hash/ecoco-customer-servic/actions/workflows/ci.yml)

Node.js、Express、PostgreSQL、Claude 與 RAG 組成的 ECOCO 客服系統。B2C 是核心服務；B2B 透過 LINE 群組綁定，在同一套系統上提供依公司隔離的專屬知識。

## 正式入口

- [B2C AI 客服](https://ecoco-customer-servic.onrender.com/)
- [客服後台](https://ecoco-customer-servic.onrender.com/dashboard.html)（需要 `ADMIN_KEY`）
- [B2B 合作夥伴後台](https://ecoco-customer-servic.onrender.com/partners.html)（需要 `ADMIN_KEY`）
- [健康檢查](https://ecoco-customer-servic.onrender.com/healthz)

## 目前架構

```text
ECOCO AI 客服
├─ B2C 核心
│  ├─ 官網聊天
│  ├─ LINE 一對一聊天
│  ├─ ECOCO 共用知識 RAG
│  └─ Hive 站點狀態同步鏡像
└─ B2B 擴充
   ├─ LINE 群組綁定
   ├─ 公司專屬知識 RAG
   └─ 群組對話保存、清洗與人工審核
```

- B2C 不需要群組綁定，也不能讀取合作公司的私有資料。
- 所有 LINE 群組先進 B2B gate；完成綁定後才可使用該公司的資料。
- 公司知識以 `company_id` 在 SQL 查詢層隔離。
- 站點資料由 Hive／Azure MySQL 定期同步至 PostgreSQL，不放在靜態知識庫。
- OpenAI embedding 不可用時會退回關鍵字 RAG，Claude 仍負責產生回答。

完整說明見 [文件索引](docs/README.md) 與 [系統架構](docs/ARCHITECTURE.md)。

## 主要目錄

| 路徑 | 用途 |
|---|---|
| `server.js`、`routes/`、`services/` | API、LINE 分流、RAG 與業務邏輯 |
| `db/` | PostgreSQL schema 與資料存取 |
| `public/` | B2C 前台、客服後台與 B2B 後台 |
| `scripts/` | 知識維護、評測、IoT 同步與安全掃描 |
| `tests/` | 自動化測試 |
| `evals/` | 黃金評測集 |
| `docs/` | 依 B2C、B2B、維運與技術參考分類的文件 |
| `skills/ecoco-clean-brand-knowledge/` | B2B 品牌資料清洗 Skill |

`skills/ecoco-clean-brand-knowledge/` 是唯一正式來源；`.agents/skills/` 是 Agent 相容副本。修改 Skill 後執行 `npm run skill:sync`，完整測試會檢查兩份內容是否完全一致。

## 本機啟動

需求：Node.js 20 以上與 PostgreSQL。

```bash
npm install
copy .env.example .env
npm start
```

預設入口：

- `http://localhost:3000/`
- `http://localhost:3000/dashboard.html`（由後端送出唯一維護的 `dashboard-v2.html`）
- `http://localhost:3000/partners.html`
- `http://localhost:3000/healthz`

環境變數以 `.env.example` 為準。API key、Database URL、管理密鑰與 LINE token 不可提交到 Git。

## 驗證

```bash
npm run lint
npm run check:syntax
npm test
npm run eval:validate
npm run scan:pii
git diff --check
```

`npm run lint` 使用 ESLint 檢查未定義變數、未使用程式碼及常見錯誤；`npm run check:syntax` 保留純 `node --check` 語法掃描。兩者用途不同，提交前都要通過。

## 知識與站點資料

- 線上共用知識以 PostgreSQL 為準。
- `data/ecoco-knowledge-import.json` 是人工確認後的備份與移轉檔，不會自動覆蓋正式資料庫。
- B2B 公司文件先清洗、預覽、人工核准，再寫入公司專屬表與 chunks。
- 站點查詢讀取 `iot_station_statuses`；來源由 Hive 同步程序更新。

細節見 [知識與資料來源](docs/reference/KNOWLEDGE_DATA.md) 與 [Hive／IoT 站點狀態同步](docs/operations/IOT_STATION_STATUS.md)。

## LINE

正式 LINE webhook：

```text
https://ecoco-customer-servic.onrender.com/api/line/webhook
```

一個 LINE channel 只能設定一個 webhook URL。私訊走 B2C，群組走 B2B 綁定與觸發規則。設定與排錯見 [LINE 串接](docs/operations/LINE_INTEGRATION_GUIDE.md)。

## 文件維護

現行文件只放在 `docs/b2c/`、`docs/b2b/`、`docs/operations/`、`docs/reference/` 與 `docs/ARCHITECTURE.md`。`docs/archive/` 是歷史資料，`docs/future/` 是尚未正式實作的規劃，兩者都不是目前行為的依據。
