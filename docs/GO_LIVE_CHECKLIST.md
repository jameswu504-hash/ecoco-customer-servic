# ECOCO AI 客服正式上線檢查表

本文件用於正式接入 ECOCO LINE@、Render 與公司維護流程前的最後檢查。目標是確認系統不是只在個人測試環境可用，而是可以交給公司帳號、客服人員與維護者長期使用。

## 一、上線前必換成公司資源

以下項目若仍使用個人帳號，正式上線前應改為公司資源。

| 項目 | 正式上線要求 | 備註 |
| --- | --- | --- |
| GitHub / GitLab repo | 公司授權 repository | 不放個資、不放 API key |
| Render 服務 | 公司 Render workspace 或公司可管理專案 | 確認部署來源是正式 repo |
| PostgreSQL / Neon | 公司資料庫 | `DATABASE_URL` 放 Render Environment |
| Anthropic Claude | 公司 API key | `ANTHROPIC_API_KEY` |
| OpenAI Embedding | 公司 API key | `OPENAI_API_KEY`，沒有也可用關鍵字 RAG fallback |
| Admin Key | 公司管理密碼 | `ADMIN_KEY`，需足夠長且不可公開 |
| n8n | 公司或主管可接手的 n8n workspace | 不把 credential 寫死在 workflow JSON |
| Email / SMTP | 公司寄信帳號 | 用於週報、備份與健檢通知 |
| LINE Official Account | ECOCO 官方 LINE@ | 需 LINE Developers Messaging API 權限 |

## 二、Render 必要環境變數

正式上線前 Render Environment 至少需要：

```txt
DATABASE_URL=
ANTHROPIC_API_KEY=
ADMIN_KEY=
CONVERSATION_RETENTION_DAYS=180
KNOWLEDGE_AUTO_SYNC=disable
```

若要啟用語意 RAG：

```txt
OPENAI_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
```

若要接 LINE@：

```txt
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
```

注意：`REBUILD_KNOWLEDGE_CHUNKS_ON_START=always` 只在需要重建 chunks 的那次部署使用，重建完成後應移除，避免每次啟動都重建。

## 三、LINE@ 串接檢查

目前系統已預留 LINE Webhook endpoint：

```txt
https://ecoco-customer-servic.onrender.com/api/line/webhook
```

LINE 串接不是使用 LINE 後台內建的「AI 聊天機器人（β）」，而是使用 LINE Official Account Messaging API。

串接流程：

1. 使用者在 ECOCO LINE@ 傳訊息。
2. LINE 將訊息透過 Webhook 送到 `/api/line/webhook`。
3. 後端驗證 LINE signature。
4. 後端呼叫既有 ECOCO AI 客服流程。
5. 系統使用 PostgreSQL 知識庫與 RAG 產生回覆。
6. 後端透過 LINE Reply API 回覆使用者。
7. 對話寫入資料庫，供後台報表與維護參考。

正式測試前需要確認：

- LINE Developers Console 可以看到 ECOCO 的 Messaging API Channel。
- 已取得 `Channel Secret`。
- 已建立並保存 `Channel Access Token`。
- LINE OA Manager 的 Webhook 已開啟。
- 若 Webhook 正式接管自動回覆，需評估關閉 LINE OA 內建自動回應，避免重複回覆。

## 四、知識庫維護流程

日常維護以後台 PostgreSQL 知識庫為主：

1. 客服在後台新增、修改或封存知識。
2. 修改後立即影響 AI 回答。
3. 大改版、交接或正式備份前，從後台下載 JSON。
4. 人工確認 JSON 內容後，更新 `data/ecoco-knowledge-import.json` 並 commit / push。

重要：下載 JSON 只會下載目前 PostgreSQL 內容，不會自動寫回 GitHub。

## 五、資料安全檢查

正式上線前需確認：

- Repo 不包含真實手機、Email、會員資料或 API key。
- `npm run scan:pii` 通過。
- Render 環境變數不要截圖外流。
- n8n workflow 不直接寫死 API key。
- 對話紀錄保留期限已設定，例如 `CONVERSATION_RETENTION_DAYS=180`。
- 管理後台只提供給內部人員，不公開管理密碼。

## 六、上線前功能測試

建議至少測試以下問題：

- 點數多久到期？
- 點數沒有入帳怎麼辦？
- 優惠券不能兌換怎麼辦？
- 機台滿了怎麼辦？
- 機台故障或卡住怎麼辦？
- APP 登不進去怎麼辦？
- 想新增站點或合作據點怎麼辦？
- 哪些東西可以回收？
- 投錯物品怎麼辦？
- 使用者詢問非 ECOCO 範圍問題時，AI 是否會保守拒答？

測試結果應記錄為：

| 問題 | 回答是否正確 | 是否需要補知識 | 備註 |
| --- | --- | --- | --- |
|  |  |  |  |

## 七、上線判斷

可試營運條件：

- Render 正常部署。
- `/healthz` 正常回應。
- Claude API 額度正常。
- PostgreSQL 正常連線。
- LINE Webhook 驗證成功。
- 後台可登入。
- 知識庫可新增、修改、封存、下載 JSON。
- n8n 週報與備份流程可寄信。
- 主要客服問題測試通過。

不建議正式上線的情況：

- API key 仍使用個人帳號。
- Git repo 仍公開且含內部資料。
- LINE Channel Secret / Access Token 尚未確認保管方式。
- Claude 或 OpenAI 額度不足。
- 客服人員尚未知道如何處理知識缺口。
