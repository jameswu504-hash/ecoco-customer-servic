# ECOCO AI 客服內部文件入口

這個資料夾放的是給 ECOCO 內部維護 AI 客服用的文件。

建議閱讀順序：

1. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)：先看整個系統是什麼、誰會用、資料怎麼流。
2. [CUSTOMER_SUPPORT_GUIDE.md](CUSTOMER_SUPPORT_GUIDE.md)：一般客服人員版本，只講後台怎麼看、知識缺口怎麼處理、什麼不能讓 AI 承諾。
3. [DATA_SOURCES.md](DATA_SOURCES.md)：確認 AI 目前吃了哪些資料、哪些不能直接用。
4. [DATA_DICTIONARY.md](DATA_DICTIONARY.md)：看懂 PostgreSQL 資料表與 JSON 檔案的用途。
5. [MAINTENANCE_GUIDE.md](MAINTENANCE_GUIDE.md)：日常怎麼維護知識庫、知識缺口與回覆品質。
6. [OPERATIONS_HANDOFF_GUIDE.md](OPERATIONS_HANDOFF_GUIDE.md)：系統維運、部署、資料流與交接手冊。
7. [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md)：Render、環境變數、部署與更新流程。
8. [META_AI_INSTRUCTIONS.md](META_AI_INSTRUCTIONS.md)：Meta AI 指令來源整理與維護方式。
9. [CUSTOMER_SERVICE_FLOW.md](CUSTOMER_SERVICE_FLOW.md)：客服 Flow 圖規劃。
10. [PRD_ECOCO_AI_CUSTOMER_SERVICE.md](PRD_ECOCO_AI_CUSTOMER_SERVICE.md)：ECOCO AI 客服系統 PRD。
11. [KNOWLEDGE_QUALITY_AUDIT.md](KNOWLEDGE_QUALITY_AUDIT.md)：重複問題與待確認衝突稽核清單。
12. [REPO_FILE_AUDIT.md](REPO_FILE_AUDIT.md)：repo 檔案用途與已移除孤兒檔案。
13. [knowledge-import.md](knowledge-import.md)：技術細節，說明如何產生與匯入知識庫 JSON。
14. [security-keys.md](security-keys.md)：API key、token、`.env` 與 Render 環境變數的安全原則。
15. [LLM_WIKI_RULE_MODEL_STRATEGY.md](LLM_WIKI_RULE_MODEL_STRATEGY.md)：LLM Wiki、Rule、本地模型與正式客服模型的應用策略。

重要原則：

- `.env` 和 Render Environment Variables 只放機密設定，不放進 GitHub。
- 日常知識維護以 PostgreSQL 的 `knowledge_sections` 為準，AI 實際回答時會讀取這裡。
- 大改版、交接或正式備份前，從後台下載 JSON，人工確認後回寫到 `data/ecoco-knowledge-import.json`。
- AI 無法確定的問題會進入 `unanswered_questions`，後續要由內部確認後補回知識庫。
- 舊系統資料只能當參考，不能整包匯入。
