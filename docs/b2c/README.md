# B2C AI 客服

## 定位

B2C 是本專案的核心客服，服務一般 ECOCO 使用者。它不需要 LINE 群組綁定，也不會讀取全家或其他合作公司的私有資料。

## 使用渠道

- 官網聊天：`/`，呼叫 `POST /api/chat`。
- LINE 一對一聊天：LINE webhook 收到 `source.type = user` 後進入同一套 B2C 回答流程。
- 後台：`/admin.html` 維護共用知識、未解問題、評分與對話紀錄。

## 回答流程

1. 驗證輸入、套用速率限制並建立對話上下文。
2. 若是站點位置、狀態、容量或附近站點問題，查詢 `iot_station_statuses`。
3. 其他問題從 ECOCO 共用知識做關鍵字或語意檢索。
4. 只把相關知識片段交給 Claude 產生回答。
5. 保存問答、trace、評分與知識缺口，供後台追蹤。

## 資料來源

| 資料 | 正式來源 |
|---|---|
| 客服規則、點數、設備操作、回收品項 | PostgreSQL 共用知識庫 |
| 站點、設備連線、容量及同步時間 | Hive／Azure MySQL 同步到 PostgreSQL 的 `iot_station_statuses` |
| Git 知識 JSON | 備份、移轉與明確匯入使用，不會自動覆蓋正式資料庫 |

站點資料不再放在 B2C 靜態 RAG 知識中。客服查詢讀取 PostgreSQL 鏡像；同步程式定期從 Hive 取得最新資料，而不是每個使用者問題都直接連 Hive。

## 回答邊界

- 可回答 ECOCO 一般客服與即時站點資訊。
- 不可取得任何 `partner_*` 公司私有資料。
- 不確定或缺少依據時應明確說明，並留下知識缺口供人工處理。
- 官方名詞以「ECOCO 智慧收瓶機」等現行名詞規則為準，避免舊資料造成名稱漂移。

客服操作方式見 [客服操作指南](CUSTOMER_SUPPORT_GUIDE.md)，資料治理見 [知識與資料來源](../reference/KNOWLEDGE_DATA.md)。
