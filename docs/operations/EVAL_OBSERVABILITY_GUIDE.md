# 評測與可觀測性

本文件說明如何在部署前檢查回答品質，以及上線後如何追查 RAG、模型與知識來源。

## 評測資料

`evals/golden-set.json` 是固定回歸題庫，包含一般客服、站點、拒答、B2B 隔離與安全案例。

JSON 的欄位名稱與列舉值（例如 `id`、`question`、`expected`、`tags`）保留英文，因為它們是程式介面；題目、說明及預期內容可使用中文。

新增案例時應：

1. 去除真實個資與密鑰。
2. 說明預期包含與不得包含的內容。
3. 標示 B2C、B2B、站點、安全或知識缺口等類型。
4. 由 ECOCO 人員人工確認後，才能當成正式上線門檻。

## 本機檢查

```bash
npm run eval:validate
npm test
npm run lint
npm run check:syntax
npm run scan:pii
```

`eval:validate` 檢查評測集格式，不會呼叫外部模型。`lint` 使用 ESLint，`check:syntax` 保留純語法檢查。單元與 HTTP 整合測試確認路由、權限、RAG、LINE、營運報表、Internal Wiki 及資料處理沒有回歸；個資掃描則避免真實聯絡資料或識別碼進入 Git。

## 實際回答評測

需要 `DATABASE_URL`、Claude 等正式依賴時，才執行 live eval。結果應同時檢查：

- 回答是否符合預期重點。
- 是否引用正確的 B2C 或公司資料。
- 是否洩漏其他公司的知識。
- 站點回答是否來自同步資料，而不是過期靜態知識。
- 不確定時是否明確表達，而非自行補完。

若使用外部模型擔任 judge，只能送去識別化的題目與回答，不可將完整資料庫或未允許的原始文件送出。

## 可觀測資料

| 資料 | 用途 |
|---|---|
| `chat_traces` | 查詢檢索方式、命中 chunks、模型與耗時 |
| `conversations` | B2C 問答紀錄 |
| `partner_conversations` | 依公司隔離的 B2B 群組問答 |
| `line_webhook_events` | LINE 收件、處理、回覆或失敗狀態 |
| `ratings` | 使用者評分 |
| `unanswered_questions` | 知識不足或未能回答的問題 |
| `admin_audit_logs` | 管理操作追蹤 |

排錯時先確認請求有沒有進入系統，再依序檢查分流、檢索結果、模型呼叫與 LINE 回覆狀態，不要只看最終畫面。

## 知識漂移

資料更新後至少抽查：

- 舊答案是否仍被過期 chunks 命中。
- 已撤站或停用資料是否已從站點鏡像移除。
- 封存或刪除的公司知識是否不再被檢索。
- 官方名詞是否一致。

若品質門檻失敗，部署應停止或回復到上一個已驗證版本；不得以「模型偶爾不穩」忽略固定回歸。
