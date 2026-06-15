# ECOCO 客服專案檔案稽核

本文件用來說明目前 GitHub / GitLab repo 內哪些檔案是線上系統會使用的，哪些檔案已判定為舊工具或孤兒檔案並移除。

## 一、線上系統會使用的核心檔案

| 檔案 / 資料夾 | 用途 | 保留原因 |
| --- | --- | --- |
| `server.js` | Express 後端、Claude API、PostgreSQL、RAG、後台 API | 線上主程式 |
| `public/index.html` | 使用者客服前台 | 使用者實際使用介面 |
| `public/dashboard.html` | 內部客服後台 | 管理知識庫、知識缺口、對話紀錄 |
| `public/ecoco-logo.png` | ECOCO 官方 Logo | 品牌顯示 |
| `public/ecoco-mark.png` | ECOCO 頭像 / icon | 客服頭像與視覺識別 |
| `package.json` | Node 專案設定與 scripts | Render 啟動與維護指令需要 |
| `package-lock.json` | 套件版本鎖定 | 保持部署版本一致 |
| `.env.example` | 環境變數範例 | 交接與部署說明 |
| `.gitignore` | 避免提交 `.env` 等敏感檔 | 資安必要 |

## 二、資料與知識庫檔案

| 檔案 | 用途 | 保留原因 |
| --- | --- | --- |
| `knowledge.js` | PostgreSQL 空資料庫時的初始 seed | `server.js` 首次部署仍會讀取 |
| `data/ecoco-ai-customer-service-database.json` | 完整 AI 客服資料底稿 | 正式資料整理與來源追蹤 |
| `data/ecoco-knowledge-import.json` | 匯入 PostgreSQL `knowledge_sections` 的精簡知識庫 | Render 啟動同步使用 |
| `data/ecoco-response-policies.json` | 高風險回覆政策 | 已接入 `server.js` system prompt |
| `data/knowledge-quality-audit.json` | 去重與衝突稽核結果 | 人工整理資料品質使用 |

## 三、維護腳本

| 檔案 | 用途 | 保留原因 |
| --- | --- | --- |
| `scripts/build-ecoco-knowledge-data.js` | 從完整資料底稿產生匯入 JSON 與回覆政策 | 正式知識庫更新流程需要 |
| `scripts/import-knowledge-json.js` | 手動匯入 JSON 到 PostgreSQL | 本地或緊急匯入用 |
| `scripts/audit-knowledge-quality.js` | 產生重複問題與衝突稽核報告 | 資料清理使用 |

## 四、已移除的孤兒檔案

以下檔案未被目前 `server.js`、`package.json` scripts 或 Render 部署流程使用，且屬於舊站點匯入 / 舊資料遷移工具，因此已移除：

| 已刪檔案 | 移除原因 |
| --- | --- |
| `import-stations.js` | 舊 CSV/XLSX 站點匯入工具，目前客服主流程未使用 |
| `parse-kml.js` | 舊 KML 站點解析工具，目前客服主流程未使用 |
| `ecoco-stations.kml` | 舊站點原始 KML，未被線上系統讀取 |
| `stations-template.csv` | 舊站點匯入範本，未被線上系統讀取 |
| `migrate.js` | 舊 SQLite 遷移工具；目前 `server.js` 的 `initDb()` 會自行建立 PostgreSQL schema |

## 五、沒有移除但需注意的檔案

| 檔案 | 注意事項 |
| --- | --- |
| `knowledge.js` | 雖然不是主要知識來源，但仍是空資料庫初始化 fallback，所以暫時保留 |
| `開啟伺服器.bat` | 本地 Windows 開發輔助，不影響 Render；可視團隊習慣決定是否保留 |

## 六、結論

目前 repo 已往「線上客服系統 + 知識庫維護」方向收斂。舊站點匯入與 SQLite 遷移檔已移除，避免主管或維護者誤以為這些腳本仍是正式流程的一部分。

