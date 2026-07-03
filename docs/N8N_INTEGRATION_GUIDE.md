# n8n 自動化整合指南

本文件說明 ECOCO AI 客服專案如何接上 n8n。n8n 的定位是維運輔助，不是正式客服回覆入口；正式回覆仍由 Render 後端、PostgreSQL 知識庫與 Claude/OpenAI 流程負責。

## 重要原則

- n8n workflow JSON 不要直接保存 API key、Admin Key、GitHub PAT、SMTP 密碼。
- 所有密鑰應放在 n8n Credentials、n8n 環境變數，或公司核准的秘密管理位置。
- workflow 匯出前要先確認沒有 `x-admin-key`、`Authorization: Bearer ...`、`x-api-key` 等明文密鑰。
- 若曾經把密鑰寫進 workflow JSON，應重新產生並更換該密鑰。

## 現有兩個 n8n workflow 的用途

| Workflow | 用途 | 串接的系統 |
| --- | --- | --- |
| 每週知識庫備份寄信 | 每週匯出 PostgreSQL `knowledge_sections`，備份成 JSON，並寄出摘要 | Render `/api/knowledge/export`、GitHub、Email |
| 知識庫 AI 分析 | 每週讀取知識缺口與知識庫狀態，產出健檢摘要並寄信 | Render `/api/unanswered`、`/api/knowledge/sections`、Claude、Email |

## 建議新增的第三個 workflow：健康檢查監控

目的：避免網站或資料庫半夜壞掉，等到使用者回報才知道。

建議流程：

1. `Schedule Trigger`：每 5 分鐘執行一次。
2. `HTTP Request`：GET `https://ecoco-customer-servic.onrender.com/healthz`
3. `IF`：如果 HTTP request 失敗，或回傳的 `status` 不是 `ok`，進入通知分支。
4. `Email` 或 `LINE Notify / Messaging API`：寄出警示給維護者。

這個 workflow 不需要 Admin Key，因為 `/healthz` 只回公開健康狀態。

## n8n Credentials 建議

| Credential | 用在哪裡 | 欄位 |
| --- | --- | --- |
| ECOCO Admin API | 呼叫需要後台權限的 API | Header `x-admin-key` |
| GitHub | 寫入備份檔或讀取 repo | GitHub PAT 或 GitHub App |
| SMTP / Email | 寄週報、健檢、告警 | SMTP host、帳號、密碼 |
| Anthropic Claude | 產生知識庫健檢摘要 | Header `x-api-key` |

## 知識庫備份 workflow 檢查清單

1. HTTP Request URL 使用：
   `https://ecoco-customer-servic.onrender.com/api/knowledge/export`
2. Header 使用 n8n Credential 帶入 `x-admin-key`。
3. 匯出的 JSON 不直接公開到 public repo。
4. 若要寫回 GitHub，建議 repo 必須是 private。
5. 寄信內容只放摘要，不放完整客戶對話或個資。

## 知識庫健檢 workflow 檢查清單

1. 讀取缺口資料時，優先看 pending 狀態，不要把已處理/已忽略的項目混在一起。
2. 健檢摘要只能作為維護提醒，不能自動覆寫正式知識庫。
3. Claude API key 必須放在 n8n Credential，不可寫在 workflow JSON。
4. 若 Claude 額度不足，workflow 應寄出「健檢失敗」通知，而不是寄出空報告。

## DB 備份補強建議

目前知識庫備份只涵蓋 `knowledge_sections`。若公司要保留營運分析資料，還需要另外備份：

- `conversations`
- `ratings`
- `unanswered_questions`

這些資料可能包含個資，不能備份到 public repo。建議優先使用 Neon/Render PostgreSQL 的自動備份；若要用 n8n 備份，請先確認備份位置是 private，並且備份檔有存取權限控管。

## 與 Git JSON 的關係

n8n 匯出 JSON 代表「把 PostgreSQL 目前狀態下載成檔案」，不等於自動寫回 GitHub。若要讓 Git JSON 成為正式版本，流程是：

1. 從後台或 n8n 下載最新 JSON。
2. 人工檢查內容與個資。
3. 覆蓋 `data/ecoco-knowledge-import.json`。
4. commit / push。
5. Render redeploy 後，依 `KNOWLEDGE_AUTO_SYNC` 設定同步到 PostgreSQL。

## 上線前必做

- 確認 workflow JSON 內沒有明文 key。
- 確認收件人 email 是公司核准的收件人。
- 確認 Render `/healthz` 可用。
- 確認 Admin Key 已改成公司管理版本。
- 確認 GitHub repo visibility 符合資料敏感度。
