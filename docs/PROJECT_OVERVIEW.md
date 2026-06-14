# ECOCO AI 客服專案總覽

## 專案定位

ECOCO AI 客服是給 ECOCO 使用的官方 AI 客服系統。它使用 Claude 產生全自動回覆，並用 PostgreSQL 儲存知識庫、對話紀錄、滿意度評分與知識缺口。

這個專案不是舊版 CommandCenter，也不是單純 FAQ 頁面。新版專案的重點是：

- 讓使用者可以即時詢問 ECOCO 相關問題。
- 讓 AI 根據 ECOCO 內部整理過的知識庫回答。
- 讓內部人員可以查看對話紀錄與知識缺口。
- 讓知識資料可以持續更新，而不是散落在不同檔案。

## 目前主要功能

| 功能 | 說明 |
| --- | --- |
| 客戶前台 | `public/index.html`，提供使用者提問與 AI 回覆 |
| 後台 dashboard | `public/dashboard.html`，查看統計、對話、評分、知識缺口與知識庫 |
| AI 回覆 | `server.js` 呼叫 Claude，並把 PostgreSQL 知識庫放進 system prompt |
| 對話紀錄 | 儲存在 PostgreSQL `conversations` |
| 滿意度評分 | 儲存在 PostgreSQL `ratings` |
| 知識缺口 | 儲存在 PostgreSQL `unanswered_questions` |
| 知識庫 | 儲存在 PostgreSQL `knowledge_sections` |
| 知識匯入 | 從 `data/ecoco-knowledge-import.json` 同步到 PostgreSQL |

## 系統流程

```text
使用者提問
  ↓
前台送到 /api/chat
  ↓
server.js 讀取 PostgreSQL knowledge_sections
  ↓
Claude 根據 ECOCO 知識庫產生回覆
  ↓
系統儲存對話紀錄
  ↓
如果 AI 回覆出現知識缺口標記，就寫入 unanswered_questions
  ↓
後台供內部人員查看與補資料
```

## 內部角色分工

| 角色 | 主要工作 |
| --- | --- |
| 客服/營運 | 查看 AI 回覆、知識缺口、常見問題，提出需要補的資料 |
| 主管/窗口 | 確認爭議資料、點數規則、站點名稱、合作方說法 |
| 維護者/工程 | 更新資料 JSON、部署、檢查 Render 與 PostgreSQL |
| 實習生/資料整理者 | 整理 FAQ、標記衝突、維護資料來源清單與周報 |

## 目前維護方向

目前專案應以新版為主，不需要和舊版專案整包合併。

舊版專案可以用來比對是否有缺漏知識，但不能直接匯入，原因是舊資料可能包含：

- 舊 API key 或 token。
- 舊站點名稱。
- 舊合作方名稱。
- 舊的 AI 草稿或錯誤事實。
- 不適合直接給客戶看的內部紀錄。

## 給內部的一句話

這個系統的核心不是「AI 自己亂答」，而是「AI 根據 ECOCO 整理過、可追蹤、可更新的知識庫回答」。

