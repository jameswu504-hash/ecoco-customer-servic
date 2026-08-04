# Hive／IoT 站點狀態同步

原本的 `IOT_STATION_STATUS_HANDOFF_2026-07-24.md` 是特定日期的交接快照，記錄站點同步、客服查詢與排程方式。有效內容已整合到本文件，舊 handoff 已刪除，後續只維護這一份。

## 目前架構

```text
ECOCO Hive／Azure MySQL
        │ 唯讀查詢
        ▼
公司內網或 VPN 內的同步程式
        │ POST 同步 API
        ▼
ECOCO 客服 PostgreSQL：iot_station_statuses
        │
        ├─ 官網 B2C 客服
        └─ LINE 客服
```

Hive／Azure MySQL 是站點與機台狀態來源。客服不會在每次使用者提問時直接連 Hive，而是只讀取同步到 PostgreSQL 的鏡像，避免內網連線、回應時間與權限影響線上客服。鏡像查詢失敗時會回報站點資料暫時不可用，不會改查 MySQL 或舊 snapshot；客服 Runtime 已移除 snapshot fallback 設定與查詢入口。

## 同步方式

建議在可連公司資料庫的長期運行主機上執行：

```bash
npm run iot:sync
```

同步程式：

1. 以唯讀帳號查詢 Hive／Azure MySQL。
2. 正規化站點名稱、地址、座標、設備狀態、槽位與同步時間。
3. 分批上傳到客服系統的 IoT sync API。
4. PostgreSQL 以站點識別碼 upsert `iot_station_statuses`。
5. 最後一批帶入完整快照清理旗標，移除來源同步時間之前、這次未再出現的舊站點。

建議每五分鐘執行一次。實際頻率依 Hive 負載與客服即時性需求調整。

## 必要設定

同步主機需要 Hive 連線設定、客服系統同步網址及 `IOT_SYNC_KEY`。Render 與同步主機的 `IOT_SYNC_KEY` 必須一致；錯誤時 API 會回傳 401。

正式環境應使用獨立的 `IOT_SYNC_KEY`。目前程式在未設定時仍可暫時 fallback 到 `ADMIN_KEY`，這是相容措施，不是建議配置。

## 狀態與新鮮度

- 客服顯示的是 Hive 實際提供並經正規化的狀態，不應在文件硬寫 `active`、`0` 等來源代碼的推測。
- 若來源刪除撤站資料，使用完整 API 上傳流程時，最後一批會清除 PostgreSQL 對應舊資料。
- 直接寫 PostgreSQL 的模式目前以 upsert 為主，不應視為完整快照替換；需要正確移除撤站資料時，使用 API 上傳模式。
- 站點資料超過新鮮度門檻時，客服應標示可能過期。預設門檻由環境設定控制，不在文件固定站點數或資料時間。

## 驗證

同步後檢查：

1. 指令是否正常完成且無 401、連線或欄位錯誤。
2. `iot_station_statuses` 的 `source_synced_at` 是否更新。
3. 官網詢問已知站點、附近站點與設備狀態是否有結果。
4. LINE 一對一詢問相同問題是否一致。
5. Hive 已撤除的測試站點是否不再出現。

正式官網與 LINE 的請求時間路徑只允許讀取 `iot_station_statuses`。`ECOCO_IOT_MYSQL_*` 只供同步與診斷；`npm run iot:snapshot` 及 `IOT_STATION_SNAPSHOT_OUTPUT` 只用於離線匯出，不是客服回答的備援來源，也沒有可重新開啟 Runtime fallback 的環境變數。

## 排錯順序

1. 確認同步主機能連 Hive／Azure MySQL。
2. 確認唯讀帳號、來源 SQL 與欄位映射。
3. 確認客服同步 URL 與 `IOT_SYNC_KEY`。
4. 查看同步指令輸出及 Render log。
5. 檢查 PostgreSQL 的最新同步時間，再測試客服回答。

不要把站點清單重新加入靜態 B2C 知識庫；站點異動頻繁，正式來源應維持 Hive 同步。
