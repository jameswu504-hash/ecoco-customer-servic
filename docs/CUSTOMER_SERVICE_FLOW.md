# ECOCO AI 客服流程圖規格

本文件是 ECOCO AI 客服流程圖的正式規格，可用於 Whimsical、簡報、交接文件或客服落地討論。流程圖目標是讓非工程人員也能理解：使用者提問後，系統如何查找 ECOCO 知識庫、套用客服規則、產生回答、紀錄知識缺口，並回到後台維護流程。

建議搭配 [CUSTOMER_ROLLOUT_GUIDE.md](CUSTOMER_ROLLOUT_GUIDE.md) 與 [LINE_ROLLOUT_CHECKLIST.md](LINE_ROLLOUT_CHECKLIST.md) 使用。

## 0. 對主管與客服的重點摘要

- AI 不會直接自由回答，而是先查 ECOCO 知識庫。
- 補點、退款、帳號、客訴、機台異常等高風險問題，AI 只能保守回覆並引導人工流程。
- AI 無法確認的問題會形成知識缺口，供客服或營運後續補資料。
- 後台修改會立即寫入 PostgreSQL，重大更新或交接前才需要下載 JSON 回寫 GitHub。
- LINE@ 未來只是另一個入口，仍共用同一套知識庫與規則。

## 1. Flow 圖目標

此 Flow 圖需說明：

1. 使用者提問後，AI 客服如何產生回答。
2. PostgreSQL、RAG、Rule、Claude 分別負責什麼。
3. AI 不確定或遇到高風險問題時，系統如何保守處理。
4. 客服人員如何從知識缺口回補知識庫。
5. 大改版或交接前，資料如何從 PostgreSQL 匯出回 Git JSON。

## 2. 建議流程圖結構

建議使用 Swimlane 方式繪製，分成 5 條泳道。

| 泳道 | 代表對象 | 主要節點 |
| --- | --- | --- |
| 使用者 | ECOCO 可可粉或一般會員 | 提問、收到回答、評分 |
| 前台客服頁 | `public/index.html` | 顯示訊息、送出問題、呈現回答 |
| 後端 API | Express routes | 驗證輸入、檢索知識、呼叫模型、寫入紀錄 |
| AI 與知識庫 | PostgreSQL、RAG、Claude | 找資料、套用 Rule、產生回答 |
| 後台維護 | 客服、營運、維護者 | 查看缺口、補知識、匯出 JSON |

建議顏色：

| 類型 | 顏色 |
| --- | --- |
| 一般使用流程 | 藍色 |
| 高風險控管 | 橘色 |
| 人工維護 | 綠色 |
| 資料庫與資料檔 | 灰色 |
| 錯誤或待確認 | 紅色 |

## 3. 主流程

```mermaid
flowchart TD
  A["使用者進入 ECOCO AI 客服"] --> B["輸入問題"]
  B --> C["前台送出 POST /api/chat"]
  C --> D["後端驗證輸入並建立 session"]
  D --> E["RAG 檢索 PostgreSQL knowledge_chunks"]
  E --> F["讀取 risk_level 與 response policies"]
  F --> G["組成 Claude system prompt"]
  G --> H["Claude Sonnet 產生回答"]
  H --> I{"是否有足夠依據回答？"}
  I -- "是" --> J["回覆使用者"]
  I -- "否" --> K["使用保守話術"]
  K --> L["寫入 unanswered_questions"]
  L --> J
  J --> M["使用者評分：有幫助 / 需改善"]
  M --> N["寫入 ratings"]
  J --> O["對話寫入 conversations"]
```

## 4. 高風險問題流程

高風險問題包含點數未入帳、優惠券無法兌換、補點、退款、帳號、會員資料、機台異常、客訴與補償。

```mermaid
flowchart TD
  A["使用者提出高風險問題"] --> B["RAG 找到相關知識 chunk"]
  B --> C["檢查 knowledge_chunks.risk_level"]
  C --> D{"risk_level 是否為 High？"}
  D -- "是" --> E["插入高風險回覆限制"]
  D -- "否" --> F["使用一般客服規則"]
  E --> G["AI 不得承諾補點、退款、補償或已處理"]
  G --> H["請使用者提供必要查詢資訊"]
  H --> I["引導客服表單或人工流程"]
  F --> J["產生一般 FAQ 回覆"]
```

高風險限制應明確標示在圖上，避免被理解成 AI 可直接處理個案。

## 5. 知識缺口流程

```mermaid
flowchart TD
  A["AI 判斷資料不足"] --> B["以保守話術回覆使用者"]
  B --> C["寫入 unanswered_questions"]
  C --> D["後台客服日常顯示待辦"]
  D --> E{"是否已有標準答案？"}
  E -- "有" --> F["補入 knowledge_sections"]
  F --> G["系統重建 knowledge_chunks"]
  G --> H["前台測試相似問題"]
  H --> I["刪除或標記已處理待辦"]
  E -- "沒有" --> J["交由主管或營運窗口確認"]
  J --> D
```

知識缺口不是 AI 錯誤清單，而是知識庫維護待辦。若是個案、個資或補償判定，不應直接寫成公開知識。

## 6. 知識庫維護流程

```mermaid
flowchart TD
  A["客服或維護者在後台搜尋分類"] --> B{"是否已有相近分類？"}
  B -- "有" --> C["修改既有分類"]
  B -- "沒有" --> D["新增分類"]
  C --> E["儲存至 PostgreSQL knowledge_sections"]
  D --> E
  E --> F["系統重建 knowledge_chunks"]
  F --> G["AI 下一次回答可使用新知識"]
  G --> H{"是否為大改版或交接前？"}
  H -- "是" --> I["後台下載 JSON"]
  I --> J["人工確認內容"]
  J --> K["覆蓋 data/ecoco-knowledge-import.json"]
  K --> L["commit / push 到 GitHub"]
  H -- "否" --> M["維持在 PostgreSQL 線上使用"]
```

## 7. 資料版本流程

此段建議在 Whimsical 畫成獨立小流程，避免混在主客服流程中。

```text
後台小修
  -> PostgreSQL 立即更新
  -> AI 立即可讀
  -> 不會自動進 Git

重大更新 / 交接
  -> 後台下載 JSON
  -> 人工確認
  -> 放回 data/ecoco-knowledge-import.json
  -> commit / push
  -> Render 部署或保留版本
```

## 8. 圖面繪製步驟

1. 使用 Whimsical 或其他流程圖工具建立 Flowchart。
2. 建立 5 條泳道：使用者、前台客服頁、後端 API、AI 與知識庫、後台維護。
3. 先畫主流程，從「使用者提問」到「AI 回覆與評分」。
4. 在 RAG 後方加入判斷節點：「是否高風險？」與「是否有足夠依據？」。
5. 高風險分支使用橘色，知識缺口分支使用紅色或綠色。
6. 在右側另放「知識庫維護流程」與「JSON 版本流程」。
7. 圖中避免放程式碼細節，只保留 `POST /api/chat`、`knowledge_sections`、`knowledge_chunks`、`Claude` 等必要名詞。

## 9. 可直接貼進流程圖工具的文字版

```text
使用者提問
-> 前台送出 /api/chat
-> 後端驗證輸入並建立 session
-> RAG 從 PostgreSQL knowledge_chunks 找相關知識
-> 讀取 risk_level 與 response policies
-> Claude Sonnet 產生回答
-> 判斷是否有足夠依據
   -> 有：回覆使用者
   -> 沒有：保守回覆 + 建立知識缺口
-> 寫入 conversations
-> 使用者評分寫入 ratings
-> 後台查看對話、評分、知識缺口
-> 內部人員補 knowledge_sections
-> 系統重建 knowledge_chunks
-> 大改版或交接前下載 JSON 回寫 GitHub
```

## 10. 給非技術人員的說明

ECOCO AI 客服不是把問題直接丟給 AI 自由回答。系統會先從 ECOCO 的知識庫找資料，再套用客服規則與風險限制，最後才讓 Claude 產生回覆。遇到不確定或高風險問題時，AI 會保守回答並留下知識缺口，讓客服或營運人員後續補資料。

## 11. 圖面驗收標準

完成的 Flow 圖應符合：

- 非工程人員能看懂使用者問題如何變成 AI 回覆。
- 有清楚標出 PostgreSQL、RAG、Rule、Claude 的角色。
- 有清楚標出高風險問題不可由 AI 直接承諾。
- 有清楚標出知識缺口如何回到知識庫維護。
- 有清楚標出後台下載 JSON 不等於自動寫回 GitHub。
