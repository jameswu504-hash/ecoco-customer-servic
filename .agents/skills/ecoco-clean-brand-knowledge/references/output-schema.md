# 清洗資料包格式

資料包格式為 `ecoco-partner-cleaning-package/v1`。

必要的最上層欄位：

- `company`：目前選擇的合作公司識別資料。
- `source`：檔名、`line_txt` 或 `markdown`、SHA-256 及字元數。
- `policy`：個資保留、外部 AI 使用狀態、原始內容上傳狀態及 Local-only 狀態。
- `skill`：Skill 名稱與版本。
- `report`：處理數量與不含私人內容的警告。
- `sections`：提供人員閱讀與確認的知識文件。
- `chunks`：依公司隔離、可重現的 RAG Chunk。
- `markdown`：Local 預覽成果；送往 SQL 匯入 API 時必須排除。

每個 Section 包含：

- `companyId`
- `title`
- `category`
- `content`
- `contentHash`
- `metadata`

每個 Chunk 包含：

- `companyId`
- `sectionIndex`
- `chunkIndex`
- `topic`
- `content`
- `searchText`
- `contentHash`
- `metadata`
- `sourceReferences`

SQL 匯入端點必須從 URL 取得公司，並把該 Company ID 套用到每筆新增資料。不得信任資料包內不同的 Company ID。
