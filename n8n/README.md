# ECOCO n8n Workflow Templates

這個資料夾保存 ECOCO AI 客服可匯入 n8n 的 workflow 範本。

## 重要觀念

- Git 只負責保存 workflow JSON，不會自動執行 n8n。
- 要讓 workflow 在你的電腦關機後仍然執行，必須使用 n8n Cloud、公司伺服器、自架 n8n，或改用 GitHub Actions。
- 本專案已另外提供 GitHub Actions 版本的每週備份與 AI 健檢，位置在 `.github/workflows/`。

## 安全原則

- 不要把 Admin Key、GitHub Token、Claude API Key、SMTP 密碼寫進 workflow JSON。
- 匯入 n8n 後，請用 n8n Credentials 或環境變數填入密鑰。
- 匯出 workflow 前，先檢查 JSON 內沒有真實 key。

## 範本清單

| 檔案 | 用途 |
| --- | --- |
| `workflows/healthz-monitor.template.json` | 每 5 分鐘檢查 `/healthz`，失敗時通知維護者 |
| `workflows/weekly-knowledge-backup.template.json` | 每週匯出知識庫 JSON，寄出備份提醒 |
| `workflows/weekly-ai-health-check.template.json` | 每週讀取知識缺口與系統狀態，產出維護提醒 |

## 匯入方式

1. 打開 n8n。
2. 進入 `Workflows`。
3. 選擇 `Import from File`。
4. 匯入本資料夾內的 `.template.json`。
5. 逐一設定 HTTP Header、Email、Claude 等 Credentials。
6. 測試成功後再啟用 workflow。

## 建議環境變數

```txt
ECOCO_BASE_URL=https://ecoco-customer-servic.onrender.com
ECOCO_ADMIN_KEY=<由公司管理>
ANTHROPIC_API_KEY=<由公司管理>
MAINTAINER_EMAIL=<維護者 email>
```

如果 n8n 不支援 `$env` 取值，請改用 n8n Credentials，不要直接把 key 寫死在 JSON。
