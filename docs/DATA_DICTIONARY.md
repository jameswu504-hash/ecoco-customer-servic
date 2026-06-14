# ECOCO AI 客服資料字典

## PostgreSQL 資料表

### `conversations`

儲存每一次使用者與 AI 的對話。

| 欄位 | 說明 |
| --- | --- |
| `id` | 系統流水號 |
| `session_id` | 同一段對話的識別碼 |
| `role` | `user` 或 `assistant` |
| `content` | 訊息內容 |
| `timestamp` | 建立時間 |

用途：

- 後台查看每次對話。
- 分析常見問題。
- 找出 AI 是否答錯或答不完整。

### `ratings`

儲存使用者對 AI 回覆的評分。

| 欄位 | 說明 |
| --- | --- |
| `id` | 系統流水號 |
| `msg_id` | 前端訊息 ID |
| `type` | 評分類型，例如喜歡或不喜歡 |
| `question` | 使用者問題 |
| `reply` | AI 回覆 |
| `timestamp` | 評分時間 |

用途：

- 看哪些回答讓使用者不滿意。
- 回頭修正知識庫或 prompt。

### `unanswered_questions`

儲存 AI 判斷自己無法完整回答的問題。

| 欄位 | 說明 |
| --- | --- |
| `id` | 系統流水號 |
| `session_id` | 對話識別碼 |
| `question` | 使用者原始問題 |
| `reply` | AI 當時的回覆 |
| `reason` | 被判斷為知識缺口的原因 |
| `timestamp` | 記錄時間 |

用途：

- 每週整理 AI 答不出來的問題。
- 請內部確認答案。
- 補回 `knowledge_sections`。

### `knowledge_sections`

AI 實際回答時讀取的主要知識庫。

| 欄位 | 說明 |
| --- | --- |
| `id` | 系統流水號 |
| `category` | 知識分類名稱 |
| `content` | 該分類的完整內容 |
| `sort_order` | 排序 |
| `updated_at` | 最後更新時間 |

用途：

- 產生 Claude system prompt。
- 控制 AI 目前知道哪些 ECOCO 官方資訊。
- 後台可新增、修改、刪除分類。

## JSON 資料檔

### `data/ecoco-ai-customer-service-database.json`

完整資料底稿。它比 `knowledge_sections` 更細，適合做資料整理、版本管理、來源追蹤與衝突標記。

常見內容包括：

- `knowledge_records`
- `social_reply_templates`
- `response_policies`
- `internal_ops_signals`
- `brand_guidelines`
- `source_documents`
- `conflicts_pending_review`

### `data/ecoco-knowledge-import.json`

由完整資料底稿整理後產生，是實際要匯入 PostgreSQL 的版本。

主要結構：

| 欄位 | 說明 |
| --- | --- |
| `generated_at` | 產生時間 |
| `source` | 來源說明 |
| `summary` | 資料量摘要 |
| `sections` | 要匯入 `knowledge_sections` 的分類內容 |

### `data/ecoco-response-policies.json`

存放高風險問題的處理規則，例如：

- 點數問題。
- 優惠券兌換問題。
- 機台異常。
- 帳號問題。
- 客訴與補償相關問題。

這類規則應該偏保守，AI 不應自行承諾補點、退款、賠償或已完成人工處理。

## `.env` 與 Render Environment Variables

`.env` 不是資料庫，也不是知識庫。它是機密設定檔。

常見變數：

| 變數 | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key |
| `ANTHROPIC_MODEL` | Claude 模型名稱 |
| `DATABASE_URL` | PostgreSQL 連線字串 |
| `PGSSL` | PostgreSQL SSL 設定 |
| `ADMIN_KEY` | 後台管理 key |
| `KNOWLEDGE_AUTO_SYNC` | 啟動時是否同步知識 JSON |
| `PORT` | 本機或平台使用的 port |

注意：

- 本機用 `.env`。
- Render 上線用 Environment Variables。
- GitHub 只能放 `.env.example`，不能放真正 `.env`。

