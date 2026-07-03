# ECOCO 內部 Wiki 模組規劃與使用方式

本文件說明第三階段「內部 Wiki」模組的設計方向。此模組用於內部人員知識管理、員工訓練、部門 SOP 查詢，不應與對外客服知識庫混在一起。

## 1. 設計原則

內部 Wiki 採用同一個 codebase，但建議獨立部署成另一個 Render service。

```text
對外客服服務
  APP_MODE=customer
  使用 knowledge_sections / knowledge_chunks
  回答 LINE、網站前台、客服後台問題

內部 Wiki 服務
  APP_MODE=internal
  使用 internal_wiki_entries
  提供員工訓練、內部 SOP、部門知識查詢
```

這樣做可以共用程式維護成本，但避免內部資料被對外客服誤用。

## 2. 為什麼不要直接混進對外客服

內部資料可能包含：

- 員工訓練教材
- 部門 SOP
- 內部系統操作方式
- 客訴處理判斷原則
- 不適合公開的營運資訊

如果把它們放進對外客服知識庫，AI 可能在面對客戶時引用到不該公開的內容。因此內部 Wiki 必須與對外客服知識分表、分權限、分服務管理。

## 3. Render 設定方式

正式建議建立第二個 Render Web Service，指向同一個 GitHub repo，但環境變數不同。

必要環境變數：

| 變數 | 建議值 | 用途 |
| --- | --- | --- |
| `APP_MODE` | `internal` | 啟用內部 Wiki API |
| `STAFF_KEY` | 公司內部隨機長密碼 | 內部 API 存取金鑰 |
| `DATABASE_URL` | PostgreSQL connection string | 儲存內部 Wiki 資料 |
| `ANTHROPIC_API_KEY` | Claude API key | 保留未來內部問答能力 |
| `ADMIN_KEY` | 管理者金鑰 | 保留既有管理 API |

若 `APP_MODE` 不是 `internal`，系統不會掛載 `/api/internal/*` 路由。

## 4. 目前已建立的資料表

內部 Wiki 使用獨立資料表：

```text
internal_wiki_entries
```

主要欄位：

| 欄位 | 說明 |
| --- | --- |
| `department` | 部門，例如 `cs`、`ops`、`bd`、`general` |
| `visibility` | 可見範圍，例如 `staff`、`manager`、`training`、`internal` |
| `title` | 內部知識標題 |
| `content` | 內部知識內容 |
| `tags` | 標籤 |
| `archived_at` | 封存時間，非空值代表不再搜尋 |

## 5. API 使用方式

所有內部 API 都需要 header：

```text
x-staff-key: <STAFF_KEY>
```

### 查詢狀態

```text
GET /api/internal/status
```

### 建立內部知識

```text
POST /api/internal/wiki
```

Body 範例：

```json
{
  "department": "cs",
  "visibility": "training",
  "title": "客服新人訓練：點數未入帳處理",
  "content": "先確認會員電話、回收時間、站點名稱，再交由後台查詢。",
  "tags": ["客服", "新人訓練", "點數"]
}
```

### 搜尋內部知識

```text
GET /api/internal/wiki/search?q=點數未入帳&department=cs&visibility=training
```

搜尋會依照：

- `department`
- `visibility`
- 是否封存

進行過濾，避免跨部門或非授權內容被查到。

## 6. 後續可以擴充的方向

第一階段已完成 API 與資料邊界。後續可以再做：

1. 內部 Wiki 前台頁面。
2. 內部問答模式，讓員工用自然語言問 SOP。
3. 員工訓練題庫與測驗。
4. 部門權限更細分，例如客服只能看 `cs` 與 `general`。
5. 內部資料匯入流程，例如從 Google Docs、Notion、Excel 匯入。

## 7. 上線建議

先不要把內部 Wiki 開在目前對外客服 Render service。建議新增第二個 Render service：

```text
ECOCO customer service
  APP_MODE=customer

ECOCO internal wiki
  APP_MODE=internal
```

這樣對外客服即使發生問題，也不會影響內部 Wiki；內部 Wiki 即使有內部資料，也不會被對外客服誤引用。
