# B2B LINE 群組與公司資料

## 定位

B2B 是架在 B2C AI 客服之上的合作夥伴擴充層。目前正式使用情境是全家群組；未來新增小北、全聯等公司時，各自建立公司資料與群組綁定，不共用私有知識。

## 群組綁定

1. 管理者在 `/partners.html` 建立合作公司及一次性綁定碼。
2. 將 ECOCO LINE Bot 加入合作群組。
3. 在該群輸入綁定碼。
4. 系統將 LINE `groupId` 與 `company_id` 寫入 `partner_line_groups`。

綁定碼有期限且只能使用一次；它過期不會解除已完成的綁定。成功綁定會保存在 PostgreSQL，直到管理者停用公司、封存或刪除相應綁定資料。

## 何時回答

- 所有 LINE 群組訊息都先進入 B2B gate。
- 未綁定群組只會收到綁定指引，不會使用一般 B2C 知識回答。
- 已綁定群組只有在 Bot 被點名或訊息使用支援的文字觸發方式時才回答。
- LINE 客戶端無法產生正式 mention metadata 時，可在訊息開頭使用 `@ECOCO` 或 `/ecoco`。
- 未觸發回答的群組訊息仍可保存為對話紀錄，供後續整理；Bot 不插話。

## 回答權限

已綁定群組視為該合作公司的內部工作群。回答可使用：

1. ECOCO B2C 共用知識。
2. 該群組所綁定公司的全部已啟用、已核准知識。

回答不得使用其他公司的私有資料。系統必須以 `company_id` 過濾 `partner_knowledge_sections` 與 `partner_knowledge_chunks`，不可只靠提示詞要求模型自律。

必要的內部姓名、電話與 Email 可以出現在 B2B 回答引用片段中。系統只把本次問題檢索到的必要片段送給 Claude，不會把整個公司資料庫傳出去。

## 對話保存與敏感資料

- 問題與回答寫入 `partner_conversations` 前會執行敏感資料遮蔽。
- LINE webhook 處理狀態寫入 `line_webhook_events`，方便排錯與確認是否回覆。
- 對話依公司、群組與日期查詢，可搜尋訊息或群組名稱，並以 10／15／20／50／100 天分頁；測試資料可封存、恢復或刪除。
- 保存對話不代表自動成為知識；必須經清洗與人工審核。

## 公司資料匯入

支援 `.txt` 與 `.md`：

1. 原始檔保留在公司 Local 端。
2. 使用 [`ecoco-clean-brand-knowledge`](../../skills/ecoco-clean-brand-knowledge/SKILL.md) 的規則式流程清洗，不把原始內容送給外部 AI。
3. 先預覽清洗結果，再由人工確認匯入。
4. SQL 保存來源 metadata、清洗狀態、知識文件與 RAG chunks。
5. 匯入後仍以 `company_id` 隔離。

LINE 群組對話要轉成正式知識時，走相同的人工審核原則，詳見 [LINE 對話轉知識審核](KNOWLEDGE_REVIEW.md)。

## 管理入口

`/partners.html` 用於：

- 建立、停用合作公司。
- 產生群組綁定碼。
- 匯入、預覽及核准公司資料。
- 查閱、搜尋、分頁、封存或刪除 LINE 對話。
- 審核由對話整理出的候選知識。
- 對已核准知識建立待審修訂版；新版核准後自動封存被取代的舊知識。

LINE 技術設定見 [LINE 串接](../operations/LINE_INTEGRATION_GUIDE.md)。
