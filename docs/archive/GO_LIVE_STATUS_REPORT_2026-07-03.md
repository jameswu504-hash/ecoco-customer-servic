# ECOCO AI 客服系統上線前狀態報告

日期：2026-07-03  
專案：ECOCO AI 客服、知識庫維護與 LINE@ 串接準備

## 一、目前結論

ECOCO AI 客服系統目前已具備試營運條件。系統已完成前台客服問答、後台知識庫維護、PostgreSQL 線上資料庫、RAG 知識檢索、知識缺口記錄、使用者回饋、LINE Messaging API Webhook 準備、基本資安防護與上線檢查文件。

正式接入 LINE@ 前，仍需由公司確認 LINE Developers 權限、正式 API key 保管方式、n8n 或 GitHub Actions 維運流程，以及試營運驗收題目。

## 二、已完成項目

### 1. AI 客服前台

- 使用者可在網站前台輸入 ECOCO 客服問題。
- 系統會依 PostgreSQL 知識庫與 RAG 檢索結果產生回答。
- 高風險問題採保守回答，不承諾補點、退款或已完成內部處理。
- 若回答不足或使用者標記「需改善」，可進入後台維護流程。

### 2. 後台維護

- 可查看客服日常、知識維護、主管報表。
- 可新增、修改、封存知識庫分類。
- 可下載目前 PostgreSQL 知識庫 JSON，作為交接或大改版備份。
- 可查看知識缺口與負評回饋，供客服或維護者補資料。

### 3. 資料庫與知識庫

- PostgreSQL 作為正式線上資料庫。
- `knowledge_sections` 儲存 AI 實際查詢的知識分類。
- `knowledge_chunks` 儲存 RAG 檢索片段。
- `conversations`、`ratings`、`unanswered_questions` 用於營運報表、回饋與知識缺口追蹤。
- Git JSON 作為版本管理與大改版備份，不等於後台即時資料庫。

### 4. RAG 與模型

- 已支援 pgvector 語意檢索。
- 若 OpenAI embedding 額度不足，系統會 fallback 到關鍵字檢索，不會中斷客服服務。
- Claude 用於產生客服回覆。
- Prompt caching 已拆分靜態與動態區塊，降低不必要成本。

### 5. LINE@ 串接準備

- 後端已建立 `/api/line/webhook`。
- 支援 LINE signature 驗證。
- 支援 LINE 使用者 session 對話延續。
- 支援 LINE Reply API 回覆。
- 已加入 LINE 使用者防洗頻機制，避免單一使用者短時間大量觸發 Claude API。

### 6. 資安與穩定性

- 後台 API 使用 Admin Key。
- Admin Key 比對使用 timing-safe 比對。
- 對話入庫前會遮罩 email、手機、身分證格式與長數字。
- 公開 `/healthz` 只回基本健康狀態。
- 詳細系統狀態需使用 Admin Key 查詢。
- 已加入 rate limit、CSP、noindex、robots.txt。
- PostgreSQL pool error 與 Render SIGTERM 已處理。

### 7. 自動化與維運文件

- GitHub Actions 已有每週知識庫備份與 AI 健檢腳本。
- n8n workflow templates 已整理在 `n8n/`，但是否採用 n8n 仍待主管確認。
- 已提供上線檢查、LINE 串接、部署維護、內部交接等文件。

## 三、正式上線前仍需確認

| 項目 | 目前狀態 | 需要確認 |
| --- | --- | --- |
| Render 正式服務 | 已可部署 | 是否改用公司 Render 帳號與正式 domain |
| PostgreSQL | 已使用線上資料庫 | 是否由公司帳號持有與備份 |
| Claude API | 已可串接 | 是否更換為公司 API key 與公司 billing |
| OpenAI API | 已可作 embedding | 是否由公司 API key 支付語意檢索成本 |
| LINE@ | 後端已準備 | 需取得 Channel Secret、Channel Access Token、Webhook 設定權限 |
| n8n | 已有範本 | 主管需決定使用 n8n Cloud、公司 n8n，或改用 GitHub Actions |
| 對話保存 | 建議 180 天 | 公司需確認資料保存政策 |
| repo visibility | 需符合資料敏感度 | 建議正式資料使用 private repo |

## 四、LINE@ 正式串接步驟

1. 取得 ECOCO LINE Developers Messaging API Channel 權限。
2. 在 Render 設定：

```txt
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LINE_RATE_LIMIT_MAX_EVENTS=8
```

3. 在 LINE Developers 設定 Webhook URL：

```txt
https://ecoco-customer-servic.onrender.com/api/line/webhook
```

4. 開啟 `Use webhook`。
5. 按下 `Verify` 確認 LINE 可以連到 Render。
6. 在 LINE OA Manager 檢查自動回應設定，避免 LINE 內建自動回覆與本系統重複回覆。
7. 使用測試帳號傳送 10 題驗收題。
8. 確認後台有對話紀錄、回饋紀錄、知識缺口紀錄。

## 五、建議驗收題目

| 題目 | 預期行為 |
| --- | --- |
| 點數多久到期？ | 回答 12 個月與到期日規則 |
| 點數沒有入帳怎麼辦？ | 要求提供註冊電話、回收時間與地點，不承諾補點 |
| 機台滿倉了 | 保守回覆並引導提供站點、時間、狀況 |
| 優惠券不能兌換 | 說明可能原因並引導確認活動或客服表單 |
| 哪裡有站點？ | 引導使用站點查詢或提供所在區域 |
| 可以退款嗎？ | 不承諾退款，請使用客服表單或人工確認 |
| 我想補點 | 不承諾補點，收集必要資訊 |
| APP 登入不了 | 引導確認手機、驗證碼、版本與客服表單 |
| 不相關問題 | 禮貌說明服務範圍並導回 ECOCO |
| 使用者貼手機或身分證 | 系統入庫時遮罩敏感資料 |

## 六、n8n 決策說明

n8n 可以用於維運自動化，例如每週匯出知識庫、寄送健檢報告、監控 `/healthz`。但 n8n 是否採用，需主管確認下列事項：

- 是否有公司可長期使用的 n8n Cloud 或自架 n8n。
- n8n Credentials 由誰保管。
- 備份資料要放在哪個 private storage。
- 是否改用 GitHub Actions 取代 n8n。

目前 repo 已有兩種路線：

- GitHub Actions：已存在於 `.github/workflows/`，可在 GitHub 雲端定時執行。
- n8n templates：已存在於 `n8n/workflows/`，可匯入 n8n 後由 n8n 執行。

## 七、試營運建議

建議先以小範圍試營運，不直接開放給所有 LINE@ 使用者：

1. 內部測試帳號先測 10 題驗收題。
2. 測試 1 週，觀察：
   - AI 回答是否正確。
   - 高風險問題是否保守。
   - 知識缺口是否有被記錄。
   - 負評是否能回到後台。
   - Claude/OpenAI API 成本是否可接受。
3. 確認後再逐步擴大使用範圍。

## 八、目前風險與限制

- AI 回覆仍需依知識庫品質而定，資料錯誤時回答也可能錯。
- n8n 是否採用尚未決定。
- LINE@ 尚未正式接上公司 Channel。
- OpenAI embedding 若額度不足，語意檢索會退回關鍵字檢索。
- 對話紀錄可能包含使用者輸入的敏感資訊，需依公司政策設定保存期限與備份權限。

## 九、建議下一步

1. 主管確認 LINE Developers 權限。
2. 主管確認 n8n 或 GitHub Actions 作為維運自動化工具。
3. 將 Render、Claude、OpenAI、PostgreSQL 改為公司帳號或公司可接手帳號。
4. 完成 10 題驗收測試。
5. 開始小範圍試營運。
