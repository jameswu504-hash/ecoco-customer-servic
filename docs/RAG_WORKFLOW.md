# ECOCO AI 客服 RAG 第一版

## 這版做了什麼

本專案已加入 RAG 第一版：AI 回覆前，不再只依賴整包 `knowledge_sections`，而是先從 PostgreSQL 檢索相關知識片段，再把最相關的內容交給 Claude 回答。

目前流程：

```text
使用者提問
  ↓
server.js 從 PostgreSQL knowledge_chunks 搜尋相關片段
  ↓
取前 8 筆相關 chunks
  ↓
把 chunks 放進 Claude system prompt
  ↓
Claude 根據檢索結果回答
```

## 新增資料表

### `knowledge_chunks`

`knowledge_chunks` 是從 `knowledge_sections` 自動拆出來的檢索用資料表。

| 欄位 | 說明 |
| --- | --- |
| `id` | chunk 流水號 |
| `section_id` | 來源 `knowledge_sections.id` |
| `category` | 來源分類 |
| `title` | chunk 標題 |
| `content` | chunk 內容 |
| `search_text` | 給搜尋使用的合併文字 |
| `sort_order` | 排序 |
| `source_updated_at` | 來源 section 的更新時間 |
| `updated_at` | chunk 建立/更新時間 |

## 什麼時候會重建 chunks

以下情況會自動重建 `knowledge_chunks`：

- server 啟動時。
- GitHub 的 `data/ecoco-knowledge-import.json` 同步到 PostgreSQL 後。
- 後台新增知識庫分類後。
- 後台修改知識庫分類後。
- 後台刪除知識庫分類後。

## 這版不是什麼

這版還不是 pgvector embedding RAG。

目前是 PostgreSQL 文字檢索版，優點是：

- 不需要新增 embedding API key。
- 不需要改 Render 環境變數。
- 不需要先處理 pgvector extension。
- 可以立刻讓 AI 從「整包知識」改成「先檢索相關知識」。

限制是：

- 中文語意相似度沒有 embedding 精準。
- 問法差很多時，可能抓不到最相關資料。
- 不能做真正的向量相似度搜尋。

## 下一階段建議

下一階段可以升級成：

```text
PostgreSQL + pgvector + embeddings
```

建議新增：

- `embedding` 欄位。
- embedding 建立腳本。
- 向量相似度排序。
- 後台顯示「本次 AI 引用了哪些 chunks」。
- 高風險分類檢索權重。

## 給主管的說法

可以這樣說：

> 目前 PostgreSQL 已經不只是存資料，而是新增了 RAG 檢索層。系統會把知識庫拆成 `knowledge_chunks`，每次使用者提問時先從 PostgreSQL 找相關片段，再交給 Claude 回答。這是第一版 RAG，先不新增 embedding API key；後續可以升級成 pgvector 向量搜尋。

