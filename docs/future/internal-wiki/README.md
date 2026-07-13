# Future Module: Internal Wiki

本資料夾保存「內部知識系統 / 員工訓練 Wiki」的規劃文件。

目前正式客服系統預設不啟用此模組。Render production 應維持：

```text
APP_MODE=customer
```

只有未來要建立內部人員用的知識管理服務時，才建議另開一個 Render service，並設定：

```text
APP_MODE=internal
STAFF_KEY=<company-staff-secret>
```

此模組與對外客服知識庫必須分開管理，避免內部 SOP、員工訓練資料或不公開規則被對外 AI 客服引用。

## Documents

| File | Purpose |
| --- | --- |
| [INTERNAL_WIKI_GUIDE.md](INTERNAL_WIKI_GUIDE.md) | 內部 Wiki 的部署、API 與資料表設計規劃 |
| [LLM_WIKI_RULE_MODEL_STRATEGY.md](LLM_WIKI_RULE_MODEL_STRATEGY.md) | LLM Wiki、Rule、Gemma/Llama/Ollama 等後續模型策略討論 |

