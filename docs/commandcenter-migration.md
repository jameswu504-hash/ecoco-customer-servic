# 舊 CommandCenter 分析與新版全自動客服應用

`ECOCO_CS_CommandCenter_v1.9.3` 是舊版或原型客服中控台，不建議直接併入新版專案。公司目前方向是新版 AI 客服「全自動回覆」，不是舊 CommandCenter 的人工審核草稿流程。新版只抽取可維護的知識、品牌規則與 SOP，再放進 PostgreSQL 與後台管理。

## 可沿用

| 來源 | 可沿用內容 | 新版位置 |
| --- | --- | --- |
| `config.json` 的 `brand_context` | 品牌語氣、點數效期、機台 SOP、未知問題處理原則 | system prompt / `knowledge_sections` / 未來 `response_policies` |
| `automation.db.pending_tickets` | 客戶訊息、AI 草稿、人工審核狀態 | 僅作流程參考；新版以自動回覆紀錄與知識缺口追蹤取代 |
| `automation.db.scheduled_tasks` | 延後處理或提醒任務概念 | 未來排程提醒 |

## 不建議沿用

| 內容 | 原因 |
| --- | --- |
| 舊 API key / token | 已出現在打包檔中，應視為外露風險 |
| 舊 AI 草稿 | 有與新版規則衝突的內容，例如點數效期被寫成終生有效 |
| `_internal/` | 只是桌面程式依賴套件，不是客服知識 |
| SQLite 單機資料庫 | 不適合多人客服後台與長期維護 |

## 新版建議流程

1. 低風險 FAQ 可由 AI 直接回答。
2. 點數、優惠券、帳號、客訴與機台異常仍由 AI 直接回覆，但必須用保守話術收集必要資訊。
3. 需要後台查詢或人工處理的事項，AI 只引導 App 或客服表單，不承諾補點、退款或已完成人工處理。
4. AI 無法回答時寫入知識缺口。
5. 管理者定期從知識缺口補回 `knowledge_sections`。

## 建議後續資料表

| 資料表 | 用途 |
| --- | --- |
| `tickets` | 收 LINE / Meta / Zendesk / Email 進來的客服問題與 AI 自動回覆內容 |
| `auto_reply_events` | 儲存 AI 自動回覆、引用知識、風險等級與是否命中知識缺口 |
| `ticket_events` | 記錄轉人工、補件、送出、關閉等事件 |
| `response_policies` | 儲存點數未入帳、優惠券異常、機台異常等處理規則 |
| `ops_signals` | 儲存客訴週報中的熱點站點與異常分類 |
