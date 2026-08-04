# 知識與資料來源

## 資料分層

| 類型 | 正式來源 | 使用範圍 |
|---|---|---|
| ECOCO 共用客服知識 | PostgreSQL `knowledge_sections`、`knowledge_chunks` | B2C 與所有 B2B 群組 |
| 合作公司私有知識 | PostgreSQL `partner_knowledge_sections`、`partner_knowledge_chunks` | 相同 `company_id` 的已綁定群組 |
| 站點與設備狀態 | Hive／Azure MySQL 同步到 `iot_station_statuses` | 官網與 LINE 站點查詢 |
| Git 知識 JSON | `data/ecoco-knowledge-import.json` | 備份、移轉、人工確認後匯入 |
| 原始公司文件 | 公司 Local 端 | 清洗來源，不直接供 Bot 回答 |

PostgreSQL 是線上回答的正式資料來源。Git JSON 不會因後台修改自動更新，也不應在每次部署時自動覆蓋 PostgreSQL。

## B2C 共用知識

共用知識保存設備操作、點數、App、回收品項、客服處理方式與官方名詞。新增或修改後會重建相應 chunks，供關鍵字或語意 RAG 使用。

站點清單與即時狀態不屬於靜態 B2C 知識；應由 Hive 同步，避免撤站、停用或維修資料過期。

正式更新方式：

1. 在後台新增、修改、封存或刪除知識。
2. 驗證前台回答與評測案例。
3. 大改版、移轉或備份時，從 PostgreSQL 匯出 JSON。
4. 人工檢查後才覆蓋 `data/ecoco-knowledge-import.json` 並提交版本。

## B2B 公司知識

每家公司以 `company_id` 隔離。公司知識可來自：

- `.txt` 或 `.md` 文件清洗與人工核准。
- 管理者直接新增的公司資料。
- LINE 群組對話整理出的候選知識，經人工審核後核准。

原始檔保留在 Local 端；規則式清洗不將原始內容送給外部 AI。正式回答時，只把該問題命中的必要公司 chunks 交給 Claude。

## RAG chunks

切片應以語意完整的主題、規則、決策或任務為單位，而不是只依固定字數截斷。每個 B2B chunk 至少應可追溯到公司、來源文件或對話、日期與審核結果。

封存或刪除 section 時，對應 chunks 必須同步停用或移除。否則畫面雖看不到資料，Bot 仍可能檢索到舊內容。

## 資料量與版本

文件不記錄站點數、知識筆數或 chunks 數等會持續變動的數字。需要盤點時應直接查詢後台或 PostgreSQL，並在當次稽核報告註明查詢時間。

欄位與資料表定義見 [資料字典](DATA_DICTIONARY.md)，站點同步見 [Hive／IoT 站點狀態同步](../operations/IOT_STATION_STATUS.md)。
