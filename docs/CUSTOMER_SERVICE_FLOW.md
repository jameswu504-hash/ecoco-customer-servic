# ECOCO AI 客服 Flow 圖規劃

本文件用來協助在 Whimsical 繪製 ECOCO AI 客服實際運作流程。建議使用 Flowchart 或 Swimlane 形式，讓主管可以一眼看懂「使用者怎麼問、AI 怎麼查資料、後台怎麼補知識」。

## 一、Flow 圖目的

這張圖要說明：

- 使用者如何進入 ECOCO AI 客服。
- AI 如何使用 PostgreSQL 知識庫與 RAG 回答問題。
- 什麼情況會產生知識缺口。
- 後台人員如何補資料、刪除已處理的缺口。
- Git JSON 與 PostgreSQL 在資料維護上的角色。

## 二、建議畫法

Whimsical 建議使用 5 條泳道：

1. 使用者
2. 客服前台
3. AI 回覆服務
4. PostgreSQL 資料庫
5. 後台維護人員

## 三、Flow 圖節點

### 泳道 1：使用者

1. 進入 ECOCO 智慧客服頁面
2. 看到開場白：「Hi 可可粉」
3. 輸入問題
4. 收到 AI 回覆
5. 評分回覆是否有幫助

### 泳道 2：客服前台

1. 顯示品牌化客服介面
2. 送出問題到 `/api/chat`
3. 顯示 AI 回覆
4. 顯示客服表單或引導資訊
5. 記錄使用者評分

### 泳道 3：AI 回覆服務

1. 接收使用者問題
2. 判斷是否為高風險問題
3. 從 PostgreSQL `knowledge_chunks` 檢索相關資料
4. 將相關片段交給 Claude
5. Claude 依 ECOCO 語氣與知識庫回答
6. 若資料不足，使用保守話術並建立知識缺口

### 泳道 4：PostgreSQL 資料庫

1. `knowledge_sections` 儲存主要知識分類
2. `knowledge_chunks` 儲存 RAG 檢索片段
3. `conversations` 儲存對話紀錄
4. `ratings` 儲存評分資料
5. `unanswered_questions` 儲存知識缺口

### 泳道 5：後台維護人員

1. 登入客服後台
2. 查看對話紀錄與評分
3. 查看知識缺口列表
4. 手動到知識庫管理補資料
5. 補完後刪除該筆知識缺口
6. 定期整理 Git JSON 正式版本

## 四、Whimsical 連線順序

照這個順序畫箭頭：

```text
使用者進入客服頁
  ↓
看到 ECOCO 開場白
  ↓
輸入問題
  ↓
前台送出 /api/chat
  ↓
AI 服務接收問題
  ↓
從 knowledge_chunks 找相關片段
  ↓
Claude 產生 ECOCO 語氣回覆
  ↓
前台顯示回覆
  ↓
使用者評分
```

分支判斷：

```text
AI 是否找到足夠資料？
  ├─ 是 → 直接回答使用者 → 儲存對話紀錄
  └─ 否 → 使用保守話術 → 建立知識缺口 → 後台人員補資料 → 刪除知識缺口
```

資料維護分支：

```text
正式資料整理
  ↓
更新 Git JSON
  ↓
部署或同步
  ↓
寫入 PostgreSQL knowledge_sections
  ↓
重新產生 knowledge_chunks
  ↓
AI 回覆可使用新知識
```

## 五、Whimsical 畫圖教學

1. 打開 Whimsical，新增 Flowchart。
2. 建立 5 個區塊或泳道，分別命名：
   - 使用者
   - 客服前台
   - AI 回覆服務
   - PostgreSQL 資料庫
   - 後台維護人員
3. 使用圓角矩形放一般步驟，例如「輸入問題」。
4. 使用菱形放判斷，例如「AI 是否找到足夠資料？」。
5. 使用資料庫圖示或圓柱形放 PostgreSQL 表格。
6. 用箭頭串起主要流程。
7. 將「知識缺口」分支用橘色或紅色標示。
8. 將「正常回答」分支用藍色或綠色標示。
9. 圖完成後，把右上角 Share link 複製給主管。

## 六、建議標題

Whimsical 圖標題可以用：

```text
ECOCO AI 客服實際運作流程
```

副標題可以用：

```text
使用者提問、AI RAG 回覆、知識缺口維護與正式知識庫同步
```

