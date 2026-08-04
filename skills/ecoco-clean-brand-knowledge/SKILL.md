---
name: ecoco-clean-brand-knowledge
description: 將 ECOCO 品牌方的 LINE TXT、Markdown 文件或已綁定 LINE 群組對話，整理成可追溯、可審核且依公司隔離的 AI 友善知識。Use when 清洗品牌資料、整理 LINE 對話、建立待審知識、切分 B2B RAG，或匯入公司專屬知識庫。
---

# ECOCO 品牌資料清洗

版本：1.3.0

## 必守原則

1. 原始 TXT／MD 只在公司 Local 端或使用者瀏覽器處理。
2. 自動保存的 LINE 對話只在 ECOCO 應用程式與 SQL 內用固定規則整理。
3. 不把姓名、電話、Email 或原始 LINE 對話傳給 Claude、OpenAI、Embedding API 或其他外部服務。
4. 保留原始資料；正式知識使用另外產生的摘要、索引與 Chunk。
5. 每筆結果必須帶 `company_id`，不得跨公司合併或檢索。
6. LINE 自動整理結果一律先標為 `pending_review`，人工核准前不得進入 RAG。
7. 報價、合約、期限、活動、站點狀態、設備狀態、清運及派工都要標記時效風險。

## TXT／Markdown 工作流程

1. 驗證來源只能是 `.txt` 或 `.md`。
2. 正規化換行、空白與標題，不改寫姓名、電話或 Email。
3. LINE TXT 依日期切段；Markdown 依一至三級標題切段。
4. 移除空白、重複問候及照片、貼圖、檔案等無文字附件占位。
5. 每段加入公司、來源、資料性質與使用範圍。
6. 依主題與長度產生 Section 與 Chunk。
7. 產生 SHA-256，供來源及內容去重。
8. 預覽後由管理者確認，才寫入公司專屬 SQL 與 RAG。

## 已綁定 LINE 對話工作流程

1. 依 `company_id + line_group_id + 台灣日期` 建立每日批次。
2. 只讀取未封存訊息；略過問候、附件占位與系統錯誤。
3. 將連續的人員訊息與下一則有效 AI 回覆組成一份候選。
4. 不論是否已有 Bot 回覆，候選在人工核准前都必須標示「尚待確認」，Bot 回覆不得自動列為已確認事實。
5. 保存來源訊息 ID、群組、日期、Skill 版本、待辦與風險標記。
6. 以內容雜湊去重；同一批資料重跑不得重複建立候選。
7. 管理者可修改標題、分類及內容，再核准、退回或封存。
8. 只有 `approved` 候選可以建立公司知識 Section 與 RAG Chunk。
9. 已核准候選不可原地修改；需建立 `pending_review` 修訂版本，重新核准後才封存並取代舊 Section。

## 輸出與狀態

- 檔案清洗：輸出 Section、Chunk、來源 Metadata、清洗報告與可下載備份包。
- LINE 整理：輸出批次及待審候選。
- 狀態只使用 `pending_review`、`approved`、`rejected`、`archived`。
- 詳細欄位見 [references/OUTPUT_SCHEMA.md](references/OUTPUT_SCHEMA.md)。

## 迭代規則

- 修改切割、分類、去重或風險判斷時必須提升版本。
- 舊資料保留原本 `skill_version`，不得假裝由新版規則產生。
- 新版上線前需以固定測試資料驗證公司隔離、去重及核准前不可檢索。
