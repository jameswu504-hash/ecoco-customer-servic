---
name: ecoco-clean-brand-knowledge
description: 在本機清洗 ECOCO 品牌合作夥伴的 LINE TXT 匯出檔與 Markdown（MD）知識文件，產生經人工確認、依 company_id 隔離的 B2B 知識文件與 RAG Chunk。當使用者要求整理品牌對話、把 TXT／MD 變成 AI 友善資料、保留內部姓名／電話／Email，或要求不把原始內容傳給 Claude、OpenAI、Embedding API 等外部 AI 時使用。
---

# ECOCO 品牌知識資料清洗

## 不可違反的安全規則

- 只使用 Skill 內附的確定性本機腳本處理原始 `.txt` 與 `.md`。
- 不得開啟、引用、摘要、貼上或把原始內容放進模型 Context。
- 清洗期間不得把原始或清洗後的私人內容傳給 Claude、OpenAI、Embedding API、網頁搜尋或其他遠端服務。
- 保留內部姓名、電話與 Email，不做遮蔽或刪除。
- 原始檔必須留在原本的 Local 路徑；不得上傳、移動、覆寫或刪除。
- 每份知識文件與 Chunk 都必須綁定目前選擇的 `company_id`。
- 匯入 SQL 前必須先讓人員預覽並明確確認。
- 若資料包未聲明 `externalAiUsed=false` 與 `rawContentUploaded=false`，必須拒絕匯入。

## 執行流程

1. 確認目前選擇的合作公司，取得 `id`、`name`、`slug`。
2. 確認來源副檔名為 `.txt` 或 `.md`。
3. 執行 `scripts/clean-file.js`；模型不得自行讀取來源檔內容。
4. 只讀取腳本輸出的隱私安全摘要。
5. 告知使用者產生的 Markdown 預覽檔與 JSON 資料包路徑。
6. 請使用者檢查 Local Markdown，或在 B2B 管理後台查看預覽。
7. 只有取得明確同意後，才可透過受保護的管理 API 或後台匯入。
8. 回報 Section 數、Chunk 數、警告、來源 Hash 前綴與公司範圍，不得印出私人內容。

## 執行指令

```powershell
node scripts/clean-file.js `
  --input "C:\path\brand-chat.txt" `
  --company-id 1 `
  --company-name "全家便利商店（測試）" `
  --company-slug "familymart-test" `
  --out-dir "C:\path\cleaned-output"
```

腳本會產生：

- `<source>-ai-cleaned.md`：提供人員閱讀與確認。
- `<source>-ai-cleaned.json`：人工核准後用於 SQL 匯入，亦可作為備份與移轉資料包。

## 參考規則

- 修改文字正規化、LINE 解析、Chunk 切割或隱私行為前，必須閱讀 `references/cleaning-rules.md`。
- 修改 JSON 資料包或 SQL 匯入契約前，必須閱讀 `references/output-schema.md`。
