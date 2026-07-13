# ECOCO AI 客服內部文件索引

本資料夾收錄 ECOCO AI 客服系統的正式說明文件。文件依使用者角色分組，方便客服、主管、維護者與工程協作者快速找到需要的資訊。

## 建議閱讀順序

| 角色 | 建議先讀 | 目的 |
| --- | --- | --- |
| 客服人員 | [客服人員操作指南](CUSTOMER_SUPPORT_GUIDE.md) | 了解日常後台操作與知識缺口處理 |
| 客服主管 / 營運主管 | [PRD](PRD_ECOCO_AI_CUSTOMER_SERVICE.md)、[客服 Flow 圖底稿](CUSTOMER_SERVICE_FLOW.md) | 了解系統目標、流程與管理方式 |
| 系統維護者 | [維運與交接手冊](OPERATIONS_HANDOFF_GUIDE.md)、[部署與環境手冊](DEPLOYMENT_RUNBOOK.md) | 了解部署、資料庫、知識更新與交接流程 |
| 工程協作者 | [資料字典](DATA_DICTIONARY.md)、[資料來源清單](DATA_SOURCES.md) | 了解資料表、JSON、來源與限制 |
| AI / LLM 評估者 | [Eval 與可觀測性](EVAL_OBSERVABILITY_GUIDE.md) | 了解回覆品質評測、RAG traces 與後續改善方向 |

## 核心交付文件

| 文件 | 說明 |
| --- | --- |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | 專案整體定位、主要功能與角色分工 |
| [CUSTOMER_SUPPORT_GUIDE.md](CUSTOMER_SUPPORT_GUIDE.md) | 客服與營運人員的後台操作 SOP |
| [PRD_ECOCO_AI_CUSTOMER_SERVICE.md](PRD_ECOCO_AI_CUSTOMER_SERVICE.md) | 產品需求文件，包含目標、範圍、功能、指標與風險 |
| [CUSTOMER_SERVICE_FLOW.md](CUSTOMER_SERVICE_FLOW.md) | 客服流程與 Whimsical Flowchart 繪製底稿 |
| [OPERATIONS_HANDOFF_GUIDE.md](OPERATIONS_HANDOFF_GUIDE.md) | 維運、權限、資料庫、部署與交接標準 |
| [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) | Render、PostgreSQL、Claude、OpenAI embedding 與健康檢查 |

## 資料與知識庫文件

| 文件 | 說明 |
| --- | --- |
| [DATA_SOURCES.md](DATA_SOURCES.md) | 知識來源、使用限制、資料量摘要與更新原則 |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | PostgreSQL 資料表、JSON 檔案與環境變數說明 |
| [knowledge-import.md](knowledge-import.md) | 知識 JSON 的產生、匯入、匯出與同步方式 |
| [KNOWLEDGE_QUALITY_AUDIT.md](KNOWLEDGE_QUALITY_AUDIT.md) | 重複知識、衝突與資料品質稽核摘要 |
| [META_AI_INSTRUCTIONS.md](META_AI_INSTRUCTIONS.md) | Meta AI 指令來源與轉換為客服規則的方式 |

## 安全與治理文件

| 文件 | 說明 |
| --- | --- |
| [security-keys.md](security-keys.md) | API key、token、`.env` 與 Render 環境變數的安全原則 |
| [PII_HISTORY_CLEANUP_PLAN.md](archive/PII_HISTORY_CLEANUP_PLAN.md) | 個資外洩止血與 Git 歷史清除方案 |
| [REPO_FILE_AUDIT.md](REPO_FILE_AUDIT.md) | Git repository 檔案用途與不必要檔案稽核 |
| [commandcenter-migration.md](archive/commandcenter-migration.md) | 舊 CommandCenter 專案可沿用與不建議沿用內容 |

## 未啟用的未來模組

| 文件 | 說明 |
| --- | --- |
| [future/internal-wiki/README.md](future/internal-wiki/README.md) | 內部 Wiki / 員工訓練知識系統規劃，目前 production 不啟用 |
| [future/internal-wiki/INTERNAL_WIKI_GUIDE.md](future/internal-wiki/INTERNAL_WIKI_GUIDE.md) | 內部 Wiki 的部署、API 與資料表設計 |
| [future/internal-wiki/LLM_WIKI_RULE_MODEL_STRATEGY.md](future/internal-wiki/LLM_WIKI_RULE_MODEL_STRATEGY.md) | LLM Wiki、Rule 與本地模型策略討論 |

## 重要維護原則

- PostgreSQL 是線上執行資料庫，AI 目前實際讀取 `knowledge_sections` 與 `knowledge_chunks`。
- Git 裡的 `data/ecoco-knowledge-import.json` 是正式版本備份，不會因為後台修改而自動更新。
- 大量更新、交接或正式版本備份前，請從後台下載 JSON，人工確認後放回 Git。
- API key、token、資料庫連線字串與 `.env` 不得提交。
- 真實手機、Email、會員資料或可識別個資不得提交。
- 高風險客服問題不得由 AI 承諾補點、退款、賠償或已完成處理。

## 文件維護規範

文件應保持「可交接、可查證、可執行」。

新增或修改文件時，請避免：

- 只寫個人學習心得，卻沒有操作步驟。
- 使用未確認的內部結論。
- 將測試帳號、API key、真實個資寫入文件。
- 讓同一件事散落在多份文件且內容互相矛盾。

若文件與實際系統不一致，應優先修正正式文件，再同步通知維護者檢查程式或資料庫設定。
## 正式上線確認

正式接入 LINE@ 或擴大試營運前，請先使用 [LAUNCH_CONFIRMATION_CHECKLIST.md](archive/LAUNCH_CONFIRMATION_CHECKLIST.md) 完成內部確認。這份清單包含：

- 知識庫內容與高風險回答確認
- 公司 API key、Render、PostgreSQL、LINE 權限替換
- UptimeRobot `/healthz` 監控
- PostgreSQL / GitHub Actions 備份確認
- n8n 每週 AI 健檢與寄信確認
- 客服、主管、技術窗口、專案維護者的角色分工

Render 環境變數可參考 [config/render-production.env.example](../config/render-production.env.example)。
