# ECOCO AI 客服 LINE@ 串接說明

本文件說明 ECOCO AI 客服系統如何與 LINE Official Account（LINE@）結合使用。正式串接方式採用 LINE Messaging API，不使用 LINE 後台內建的「AI 聊天機器人（Beta）」。

## 1. 整合架構

```text
LINE 使用者訊息
  -> LINE Official Account
  -> Messaging API Webhook
  -> Render /api/line/webhook
  -> ECOCO AI 客服後端
  -> PostgreSQL 知識庫與 RAG 檢索
  -> Claude 產生回覆
  -> LINE Reply API 回覆使用者
```

這樣做的好處是 LINE、網站前台與後台維護可以共用同一套知識庫、回覆規則、風險控管、對話紀錄與知識缺口紀錄，不需要在 LINE 後台重建另一套 FAQ。

## 2. Webhook URL

Render 正式環境目前可使用：

```text
https://ecoco-customer-servic.onrender.com/api/line/webhook
```

LINE Developers 後台要把這個 URL 填到 Messaging API 的 Webhook URL。

## 3. 需要的權限與金鑰

公司需要提供或開通 LINE Developers 的 Messaging API Channel 權限，至少包含：

| 項目 | 用途 | 放置位置 |
| --- | --- | --- |
| Channel Secret | 驗證 LINE 傳來的 webhook 是否可信 | Render `LINE_CHANNEL_SECRET` |
| Channel Access Token | 讓後端呼叫 LINE Reply API 回覆訊息 | Render `LINE_CHANNEL_ACCESS_TOKEN` |
| Webhook 設定權限 | 將 Render URL 填入 LINE Developers | LINE Developers Console |

上述金鑰不可放進 GitHub、GitLab、文件或截圖公開處，只能放在 Render Environment Variables。

## 4. LINE Developers 設定流程

1. 進入 LINE Developers Console。
2. 選擇 ECOCO 官方帳號對應的 Provider 與 Messaging API Channel。
3. 在 Basic settings 複製 `Channel secret`。
4. 在 Messaging API 分頁發行或複製 `Channel access token`。
5. 到 Render 的 Environment Variables 加入：
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
6. Redeploy Render 服務。
7. 回到 LINE Developers 的 Messaging API 分頁。
8. 將 Webhook URL 設為：
   `https://ecoco-customer-servic.onrender.com/api/line/webhook`
9. 開啟 `Use webhook`。
10. 按下 `Verify` 確認 webhook 可連線。

## 5. LINE Official Account Manager 設定提醒

為了避免同一則訊息被 LINE 內建功能與 ECOCO AI 後端同時回覆，正式測試前請確認：

- Webhook 已啟用。
- 若要讓 ECOCO AI 全自動回覆，LINE 後台的自動回應訊息需避免與 AI 回覆重疊。
- 不建議同時使用 LINE 內建「AI 聊天機器人（Beta）」與本專案後端回覆同一批客服訊息。

## 6. 後端目前支援內容

目前 `/api/line/webhook` 支援：

- 接收 LINE 文字訊息。
- 驗證 LINE signature，避免偽造請求。
- 依 LINE user/group/room 產生固定 session id。
- 讀取同一個 LINE session 的近期對話紀錄，避免每次都像第一次對話。
- 使用目前的 PostgreSQL 知識庫、RAG 檢索與回覆政策。
- 回覆前將 Markdown 轉成 LINE 較適合閱讀的純文字。
- 將 LINE 對話寫入 `conversations`，並套用個資遮罩。
- 若 AI 回覆被判定為知識缺口，寫入 `unanswered_questions` 供後台補資料。

目前不支援：

- 圖片、語音、貼圖解析。
- 主動推播或群發活動訊息。
- LINE 使用者個人資料查詢。
- 補點、退款、帳務異動等高風險操作。

## 7. 測試檢查表

正式上線前，建議逐項確認：

- Render 已設定 `DATABASE_URL`、`ANTHROPIC_API_KEY`、`ADMIN_KEY`。
- Render 已設定 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`。
- Render logs 沒有 `LINE integration is not configured`。
- LINE Developers Webhook `Verify` 成功。
- 使用 LINE 傳「點數多久到期」能收到 AI 回覆。
- 使用 LINE 傳「點數沒有入帳」時，AI 會保守回答並要求必要資訊。
- 使用 LINE 傳 AI 無法確認的問題時，後台能看到知識缺口或負評紀錄。
- LINE 後台沒有另一套自動回覆造成重複回覆。

## 8. 成本說明

若採用「使用者先傳訊息，系統用 Reply API 回覆」模式，LINE 端通常不會另外收取 Reply API 訊息費。主要成本會落在：

- Claude / Anthropic API：產生 AI 回覆。
- OpenAI API：語意檢索 embedding（若啟用）。
- Render：後端服務。
- PostgreSQL / Neon：資料庫。

若未來要做主動推播、群發活動通知或分眾行銷，則需另外確認 LINE Official Account 的訊息方案與計費方式。

## 9. 上線建議

建議先以小範圍測試帳號驗證，確認回覆品質、知識缺口紀錄與後台維護流程都正常後，再逐步擴大到正式 LINE@ 使用者。
