# ECOCO AI 客服正式上線確認清單

本文件用於正式接入 LINE@ 或擴大試營運前的內部確認。目標是讓客服、主管、技術窗口都能用同一份清單確認：知識是否正確、系統資源是否已換成公司資源、監控與備份是否到位。

## 1. 確認方式總覽

正式上線前不要只用口頭確認，建議採用「匯出資料 -> 分工審核 -> 修正 -> 再測試 -> 簽核」流程。

1. 由後台下載最新知識庫 JSON，或直接檢視 GitHub 的 `data/ecoco-knowledge-import.json`。
2. 將需要確認的項目分給對應負責人。
3. 負責人在本文件的清單中標示「通過 / 需修改 / 不適用」。
4. 若需修改，由客服或維護者在後台更新知識庫。
5. 大改或交接前，再次下載 JSON，放回 `data/ecoco-knowledge-import.json` 並 commit / push。
6. 重新部署後，用測試題確認 AI 回答是否符合內部規則。

## 2. 知識庫內容確認

正式版本來源：

- Git 正式檔案：`data/ecoco-knowledge-import.json`
- 線上實際資料：PostgreSQL `knowledge_sections`
- 後台入口：`/dashboard.html` 的「知識維護」

### 2.1 主管 / 客服窗口需確認

| 項目 | 確認重點 | 負責角色 | 狀態 | 備註 |
| --- | --- | --- | --- | --- |
| 點數效期 | 是否仍為獲點後 12 個月，且到期日算法正確 | 主管 / 客服窗口 | 待確認 | 需確認 App 規則是否一致 |
| 兌換規則 | 優惠券、點數折抵、不能兌換情境是否正確 | 主管 / 客服窗口 | 待確認 | 高頻問題需優先確認 |
| 回收品項 | 寶特瓶、鋁罐、PP 杯、電池等品項是否最新 | 營運 / 客服窗口 | 待確認 | 若站點機型不同需補充 |
| 機台異常 SOP | 滿倉、故障、退瓶、讀取異常時如何回覆 | 營運 / 客服窗口 | 待確認 | 需確認是否收集時間、地點、截圖 |
| 補點 / 退款 / 客訴 | AI 可以收集資訊，但不得承諾補點、退款或已處理 | 主管 | 待確認 | 高風險內容需主管確認 |
| 不能承諾內容 | 不承諾個案處理結果、不承諾人工已完成、不承諾補償 | 主管 | 待確認 | 需寫入 response policy |
| LINE 回覆語氣 | 是否使用「Hi 可可粉」、語氣是否符合 ECOCO 品牌 | 行銷 / 客服窗口 | 待確認 | LINE 可較親切，正式信件可較保守 |
| 站點名稱 | 是否去除未確認或需改名的站點字眼 | 營運 / 客服窗口 | 待確認 | 新站點名稱需等內部確認 |
| 合作商家名稱 | 合作商家、兌換品牌是否最新且可公開 | 商務 / 客服窗口 | 待確認 | 過期活動不可保留為現行規則 |

### 2.2 建議測試題

每次大改知識庫、prompt、模型或 LINE 串接前，至少測以下題目：

| 測試題 | 預期方向 |
| --- | --- |
| 點數多久到期？ | 回答點數效期與查詢方式 |
| 點數沒有入帳怎麼辦？ | 收集註冊電話、時間、地點，不承諾補點 |
| 機台滿倉了怎麼辦？ | 引導提供站點、時間、照片或截圖 |
| 優惠券不能兌換怎麼辦？ | 說明可能原因，引導確認 App 或客服表單 |
| 可以退款嗎？ | 保守回覆，不直接承諾退款 |
| 我想設點可以嗎？ | 收集地點與合作資訊，引導客服或合作窗口 |
| 投錯物品怎麼辦？ | 說明安全處理與通報方式 |
| 我手機是 09xx... | 回覆中不得外露完整個資，後台應遮罩 |

## 3. 公司資源更換確認

正式上線前，請將測試或個人資源換成公司資源。設定位置在 Render：

`Render Dashboard -> ecoco-customer-servic -> Environment -> Edit`

| 環境變數 | 用途 | 正式上線要求 | 修改者 |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude 回覆生成 | 改成公司 Claude API key | 技術窗口 |
| `OPENAI_API_KEY` | embedding / 語意 RAG | 改成公司 OpenAI API key；沒有則會降級關鍵字搜尋 | 技術窗口 |
| `DATABASE_URL` | PostgreSQL 線上資料庫 | 改成公司控管的 DB | 技術窗口 |
| `ADMIN_KEY` | 後台登入與 admin API | 改成公司管理密碼，不可放 Git | 技術窗口 |
| `LINE_CHANNEL_SECRET` | LINE Webhook 簽章驗證 | LINE Developers 提供 | LINE 管理者 / 技術窗口 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Reply API | LINE Developers 提供 | LINE 管理者 / 技術窗口 |
| `CONVERSATION_RETENTION_DAYS` | 對話保存天數 | 建議 `180`，由公司決定 | 主管 / 技術窗口 |
| `KNOWLEDGE_AUTO_SYNC` | 開機是否從 Git JSON 同步知識 | 建議正式維護用 `disable` | 技術窗口 |
| `REBUILD_KNOWLEDGE_CHUNKS_ON_START` | 是否強制重建 RAG chunks | 只在需要重建那次設 `always`，完成後移除 | 技術窗口 |

修改後請按 Save，並手動 redeploy。部署完成後檢查：

- `/healthz` 回傳 `ok`
- 後台可以登入
- 前台可以正常回覆
- Render logs 沒有 Claude / OpenAI / DB 連線錯誤

## 4. 監控、備份與保留政策

### 4.1 UptimeRobot 監控 `/healthz`

建議使用 UptimeRobot 或公司既有監控工具，每 5 分鐘檢查：

```text
https://ecoco-customer-servic.onrender.com/healthz
```

設定建議：

- Monitor Type：HTTP(s)
- Interval：5 minutes
- Alert Contact：負責維運的 email 或 LINE 通知
- 判定條件：非 2xx 或 timeout 就通知

### 4.2 Render logs 監控

Render logs 需觀察以下關鍵字：

- `Claude API error`
- `Embedding API failed`
- `PG pool error`
- `Knowledge chunks rebuild failed`
- `Conversation retention cleanup`
- `LINE webhook error`

若公司有集中式 log 工具，建議將 Render logs 串到公司工具。若暫時沒有，至少由技術窗口每週巡檢一次。

### 4.3 PostgreSQL 備份

目前 GitHub Actions 已提供「知識庫 JSON 備份 artifact」，但正式上線仍需確認 PostgreSQL 供應商是否有資料庫備份。

需要確認：

| 項目 | 建議 |
| --- | --- |
| 知識庫備份 | GitHub Actions 每週匯出 `/api/knowledge/export` |
| 對話與評分備份 | 依 PostgreSQL 供應商提供的自動備份為主 |
| 備份保存天數 | 至少 30 天，正式環境依公司政策 |
| 備份還原演練 | 上線前至少確認一次如何下載與還原 |

GitHub Actions 需要 secrets：

- `ECOCO_BASE_URL`
- `ADMIN_KEY`

### 4.4 n8n 每週 AI 健檢與寄信

若使用 n8n，請匯入 `n8n/workflows/` 的 workflow template，並設定：

- ECOCO 後端網址
- Admin Key
- Gmail / SMTP credential
- 收件人 email
- 每週執行時間

若使用 GitHub Actions 的 `ai-analysis.yml`，需在 GitHub Secrets 設定：

- `ECOCO_BASE_URL`
- `ADMIN_KEY`
- `ANTHROPIC_API_KEY`
- `MAIL_USER`
- `MAIL_PASS`
- `MAIL_TO`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`

### 4.5 對話資料保存天數

建議設定：

```text
CONVERSATION_RETENTION_DAYS=180
```

原因：

- 保留足夠資料做客服趨勢、知識缺口、週報/月報
- 避免長期保存過多可能含個資的對話
- 降低資料庫膨脹與個資風險

若公司法務或資訊安全要求更短，可改為 90 天。

## 5. 角色分工

| 角色 | 負責事項 | 每週例行工作 |
| --- | --- | --- |
| 客服人員 | 查看知識缺口、補充常見問題、回報 AI 答錯案例 | 檢查未處理知識缺口與負評 |
| 主管 | 審核高風險回答、規則、不能承諾內容 | 確認補點、退款、客訴類回答是否合規 |
| 技術窗口 | Render、API key、資料庫、部署、錯誤排查 | 檢查 healthz、logs、備份、GitHub Actions |
| 專案維護者 | 文件、PRD、流程圖、交接、版本整理 | 確認文件與 Git JSON 是否同步 |

## 6. 上線前簽核

| 確認項目 | 負責人 | 狀態 | 日期 | 備註 |
| --- | --- | --- | --- | --- |
| 知識庫內容已確認 | 主管 / 客服窗口 | 待確認 |  |  |
| 高風險回答已確認 | 主管 | 待確認 |  |  |
| 公司 API key 已替換 | 技術窗口 | 待確認 |  |  |
| LINE Developers 權限已取得 | LINE 管理者 | 待確認 |  |  |
| Webhook 測試成功 | 技術窗口 | 待確認 |  |  |
| UptimeRobot 或監控已設定 | 技術窗口 | 待確認 |  |  |
| PostgreSQL 備份策略已確認 | 技術窗口 | 待確認 |  |  |
| n8n / GitHub Actions 週報已測試 | 技術窗口 / 維護者 | 待確認 |  |  |
| 對話保存天數已設定 | 主管 / 技術窗口 | 待確認 |  |  |
| README / 交接文件已確認 | 專案維護者 | 待確認 |  |  |

## 7. 可以對主管說的版本

目前系統已經具備前台 AI 客服、後台知識維護、PostgreSQL 知識庫、RAG 檢索、LINE webhook 串接準備、n8n / GitHub Actions 週期性備份與 AI 健檢流程。正式落地前，建議用這份清單完成三件事：第一，請內部確認正式知識庫與高風險回答；第二，將 API key、資料庫、Render、LINE 權限改成公司資源；第三，補上監控、備份與資料保存天數。完成後可先以 LINE@ 小範圍試營運，再依知識缺口與負評持續優化。
