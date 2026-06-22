# ECOCO AI 客服內部文件入口

這個資料夾放的是給 ECOCO 內部維護 AI 客服用的文件。

建議閱讀順序：

1. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)：先看整個系統是什麼、誰會用、資料怎麼流。
2. [CUSTOMER_SUPPORT_GUIDE.md](CUSTOMER_SUPPORT_GUIDE.md)：一般客服人員版本，只講後台怎麼看、知識缺口怎麼處理、什麼不能讓 AI 承諾。
3. [DATA_SOURCES.md](DATA_SOURCES.md)：確認 AI 目前吃了哪些資料、哪些不能直接用。
4. [DATA_DICTIONARY.md](DATA_DICTIONARY.md)：看懂 PostgreSQL 資料表與 JSON 檔案的用途。
5. [MAINTENANCE_GUIDE.md](MAINTENANCE_GUIDE.md)：日常怎麼維護知識庫、知識缺口與回覆品質。
6. [OPERATIONS_HANDOFF_GUIDE.md](OPERATIONS_HANDOFF_GUIDE.md)：給不熟 SQL 的人看的使用、維護、部署與檔案用途總整理。
7. [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md)：Render、環境變數、部署與更新流程。
8. [META_AI_INSTRUCTIONS.md](META_AI_INSTRUCTIONS.md)：Meta AI 指令來源整理與維護方式。
9. [RAG_WORKFLOW.md](RAG_WORKFLOW.md)：RAG 第一版如何用 PostgreSQL chunks 檢索知識。
10. [CUSTOMER_SERVICE_FLOW.md](CUSTOMER_SERVICE_FLOW.md)：客服 Flow 圖規劃。
11. [PRD_ECOCO_AI_CUSTOMER_SERVICE.md](PRD_ECOCO_AI_CUSTOMER_SERVICE.md)：ECOCO AI 客服系統 PRD。
12. [KNOWLEDGE_QUALITY_AUDIT.md](KNOWLEDGE_QUALITY_AUDIT.md)：重複問題與待確認衝突稽核清單。
13. [REPO_FILE_AUDIT.md](REPO_FILE_AUDIT.md)：repo 檔案用途與已移除孤兒檔案。
14. [knowledge-import.md](knowledge-import.md)：技術細節，說明如何產生與匯入知識庫 JSON。
15. [security-keys.md](security-keys.md)：API key、token、`.env` 與 Render 環境變數的安全原則。

重要原則：

- `.env` 和 Render Environment Variables 只放機密設定，不放進 GitHub。
- 正式知識資料以 `data/ecoco-ai-customer-service-database.json` 為底稿。
- PostgreSQL 的 `knowledge_sections` 是 AI 實際回答時讀取的知識庫。
- AI 無法確定的問題會進入 `unanswered_questions`，後續要由內部確認後補回知識庫。
- 舊系統資料只能當參考，不能整包匯入。
