# ECOCO AI 客服使用、維護與交接總整理

這份文件是給不熟 SQL 或不熟部署流程的人看的。目標是回答五個問題：

1. 這個專案怎麼使用？
2. PostgreSQL 是什麼？資料到底在哪？
3. 如何維護知識庫？
4. 系統部署在哪裡？
5. 重要檔案各自有什麼用途？

## 一、這個專案現在是什麼

ECOCO AI 客服是一個 Node.js + Claude + PostgreSQL 的客服網站。

它有兩個主要畫面：

| 畫面 | 檔案 | 用途 |
| --- | --- | --- |
| 客服前台 | `public/index.html` | 給使用者提問，AI 回覆 |
| 後台儀表板 | `public/dashboard.html` | 給內部看對話、知識缺口、知識庫與營運報表 |

後端主程式是：

```text
server.js
```

它負責：

- 接收使用者問題。
- 從 PostgreSQL 找相關知識 chunks。
- 呼叫 Claude API 產生回答。
- 儲存對話紀錄、評分、知識缺口。
- 提供後台 API。

## 二、PostgreSQL 是什麼

PostgreSQL 是線上資料庫。你可以把它想成「AI 客服正在使用的線上 Excel」，但它不是用 Excel 開，而是用 SQL 或 DBeaver 查看。

目前 AI 客服使用 PostgreSQL 儲存：

| 資料表 | 用途 |
| --- | --- |
| `knowledge_sections` | AI 實際使用的知識分類 |
| `knowledge_chunks` | RAG 檢索用的知識片段，由系統自動產生 |
| `conversations` | 使用者與 AI 的對話紀錄 |
| `ratings` | 使用者對 AI 回覆的評分 |
| `unanswered_questions` | AI 無法完整回答的知識缺口 |

## 三、資料庫到底在哪裡

資料庫不是存在 GitHub，也不是存在你電腦裡的 `.json` 檔。

線上資料庫位置由 Render 的環境變數決定：

```text
DATABASE_URL
```

也就是說：

```text
Render Environment Variables
  ↓
DATABASE_URL
  ↓
PostgreSQL / Neon / Supabase 之類的線上資料庫
```

如果要用 DBeaver 看資料庫：

1. 打開 Render。
2. 到 ECOCO 客服服務的 Environment。
3. 找 `DATABASE_URL`。
4. 用 DBeaver 新增 PostgreSQL 連線。
5. 貼上 host、database、username、password。
6. SSL mode 設 `require`。
7. 連線後看 `public` schema 底下的表格。

常看的表格：

- `knowledge_sections`
- `knowledge_chunks`
- `unanswered_questions`
- `conversations`
- `ratings`

## 四、SQL 最基本概念

SQL 是跟資料庫溝通的語言。

常見指令：

```sql
-- 看所有知識分類
SELECT id, category, updated_at
FROM knowledge_sections
ORDER BY sort_order ASC, id ASC;

-- 看某個分類的完整內容
SELECT *
FROM knowledge_sections
WHERE category ILIKE '%優惠券%';

-- 看最近知識缺口
SELECT id, question, status, timestamp
FROM unanswered_questions
ORDER BY timestamp DESC
LIMIT 20;

-- 看最近對話
SELECT session_id, role, content, timestamp
FROM conversations
ORDER BY timestamp DESC
LIMIT 50;
```

注意：

- `SELECT` 是查資料，通常安全。
- `UPDATE` 會改資料。
- `DELETE` 會刪資料。
- 不熟時不要直接跑 `UPDATE` 或 `DELETE`。
- 後台能做的事，優先用後台做，不要直接改 SQL。

## 五、資料怎麼更新

目前有兩種更新方式。

### 方式 A：後台緊急修改

適合：

- 臨時補一則 FAQ。
- 修正一段錯字。
- 客服需要立刻讓 AI 用到新知識。

流程：

```text
登入後台 dashboard
  ↓
知識庫管理
  ↓
新增或修改分類
  ↓
儲存
  ↓
AI 立即使用 PostgreSQL 新內容
```

缺點：

- 後台修改只會存在 PostgreSQL。
- 不會自動回寫 Git JSON。
- 若未來用 Git JSON 覆蓋資料，可能遺失後台改動。

### 方式 B：Git JSON 正式更新

適合：

- 經主管確認的正式資料。
- 大量 FAQ 整理。
- 要留下版本紀錄。

流程：

```text
更新 data/ecoco-ai-customer-service-database.json
  ↓
npm run audit:knowledge
  ↓
npm run apply:knowledge-audit
  ↓
npm run build:knowledge
  ↓
檢查 data/ecoco-knowledge-import.json
  ↓
commit / push 到 GitHub
  ↓
Render 部署
  ↓
同步到 PostgreSQL
```

如果後台已經改過資料，要整理回 Git：

```text
後台知識庫管理
  ↓
匯出 JSON
  ↓
人工檢查
  ↓
整理回 data/ecoco-knowledge-import.json
  ↓
commit / push
```

## 六、部署在哪裡

目前線上部署在 Render。

部署流程：

```text
GitHub main
  ↓
Render 自動抓最新程式
  ↓
npm start
  ↓
server.js 啟動
  ↓
連線 PostgreSQL
  ↓
客服網站上線
```

重點：

- GitHub 是正式程式來源。
- Render 是網站部署平台。
- PostgreSQL 是線上資料庫。
- `.env` / Render Environment Variables 是機密設定。

GitLab 目前是公司備份或 MR 流程用，GitHub main 才是 Render 目前部署來源。

## 七、RAG 現在怎麼運作

RAG 是讓 AI 先查資料再回答。

目前流程：

```text
使用者提問
  ↓
server.js 建立搜尋詞
  ↓
搜尋 PostgreSQL knowledge_chunks
  ↓
取前 8 筆 chunks
  ↓
放進 Claude system prompt
  ↓
Claude 回答
```

目前已完成的短期優化：

- 後端回傳 `ragSources`。
- 前台顯示「引用知識」展開列。
- 新增同義詞群組，例如：
  - 兌換失敗、券不能用、優惠券無法使用。
  - 滿倉、滿袋、機台不能投。
  - 設點、新增站點、地點建議。
  - 合作商家、活動、點數未入帳。

這樣可以讓不同問法更容易命中正確知識片段。

## 八、重要檔案用途

| 檔案 / 資料夾 | 用途 |
| --- | --- |
| `server.js` | 後端主程式、Claude、PostgreSQL、RAG、API |
| `public/index.html` | 使用者客服前台 |
| `public/dashboard.html` | 內部後台 |
| `public/ecoco-logo.png` | ECOCO Logo |
| `public/ecoco-mark.png` | 客服頭像 icon |
| `data/ecoco-ai-customer-service-database.json` | 完整知識資料底稿 |
| `data/ecoco-knowledge-import.json` | 匯入 PostgreSQL 的知識分類 |
| `data/ecoco-response-policies.json` | 高風險回覆政策 |
| `data/knowledge-quality-audit.json` | 重複與衝突稽核結果 |
| `knowledge.js` | 空資料庫初始化 fallback |
| `scripts/build-ecoco-knowledge-data.js` | 產生匯入 JSON |
| `scripts/audit-knowledge-quality.js` | 檢查重複與衝突 |
| `scripts/apply-knowledge-audit.js` | 將重複資料標成 archived |
| `scripts/import-knowledge-json.js` | 手動匯入 PostgreSQL |
| `.env.example` | 環境變數範例，不含真 key |
| `.gitignore` | 防止 `.env` 等敏感資料被 commit |
| `docs/` | 交接、維護、部署、PRD、Flow 文件 |

## 九、每週維護建議

每週可以照這個順序：

1. 打開後台 dashboard。
2. 看營運報表週報。
3. 看知識缺口。
4. 看負評或低滿意度回答。
5. 判斷是否要補知識庫。
6. 有疑問先問內部窗口，不要讓 AI 自己猜。
7. 補完後測試同類問題。
8. 把正式修改整理回 Git JSON。
9. commit / push。

## 十、你可以怎麼跟主管說

> 目前 AI 客服已經不是單純把 FAQ 丟給 AI，而是用 PostgreSQL 管理知識庫，並透過 RAG 從 knowledge_chunks 找相關片段再交給 Claude 回答。後台可以看對話、評分、知識缺口，也能緊急補知識。正式資料仍建議整理回 Git JSON，讓資料有版本紀錄。部署目前由 GitHub main 觸發 Render，上線時透過 DATABASE_URL 連到 PostgreSQL。

