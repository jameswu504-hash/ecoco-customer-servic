# ECOCO LINE@ 串接落地清單

本文件用於正式討論 ECOCO AI 客服與 LINE Official Account 的串接方式。目標是讓客服、主管與技術窗口清楚知道需要哪些權限、資料、設定與測試流程。

## 1. 建議串接方式

建議使用 LINE Official Account 的 Messaging API 與 Webhook 串接，不建議把 LINE 後台內建的「AI 聊天機器人」作為主要客服系統。

採用 Messaging API 的原因：

- 可沿用目前已整理的 PostgreSQL 知識庫。
- 可沿用現有 RAG、風險控管、知識缺口與評分流程。
- 不需要在 LINE 後台重新建立另一套 FAQ。
- 可讓網站客服與 LINE@ 回覆口徑一致。
- 後續可追蹤對話、負評與知識缺口。

## 2. 串接流程

```text
使用者在 LINE@ 傳訊息
  -> LINE Platform 發送 Webhook event
  -> Render 後端 /api/line/webhook
  -> 驗證 LINE signature
  -> 使用 ECOCO AI 客服既有回答流程
  -> 查詢 PostgreSQL knowledge_sections / knowledge_chunks
  -> Claude 產生回覆
  -> LINE Reply API 回覆使用者
  -> 後台保留對話、評分與知識缺口
```

## 3. 需要公司提供的權限與資料

| 項目 | 用途 | 提供窗口 |
| --- | --- | --- |
| LINE Official Account 管理權限 | 確認官方帳號設定、回應模式與測試 | LINE OA 管理者 |
| LINE Developers 權限 | 建立或管理 Messaging API Channel | LINE Developers 管理者 |
| Channel Secret | 驗證 LINE Webhook 來源 | 技術窗口 |
| Channel Access Token | 呼叫 LINE Reply API 回覆使用者 | 技術窗口 |
| Webhook URL 設定權限 | 將 Render endpoint 填入 LINE Developers | 技術窗口 |
| 測試 LINE 帳號 | 試營運前驗證回覆流程 | 客服 / 測試人員 |
| 人工客服表單連結 | 高風險或個案問題轉人工 | 客服主管 |
| LINE 回覆語氣規範 | 確認稱呼、emoji、正式或活潑程度 | 客服主管 / 行銷 |

## 4. Render 需要設定的環境變數

正式測試 LINE 前，Render Environment Variables 至少需要：

```text
LINE_CHANNEL_SECRET=<LINE Developers Channel Secret>
LINE_CHANNEL_ACCESS_TOKEN=<LINE Developers Channel Access Token>
LINE_REPLY_TIMEOUT_MS=45000
```

其他正式上線資源仍需確認：

```text
DATABASE_URL=<company PostgreSQL connection string>
ANTHROPIC_API_KEY=<company Claude API key>
OPENAI_API_KEY=<company OpenAI API key, semantic RAG 使用>
ADMIN_KEY=<company admin key>
CONVERSATION_RETENTION_DAYS=180
```

## 5. LINE Developers 設定

Webhook URL 使用 Render 的正式網址：

```text
https://ecoco-customer-servic.onrender.com/api/line/webhook
```

設定時需確認：

- Webhook 已啟用。
- Verify 測試成功。
- LINE Channel Secret 與 Render 設定一致。
- LINE Channel Access Token 未過期。
- 若接管自動回覆，需確認 LINE OA 內建自動回覆不會與本系統重複回覆。

## 6. 試營運測試題

建議先用測試帳號測以下題型：

| 題型 | 測試目的 |
| --- | --- |
| 點數多久到期 | 確認基本 FAQ 能回答 |
| 點數沒有入帳 | 確認 AI 會收集必要資訊，不承諾補點 |
| 優惠券不能兌換 | 確認 AI 不承諾補償或保證可兌換 |
| 機台滿倉或故障 | 確認 AI 會引導回報站點、時間與狀況 |
| App / 帳號問題 | 確認 AI 會引導客服表單，不查個資 |
| 未知新活動或新站點 | 確認 AI 會保守回答並留下知識缺口 |
| 一般問候 | 確認品牌語氣自然 |

## 7. 上線前檢查

| 檢查項目 | 狀態 |
| --- | --- |
| LINE Developers 權限已取得 | 待確認 |
| Channel Secret 已設定到 Render | 待確認 |
| Channel Access Token 已設定到 Render | 待確認 |
| LINE reply timeout 已設定或使用預設 45 秒 | 待確認 |
| Webhook URL Verify 成功 | 待確認 |
| LINE OA 內建自動回覆已檢查 | 待確認 |
| 客服表單連結已確認 | 待確認 |
| 高風險問題測試通過 | 待確認 |
| 知識缺口與負評流程有人負責 | 待確認 |
| 每週備份與 AI 健檢可正常執行 | 待確認 |

## 8. 費用與維運說明

若使用者先傳訊息，系統用 LINE Reply API 回覆，LINE 端通常不會另外收取 Reply API 訊息費。主要成本會來自：

- Claude API 回覆成本。
- OpenAI embedding 成本。
- Render 主機。
- PostgreSQL 資料庫。
- n8n 或 GitHub Actions 維運流程。

若未來要主動推播、群發活動或分眾行銷，需另外確認 LINE Official Account 的訊息方案與計費方式。

## 9. 建議決策

正式接入前，建議由客服主管與技術窗口共同確認：

1. 是否先用測試 Channel 或小範圍測試。
2. 是否讓 AI 自動回覆所有 LINE 使用者，或先限定時段 / 題型。
3. 哪些問題必須轉人工。
4. 誰負責每週查看知識缺口與負評。
5. 誰負責管理 Channel Secret、Access Token 與 Render 權限。
