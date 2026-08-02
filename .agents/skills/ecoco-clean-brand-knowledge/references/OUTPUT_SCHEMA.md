# ECOCO 品牌資料清洗輸出欄位

## LINE 每日批次

- `company_id`：合作公司 ID。
- `line_group_id`：已綁定 LINE 群組 ID。
- `conversation_day`：台灣日期。
- `skill_name`／`skill_version`：清洗規則與版本。
- `source_message_count`：來源訊息數。
- `content_hash`：來源集合 SHA-256。
- `report`：候選數、略過問候數、略過系統錯誤數，以及是否使用外部 AI。

## 待審知識候選

- `title`：可編輯標題。
- `category`：主題分類。
- `content`：核准後可直接成為公司知識的 Markdown。
- `summary`：簡短預覽。
- `facts`：LINE 回覆中的候選內容，核准前仍未確認。
- `pending_items`：尚無回覆或需人工確認事項。
- `todos`：包含請求、追蹤、派工或清運語意的內容。
- `source_message_ids`：可追溯的原始訊息 ID。
- `risk_flags`：`commercial_terms`、`time_sensitive`、`operational_status`。
- `content_hash`：公司範圍內的去重 SHA-256。
- `status`：`pending_review`、`approved`、`rejected`、`archived`。
- `approved_section_id`：核准後建立的公司知識 ID。

## 核准規則

核准時建立 `partner_knowledge_sections` 及 `partner_knowledge_chunks`。Chunk 必須保存候選 ID、批次 ID、日期、群組與來源訊息 ID，且所有 SQL 都必須包含相同 `company_id`。
