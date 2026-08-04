# ECOCO AI 客服文件

這裡只列目前仍有效、需要持續維護的文件。日期型交接、一次性檢查與舊版流程已移到 `archive/`，不得作為現行系統依據。

## 系統層次

```text
ECOCO AI 客服
├─ B2C AI 客服（核心）
│  ├─ 官網聊天
│  ├─ LINE 一對一聊天
│  ├─ ECOCO 共用知識庫
│  └─ Hive 站點狀態同步資料
└─ B2B 合作夥伴（擴充層）
   ├─ LINE 群組綁定
   ├─ 公司專屬知識庫
   └─ 群組對話保存、清洗與人工審核
```

B2C 不需要群組綁定。B2B 群組完成綁定後，才可使用該公司的私有資料；公司資料以 `company_id` 隔離。

## 目前有效文件

### B2C AI 客服

- [B2C 系統說明](b2c/README.md)：渠道、資料來源、回答流程與邊界。
- [客服操作指南](b2c/CUSTOMER_SUPPORT_GUIDE.md)：客服人員如何使用前後台與維護知識。

### B2B 合作夥伴

- [B2B LINE 群組與公司資料](b2b/README.md)：綁定、觸發、權限與資料隔離。
- [LINE 對話轉知識審核](b2b/KNOWLEDGE_REVIEW.md)：候選知識、人工審核及匯入流程。
- [`skills/ecoco-clean-brand-knowledge/SKILL.md`](../skills/ecoco-clean-brand-knowledge/SKILL.md)：品牌資料清洗規則。

### 維運

- [部署手冊](operations/DEPLOYMENT_RUNBOOK.md)
- [日常維護](operations/MAINTENANCE_GUIDE.md)
- [LINE 串接](operations/LINE_INTEGRATION_GUIDE.md)
- [Hive／IoT 站點狀態同步](operations/IOT_STATION_STATUS.md)
- [評測與可觀測性](operations/EVAL_OBSERVABILITY_GUIDE.md)

### 技術參考

- [系統架構](ARCHITECTURE.md)
- [資料字典](reference/DATA_DICTIONARY.md)
- [知識與資料來源](reference/KNOWLEDGE_DATA.md)
- [密鑰安全](reference/SECURITY_KEYS.md)

### 未來構想與歷史資料

- `future/`：尚未成為正式功能的研究與規劃。
- `archive/`：歷史 PRD、交接、一次性 QA 與舊流程，只供追溯。

## 文件維護規則

1. 現行說明依 B2C、B2B、維運、技術參考分類，不再新增日期型 handoff 文件。
2. 同一功能只保留一份現行說明；修改功能時同步更新該文件與本索引。
3. 不在文件硬寫站點數、測試檔數或知識筆數等容易過期的數字。
4. 歷史文件移入 `archive/` 後不再維護，也不得拿來判斷正式環境行為。
5. 未實作內容只能放在 `future/`，不可寫成已上線功能。
