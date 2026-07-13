# ECOCO AI 客服專案：個資外洩止血與 Git 歷史清除方案

## 目前狀態

- 已將目前工作樹中的台灣手機號與 email 匿名化。
- 已新增 `npm run anonymize:pii`，可在資料匯入或 commit 前批次匿名化。
- 已新增 `npm run scan:pii`，可掃描 repo 是否仍含台灣手機號或 email。
- 目前尚未清除 Git 歷史。過去 commit 若曾包含個資，仍可能被有權限者從歷史中查到。

## 立即處置順序

1. 將 GitHub repo 改成 Private。
2. 停止將未匿名化客服資料放入 Git。
3. 執行並確認：

```bash
npm run anonymize:pii
npm run scan:pii
npm test
```

4. 將匿名化後的版本 commit / push。
5. 向內部主管或資安窗口回報：曾有客服資料進入公開 repo，並說明已完成的止血項目。

## Git 歷史清除前提

清除 Git 歷史會 rewrite commits，通常需要 force push。執行前必須確認：

- GitHub repo 已改 Private。
- Render 部署來源與分支已確認。
- GitLab 是否也有同步同一份歷史。
- 所有協作者知道要重新 clone 或 reset 本機 repo。
- 公司同意執行 history rewrite。

## 建議工具

優先使用 `git filter-repo`。若本機沒有安裝，可改用 BFG Repo-Cleaner。

### 方案 A：移除整份敏感資料歷史

若公司決定 `data/*.json` 不應存在 Git 歷史，可移除這兩個檔案的歷史：

```bash
git filter-repo --path data/ecoco-knowledge-import.json --path data/ecoco-ai-customer-service-database.json --invert-paths
git push origin --force --all
git push origin --force --tags
```

此方案最乾淨，但會讓歷史中的資料檔完全消失。之後需要重新加入匿名化版本。

### 方案 B：用文字替換清除歷史中的個資

若公司希望保留資料檔歷史，可以準備 replacement 檔，把已知手機、email 替換為匿名字串，再跑：

```bash
git filter-repo --replace-text replacements.txt
git push origin --force --all
git push origin --force --tags
```

此方案可保留檔案歷史，但需要完整列出所有要替換的內容，較容易漏。

## 執行後驗證

rewrite history 後，必須重新 clone 一份乾淨 repo，執行：

```bash
npm run scan:pii
git log --all -- data/ecoco-knowledge-import.json data/ecoco-ai-customer-service-database.json
```

若掃描乾淨，且歷史中不再能取回敏感內容，才算完成。

## 後續制度

- 新資料進 Git 前，必跑 `npm run anonymize:pii` 與 `npm run scan:pii`。
- 若資料來自客服、Excel、截圖、對話紀錄，預設視為可能含個資。
- 公開作品集只能放匿名化資料或範例資料。
- 真實客服資料只放公司授權的 private repo、資料庫或內部系統。
