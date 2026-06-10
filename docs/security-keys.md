# API Key 與 Token 安全說明

舊版 CommandCenter 的 `config.json` 內含 `api_key`、`zd_token`、email 與 mail server 設定。這些屬於敏感設定，不應放在可打包傳遞的檔案中，也不應提交到 Git。

## 建議處理方式

1. 新版系統只使用 `.env` 裡的正式 API 設定。
2. 不匯入舊版 `api_key` / `zd_token`。
3. 請負責 API / Zendesk / Google Cloud 的同仁確認舊 key 是否仍有效。
4. 如果仍有效，建議停用或重產。
5. 未來任何 key 都只放在部署平台環境變數或 `.env`，不要放進 `config.json`、ZIP、README、截圖或對話紀錄。

## 對主管可用說法

我看到舊版 CommandCenter 的 `config.json` 裡有 `api_key` / `zd_token`。因為新版 ECOCO 客服系統已經有自己的 API 設定，我這邊不會沿用這組舊 key，也不會匯入新版專案或提交到 Git。

另外這組 key 已經存在於可被打包傳遞的檔案中，建議請負責 API/Zendesk 的同仁確認是否仍有效；若仍有效，建議停用或重產，避免資安風險。

