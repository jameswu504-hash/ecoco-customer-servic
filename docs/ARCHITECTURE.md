# ECOCO AI 客服目前架構

## 1. 產品層次

ECOCO AI 客服以 B2C 為核心，B2B 是共用同一後端與 LINE 官方帳號的擴充層。

```text
ECOCO AI 客服
├─ B2C AI 客服
│  ├─ 官網聊天
│  ├─ LINE 一對一聊天
│  ├─ ECOCO 共用 RAG 知識
│  └─ Hive 站點狀態鏡像
└─ B2B 合作夥伴
   ├─ LINE 群組綁定 gate
   ├─ 公司專屬 RAG 知識
   └─ 對話保存、清洗、候選知識與審核
```

## 2. 請求分流

### B2C

- 官網 `/api/chat`：直接走 B2C 回答流程。
- LINE `source.type = user`：走 B2C 回答流程。
- 使用 ECOCO 共用知識；站點問題另查同步到 PostgreSQL 的 Hive 站點資料。
- 不會讀取任何合作公司的私有知識。

### B2B

- LINE `source.type = group`：一定先進 B2B 群組 gate。
- 未綁定群組只顯示綁定指引，不會退回 B2C 回答。
- 已綁定群組可查 ECOCO 共用知識，以及該 `company_id` 的公司專屬知識。
- 不同公司的資料不可交叉檢索。

## 3. 主要元件

| 元件 | 職責 |
|---|---|
| `server.js` | Express API、LINE webhook、B2C/B2B 分流、RAG、資料庫存取 |
| `public/` | B2C 前台、唯一維護的 `dashboard-v2.html` 客服後台與 B2B 合作夥伴後台；公開 `/dashboard.html` 由後端送出 V2 |
| PostgreSQL | 共用知識、公司知識、對話、群組綁定、站點狀態與稽核紀錄 |
| Claude API | 依檢索片段產生回答 |
| OpenAI Embedding API | 可選的語意向量；額度不足時退回關鍵字檢索 |
| Hive／Azure MySQL | 站點與設備狀態來源，由同步程式讀取，不由每次客服請求直接查詢 |

## 4. 資料隔離

| 資料 | 使用範圍 |
|---|---|
| `knowledge_sections`、`knowledge_chunks` | B2C 與所有 B2B 群組可使用的 ECOCO 共用知識 |
| `partner_knowledge_sections`、`partner_knowledge_chunks` | 只限相同 `company_id` 的已綁定群組 |
| `iot_station_statuses` | B2C 與需要站點資訊的 B2B 問題；內容來自 Hive 同步鏡像 |
| `partner_line_groups` | LINE 群組與合作公司的永久綁定關係 |
| `partner_conversations`、`line_webhook_events` | 群組對話與 webhook 追蹤紀錄 |

## 5. 安全與資料處理

- Webhook 會驗證 LINE 簽章。
- 管理 API 需 `ADMIN_KEY`，同步 API 需 `IOT_SYNC_KEY`（未設定時目前保留相容 fallback）。
- B2B 群組對話保存前會遮蔽敏感資料。
- B2B 回答只把該問題檢索到的必要片段送給 Claude，不會傳送整個公司資料庫。
- 檔案清洗在本機以規則處理，不把原始文件交給外部 AI。
- 高風險 guardrail 會將資料庫的 `risk_level` 與記憶體 Chunk 的 `riskLevel` 正規化為相同判斷，不因資料形狀差異失效。

## 6. 品質門檻

- `npm run lint` 執行 ESLint；`npm run check:syntax` 執行純語法掃描。
- HTTP 整合測試涵蓋客服、LINE、B2B、營運報表及 Internal Wiki 權限與資料操作。
- `skills/ecoco-clean-brand-knowledge/` 是清洗 Skill 唯一來源；`.agents/skills/` 必須由同步指令產生並保持完整一致。

更細的操作與資料規則請從 [文件索引](README.md) 進入各模組文件。
