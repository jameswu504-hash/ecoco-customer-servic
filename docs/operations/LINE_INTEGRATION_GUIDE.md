# LINE Messaging API 串接

## 渠道分流

同一個 ECOCO LINE 官方帳號與 webhook 同時服務：

| LINE 來源 | 系統行為 |
|---|---|
| 一對一 `source.type = user` | B2C AI 客服 |
| 群組 `source.type = group` | B2B 群組綁定 gate |

未綁定群組不會退回 B2C；已綁定群組依 [B2B LINE 群組規則](../b2b/README.md) 決定是否回答及可用資料。

## LINE Developers 設定

1. 在 Messaging API channel 設定 webhook URL：

   ```text
   https://ecoco-customer-servic.onrender.com/api/line/webhook
   ```

2. 開啟 webhook。
3. 將 `LINE_CHANNEL_SECRET` 與 `LINE_CHANNEL_ACCESS_TOKEN` 設在 Render 環境變數。
4. 使用 LINE Developers 的 Verify 確認端點可用。
5. 若官方帳號內建自動回覆會造成重複訊息，關閉相衝突的自動回覆設定。

同一個 LINE channel 只能設定一個 webhook URL。舊的 `ecoco-linebot.onrender.com` 不應再接收正式訊息；正式 webhook 指向本專案即可，與程式曾推送到幾個 GitHub repository 無關。

## 回覆與逾時

- Webhook 先驗證 `x-line-signature`。
- 程式優先使用 reply token；若 token 已失效且具備目標 ID，可依程式規則改用 Push API。
- LINE reply token 必須快速使用，因此模型處理時間需受控。目前預設上限由環境變數控制，正式值不應超過程式允許的 25 秒。
- Render 免費服務休眠可能使首次請求延遲，導致 reply token 過期；正式使用應避免服務休眠或確認 Push fallback 正常。

## 驗證清單

1. 私訊 Bot 一般 B2C 問題，確認有回覆。
2. 在未綁定群組發訊息，確認只出現綁定指引。
3. 在已綁定群組不點名 Bot，確認只保存紀錄且不插話。
4. 在已綁定群組點名 Bot，確認只讀取共用資料與該公司資料。
5. 查看 `line_webhook_events` 是否記錄接收、處理與回覆結果。
6. 若 LINE 沒有回答，依序檢查 webhook 是否收到、簽章、分流、模型錯誤及 Reply／Push API 結果。

## 常見誤解

- OpenAI embedding 429 只會讓語意 RAG 退回關鍵字檢索，不代表 LINE webhook 本身失效。
- Render 顯示服務 live 不代表 LINE Developers 的 webhook URL、token 或自動回覆設定正確。
- Windows LINE 顯示的 `@文字` 不一定包含官方 mention metadata；B2B 另支援訊息開頭 `@ECOCO` 或 `/ecoco`。
