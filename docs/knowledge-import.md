# ECOCO 知識庫匯入流程

本專案可用 `data/ecoco-knowledge-import.json` 將整理後的 ECOCO FAQ、Meta 指令與舊 CommandCenter 品牌規則匯入 PostgreSQL 的 `knowledge_sections`。

## 已整理來源

| 檔案 | 匯入方式 |
| --- | --- |
| `凡立橙股份有限公司_官網常見問題_茗芬V2 的副本.xlsx` | 匯入最新版 `官網常見問題 20260515` 與 `回覆問答` |
| `目前給Meta ai 指令.md` | 匯入為社群客服回覆規則 |
| `ECOCO_CS_CommandCenter_v1.9.3/config.json` | 只匯入 `brand_context`，不匯入任何 key/token/mail 設定 |

## 匯入指令

先確認 `.env` 已設定：

```bash
DATABASE_URL=postgresql://...
PGSSL=require
```

一般匯入或更新同名分類：

```bash
npm run import:knowledge
```

如果要清空舊分類，完全改用這份整理資料：

```bash
npm run import:knowledge -- data/ecoco-knowledge-import.json --replace
```

## 產出檔案

| 檔案 | 用途 |
| --- | --- |
| `data/ecoco-knowledge-import.json` | 可匯入 `knowledge_sections` 的知識分類 |
| `data/ecoco-response-policies.json` | 未來可做 `response_policies` 表的 SOP 規則 |

## 注意事項

1. 歷史版 FAQ 沒有直接匯入，避免新舊規則混在一起。
2. `關鍵字_內部備註` 被標記為內部輔助，不建議對客戶逐字揭露。
3. 舊 CommandCenter 的 API key/token 不會被匯入。
4. 高風險問題，例如點數、優惠券、帳號、客訴，建議走 AI 草稿加人工審核。

