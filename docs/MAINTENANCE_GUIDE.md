# ECOCO AI 客服內部維護手冊

## 每週維護流程

建議每週固定做一次：

1. 打開後台 dashboard。
2. 查看 `知識缺口列表`。
3. 查看最近低評分或負評回覆。
4. 把需要補資料的問題整理出來。
5. 請內部窗口確認正確答案。
6. 更新知識庫資料。
7. 重新部署或讓系統自動同步。
8. 用測試問題確認 AI 回覆是否正確。
9. 記錄本週更新內容。

## 知識缺口怎麼處理

知識缺口是 AI 認為「目前資料不足，不能確定回答」的問題。

處理方式：

| 狀態 | 判斷 | 後續動作 |
| --- | --- | --- |
| 待確認 | AI 答不完整，內部還沒確認答案 | 問主管或負責窗口 |
| 已補資料 | 已確認並補進知識庫 | 下次測試同類問題 |
| 不需處理 | 問題太特殊、非 ECOCO 業務、或不應回答 | 不補進知識庫 |
| 需人工處理 | 涉及個資、帳號、補點、退款、爭議 | 引導客服表單或 App 聯絡 |

## 更新知識庫的安全流程

一般建議走 Git 版本管理：

1. 修改 `data/ecoco-ai-customer-service-database.json`。
2. 執行 `npm run audit:knowledge` 檢查仍會進 AI 的重複資料。
3. 執行 `npm run apply:knowledge-audit`，把建議剔除的重複資料標成 `status: archived`。
4. 執行 `npm run build:knowledge`。
5. 檢查 `data/ecoco-knowledge-import.json` 是否合理。
6. Commit 並 push 到 GitHub。
7. Render 自動部署。
8. 系統啟動後自動同步到 PostgreSQL。

如果只是臨時小修，也可以在後台修改 `knowledge_sections`，但長期仍建議回寫到 JSON，避免下次部署後被 Git 版本覆蓋。

## 後台資料回寫 Git 的方式

後台編輯會先存在 PostgreSQL，AI 會立即使用，但 Git JSON 不會自動更新。若要把後台資料整理回正式版本，可以在後台「知識庫管理」點選「匯出 JSON」，或使用 Admin API 匯出：

```text
GET /api/knowledge/export
```

這個 API 需要帶 `x-admin-key`，會把 PostgreSQL `knowledge_sections` 匯出成接近 `data/ecoco-knowledge-import.json` 的格式。匯出後請人工檢查，再回寫到：

- `data/ecoco-knowledge-import.json`
- 或完整底稿 `data/ecoco-ai-customer-service-database.json`

建議流程：

1. 後台緊急新增或修改知識。
2. 在後台點「匯出 JSON」，或用 `/api/knowledge/export` 匯出 PostgreSQL 目前版本。
3. 人工比對 Git JSON。
4. 將確認後的內容整理回 Git。
5. Commit、push、部署。
6. 下次同步時 Git 與 PostgreSQL 內容就能保持一致。

## AI 回覆品質檢查

每次資料更新後，建議測試以下問題：

- 點數多久到期？
- 點數沒有入帳怎麼辦？
- 可以用悠遊卡集點嗎？
- 寶特瓶要不要壓扁？
- 電池機可以投哪些電池？
- 機台紅燈代表什麼？
- 優惠券不能兌換怎麼辦？
- 站點名稱或合作方相關問題。
- 客戶要求補點、賠償、退款時 AI 怎麼回。

檢查重點：

- 有沒有講錯規則。
- 有沒有使用舊名稱。
- 有沒有承諾補點、退款或賠償。
- 有沒有因為一般關鍵字，例如點數、機台、異常，就變得過度保守。
- 有沒有要求使用者提供必要資訊。
- 語氣是否符合 ECOCO 品牌。

## 回覆語氣標準

AI 回覆應該：

- 使用繁體中文。
- 語氣親切、溫暖、負責任。
- 回覆清楚，不要太長。
- 適度使用 emoji，但不要過多。
- 遇到抱怨先同理，再給具體處理方式。
- 高風險問題要保守，不承諾人工結果。

AI 回覆不應該：

- 自稱已經幫客戶補點。
- 自稱已經退款或賠償。
- 隨意保證工程師會處理。
- 使用未確認的新站點名稱。
- 揭露內部作業細節。
- 回答沒有來源的政策或規則。

## 舊資料使用原則

舊版 CommandCenter、舊 `knowledge.js`、舊 SQLite 對話資料只能當參考。

可以使用：

- 品牌語氣概念。
- SOP 架構。
- 客服會遇到的問題類型。
- 可以重新確認的知識主題。

不能直接使用：

- API key、token、信箱設定。
- 舊 AI 草稿。
- 未確認的舊站點名稱。
- 舊合作方字眼。
- 個資或歷史客訴內容。
