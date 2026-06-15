# ECOCO 知識庫品質稽核

本文件由 `npm run audit:knowledge` 產生，用來找出重複問題與待確認衝突。這不是自動清資料的腳本，而是給人工審核使用的清單。

## 摘要

- 知識筆數：878
- 重複問題組數：135
- 重複涉及筆數：334
- 待確認衝突：5

## 去重原則

建議優先序：

1. 官方 FAQ
2. 線上 FAQ API
3. 回覆政策文件
4. 社群回覆範本
5. 舊 Meta / system prompt
6. 真人客服話術

真人客服話術可保留語氣參考，但若和官方 FAQ 衝突，應以官方 FAQ 為準。

## 重複問題清單（前 40 組）

### 1. 收不到簡訊驗證碼

- 重複筆數：8
- 建議保留：KB-0684
- 原因：優先來源：web_faq_api；風險：Medium
- 候選資料：
  - 檢查：KB-0677 / web_faq_api / APP帳號註冊問題 / Medium
  - 檢查：KB-0683 / web_faq_api / APP帳號註冊問題 / Medium
  - 保留：KB-0684 / web_faq_api / APP帳號註冊問題 / Medium
  - 檢查：KB-0687 / web_faq_api / APP帳號註冊問題 / Medium
  - 檢查：KB-0703 / web_faq_api / APP帳號註冊問題 / Medium
  - 檢查：KB-0718 / web_faq_api / APP帳號註冊問題 / Medium
  - 檢查：KB-0720 / web_faq_api / APP帳號註冊問題 / Medium
  - 檢查：KB-0721 / web_faq_api / APP帳號註冊問題 / Medium

### 2. 滿艙灰色狀態

- 重複筆數：8
- 建議保留：KB-0680
- 原因：優先來源：web_faq_api；風險：Low
- 候選資料：
  - 檢查：KB-0489 / agent_reply_bank / 機台相關問題 / Low
  - 檢查：KB-0490 / agent_reply_bank / 機台相關問題 / Low
  - 保留：KB-0680 / web_faq_api / 機台相關問題 / Low
  - 檢查：KB-0681 / web_faq_api / 機台相關問題 / Low
  - 檢查：KB-0688 / web_faq_api / 機台相關問題 / Low
  - 檢查：KB-0696 / web_faq_api / 機台相關問題 / Low
  - 檢查：KB-0697 / web_faq_api / 機台相關問題 / Low
  - 檢查：KB-0708 / web_faq_api / 機台相關問題 / Low

### 3. 通用版

- 重複筆數：7
- 建議保留：KB-0075
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 檢查：KB-0073 / agent_reply_bank / 合作洽談 / Low
  - 檢查：KB-0074 / agent_reply_bank / 合作洽談 / Low
  - 保留：KB-0075 / agent_reply_bank / 合作洽談 / Low
  - 檢查：KB-0182 / agent_reply_bank / 重複填表 / Low
  - 檢查：KB-0184 / agent_reply_bank / 重複填表 / Medium
  - 檢查：KB-0185 / agent_reply_bank / 重複填表 / Medium
  - 檢查：KB-0188 / agent_reply_bank / 常見問題 / Low

### 4. 電子序號兌換完畢

- 重複筆數：7
- 建議保留：KB-0667
- 原因：優先來源：web_faq_api；風險：High
- 候選資料：
  - 檢查：KB-0539 / agent_reply_bank / 優惠券兌換問題 / High
  - 檢查：KB-0540 / agent_reply_bank / 優惠券兌換問題 / High
  - 保留：KB-0667 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0668 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0678 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0740 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0741 / web_faq_api / 優惠券兌換問題 / High

### 5. 釐清與提供排除步驟

- 重複筆數：7
- 建議保留：KB-0731
- 原因：優先來源：web_faq_api；風險：Medium
- 候選資料：
  - 檢查：KB-0717 / web_faq_api / APP2.0 / Medium
  - 檢查：KB-0727 / web_faq_api / APP2.0 / Medium
  - 檢查：KB-0728 / web_faq_api / APP2.0 / Medium
  - 檢查：KB-0729 / web_faq_api / APP2.0 / Medium
  - 檢查：KB-0730 / web_faq_api / APP2.0 / Medium
  - 保留：KB-0731 / web_faq_api / APP2.0 / Medium
  - 檢查：KB-0791 / web_faq_api / APP2.0 / Medium

### 6. 更改帳號

- 重複筆數：5
- 建議保留：KB-0787
- 原因：優先來源：web_faq_api；風險：Medium
- 候選資料：
  - 檢查：KB-0428 / agent_reply_bank / APP2.0 / Medium
  - 檢查：KB-0682 / web_faq_api / APP2.0 / High
  - 檢查：KB-0786 / web_faq_api / APP2.0 / Medium
  - 保留：KB-0787 / web_faq_api / APP2.0 / Medium
  - 檢查：KB-0792 / web_faq_api / APP2.0 / Medium

### 7. 站點

- 重複筆數：5
- 建議保留：KB-0415
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 檢查：KB-0190 / agent_reply_bank / 許願 / Low
  - 檢查：KB-0191 / agent_reply_bank / 許願 / Low
  - 檢查：KB-0192 / agent_reply_bank / 許願 / Low
  - 檢查：KB-0193 / agent_reply_bank / 許願 / Low
  - 保留：KB-0415 / agent_reply_bank / APP2.0 / Low

### 8. 維護時程 / 通用版

- 重複筆數：5
- 建議保留：KB-0294
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 檢查：KB-0290 / agent_reply_bank / 機台需要協助 / Low
  - 檢查：KB-0291 / agent_reply_bank / 機台需要協助 / Medium
  - 檢查：KB-0292 / agent_reply_bank / 機台需要協助 / Medium
  - 檢查：KB-0293 / agent_reply_bank / 機台需要協助 / Medium
  - 保留：KB-0294 / agent_reply_bank / 機台需要協助 / Low

### 9. 沒紀錄未計點釐清

- 重複筆數：4
- 建議保留：KB-0670
- 原因：優先來源：web_faq_api；風險：Medium
- 候選資料：
  - 保留：KB-0670 / web_faq_api / 回收點數問題 / Medium
  - 檢查：KB-0673 / web_faq_api / 回收點數問題 / Medium
  - 檢查：KB-0693 / web_faq_api / 回收點數問題 / Medium
  - 檢查：KB-0748 / web_faq_api / 回收點數問題 / Medium

### 10. 首頁

- 重複筆數：4
- 建議保留：KB-0059
- 原因：優先來源：official_faq；風險：Low
- 候選資料：
  - 保留：KB-0059 / official_faq / 官網常見問題 / Low
  - 檢查：KB-0060 / official_faq / 官網常見問題 / Low
  - 檢查：KB-0061 / official_faq / 官網常見問題 / High
  - 檢查：KB-0062 / official_faq / 官網常見問題 / Medium

### 11. 釐清為何已使用未折抵

- 重複筆數：4
- 建議保留：KB-0705
- 原因：優先來源：web_faq_api；風險：High
- 候選資料：
  - 保留：KB-0705 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0734 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0738 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0758 / web_faq_api / 優惠券兌換問題 / High

### 12. app畫面顯示與機台狀態不符 / 解說版

- 重複筆數：4
- 建議保留：KB-0385
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 檢查：KB-0383 / agent_reply_bank / APP使用問題 / Medium
  - 檢查：KB-0384 / agent_reply_bank / APP使用問題 / Low
  - 保留：KB-0385 / agent_reply_bank / APP使用問題 / Low
  - 檢查：KB-0386 / agent_reply_bank / APP使用問題 / Medium

### 13. 不當操作

- 重複筆數：3
- 建議保留：KB-0698
- 原因：優先來源：web_faq_api；風險：Low
- 候選資料：
  - 檢查：KB-0664 / web_faq_api / 機台相關問題 / Medium
  - 檢查：KB-0690 / web_faq_api / 機台相關問題 / Medium
  - 保留：KB-0698 / web_faq_api / 機台相關問題 / Low

### 14. 不當獲取點數者，將視嚴重程度進行追責

- 重複筆數：3
- 建議保留：KB-0028
- 原因：優先來源：official_faq；風險：Medium
- 候選資料：
  - 保留：KB-0028 / official_faq / 官網常見問題 / Medium
  - 檢查：KB-0446 / agent_reply_bank / APP2.0 / Medium
  - 檢查：KB-0626 / agent_reply_bank / 官網 / Medium

### 15. 手機號碼停用，如何申請轉換帳號呢?

- 重複筆數：3
- 建議保留：KB-0006
- 原因：優先來源：official_faq；風險：Medium
- 候選資料：
  - 保留：KB-0006 / official_faq / 官網常見問題 / Medium
  - 檢查：KB-0442 / agent_reply_bank / APP2.0 / Medium
  - 檢查：KB-0604 / agent_reply_bank / 官網 / Medium

### 16. 回收倉已滿 / 通用版

- 重複筆數：3
- 建議保留：KB-0238
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 檢查：KB-0235 / agent_reply_bank / 機台需要協助 / Medium
  - 檢查：KB-0236 / agent_reply_bank / 機台需要協助 / Low
  - 保留：KB-0238 / agent_reply_bank / 機台需要協助 / Low

### 17. 如何修改會員資料

- 重複筆數：3
- 建議保留：KB-0004
- 原因：優先來源：official_faq；風險：Low
- 候選資料：
  - 保留：KB-0004 / official_faq / 官網常見問題 / Low
  - 檢查：KB-0441 / agent_reply_bank / APP2.0 / Low
  - 檢查：KB-0602 / agent_reply_bank / 官網 / Low

### 18. 如何註銷ECOCO帳號?

- 重複筆數：3
- 建議保留：KB-0007
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0007 / official_faq / 官網常見問題 / High
  - 檢查：KB-0443 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0605 / agent_reply_bank / 官網 / High

### 19. 我想使用ECOCO點數兌換商家提供的優惠，要如何操作呢？

- 重複筆數：3
- 建議保留：KB-0029
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0029 / official_faq / 官網常見問題 / High
  - 檢查：KB-0447 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0627 / agent_reply_bank / 官網 / High

### 20. 肯德基

- 重複筆數：3
- 建議保留：KB-0699
- 原因：優先來源：web_faq_api；風險：High
- 候選資料：
  - 檢查：KB-0502 / agent_reply_bank / 優惠券兌換問題 / High
  - 保留：KB-0699 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0713 / web_faq_api / 優惠券兌換問題 / High

### 21. 後台註冊 / 收不到簡訊驗證碼

- 重複筆數：3
- 建議保留：KB-0510
- 原因：優先來源：agent_reply_bank；風險：Medium
- 候選資料：
  - 檢查：KB-0508 / agent_reply_bank / APP帳號註冊問題 / Medium
  - 檢查：KB-0509 / agent_reply_bank / APP帳號註冊問題 / Medium
  - 保留：KB-0510 / agent_reply_bank / APP帳號註冊問題 / Medium

### 22. 為什麼每一個商家提供的點數使用規則不一樣呢？

- 重複筆數：3
- 建議保留：KB-0030
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0030 / official_faq / 官網常見問題 / High
  - 檢查：KB-0448 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0628 / agent_reply_bank / 官網 / High

### 23. 為何收不到手機驗證碼簡訊?

- 重複筆數：3
- 建議保留：KB-0002
- 原因：優先來源：official_faq；風險：Medium
- 候選資料：
  - 保留：KB-0002 / official_faq / 官網常見問題 / Medium
  - 檢查：KB-0440 / agent_reply_bank / APP2.0 / Medium
  - 檢查：KB-0600 / agent_reply_bank / 官網 / Medium

### 24. 首頁 / 使用教學

- 重複筆數：3
- 建議保留：KB-0657
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 保留：KB-0657 / agent_reply_bank / 官網 / Low
  - 檢查：KB-0658 / agent_reply_bank / 官網 / Low
  - 檢查：KB-0659 / agent_reply_bank / 官網 / Low

### 25. 處理期間等待說明

- 重複筆數：3
- 建議保留：KB-0672
- 原因：優先來源：web_faq_api；風險：Low
- 候選資料：
  - 檢查：KB-0545 / agent_reply_bank / 顧客關係問題 / Low
  - 保留：KB-0672 / web_faq_api / 顧客關係問題 / Low
  - 檢查：KB-0746 / web_faq_api / 顧客關係問題 / Low

### 26. 無法登入

- 重複筆數：3
- 建議保留：KB-0676
- 原因：優先來源：web_faq_api；風險：Medium
- 候選資料：
  - 保留：KB-0676 / web_faq_api / 機台相關問題 / Medium
  - 檢查：KB-0711 / web_faq_api / 機台相關問題 / Medium
  - 檢查：KB-0831 / social_reply_template / 📱 APP / 帳號問題 / Medium

### 27. 無法登入 / 發生未預期錯誤 / 安卓版

- 重複筆數：3
- 建議保留：KB-0431
- 原因：優先來源：agent_reply_bank；風險：Medium
- 候選資料：
  - 檢查：KB-0430 / agent_reply_bank / APP2.0 / Medium
  - 保留：KB-0431 / agent_reply_bank / APP2.0 / Medium
  - 檢查：KB-0438 / agent_reply_bank / APP2.0 / Medium

### 28. 註銷ECOCO帳號後，能否重新註冊?

- 重複筆數：3
- 建議保留：KB-0008
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0008 / official_faq / 官網常見問題 / High
  - 檢查：KB-0444 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0606 / agent_reply_bank / 官網 / High

### 29. 點數效期 / 點數效期 / 官方公告完整版    (鈺雯)

- 重複筆數：3
- 建議保留：KB-0410
- 原因：優先來源：agent_reply_bank；風險：High
- 候選資料：
  - 檢查：KB-0409 / agent_reply_bank / APP2.0 / High
  - 保留：KB-0410 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0411 / agent_reply_bank / APP2.0 / High

### 30. ECOCO點數可以在哪些商家進行折抵呢？

- 重複筆數：3
- 建議保留：KB-0031
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0031 / official_faq / 官網常見問題 / High
  - 檢查：KB-0449 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0629 / agent_reply_bank / 官網 / High

### 31. ECOCO點數有使用期限嗎？

- 重複筆數：3
- 建議保留：KB-0026
- 原因：優先來源：official_faq；風險：Medium
- 候選資料：
  - 保留：KB-0026 / official_faq / 官網常見問題 / Medium
  - 檢查：KB-0445 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0624 / agent_reply_bank / 官網 / Medium

### 32. ECOCO點數換取的優惠全台通用嗎？

- 重複筆數：3
- 建議保留：KB-0032
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0032 / official_faq / 官網常見問題 / High
  - 檢查：KB-0450 / agent_reply_bank / APP2.0 / High
  - 檢查：KB-0630 / agent_reply_bank / 官網 / High

### 33. 人工補點 / 需求核對 / 通用版

- 重複筆數：2
- 建議保留：KB-0104
- 原因：優先來源：agent_reply_bank；風險：Medium
- 候選資料：
  - 檢查：KB-0103 / agent_reply_bank / 回收點數問題 / Medium
  - 保留：KB-0104 / agent_reply_bank / 回收點數問題 / Medium

### 34. 小北百貨 / 通用版

- 重複筆數：2
- 建議保留：KB-0344
- 原因：優先來源：agent_reply_bank；風險：High
- 候選資料：
  - 檢查：KB-0343 / agent_reply_bank / 優惠券兌換問題 / High
  - 保留：KB-0344 / agent_reply_bank / 優惠券兌換問題 / High

### 35. 小鈴鐺

- 重複筆數：2
- 建議保留：KB-0388
- 原因：優先來源：agent_reply_bank；風險：Low
- 候選資料：
  - 檢查：KB-0382 / agent_reply_bank / APP使用問題 / Low
  - 保留：KB-0388 / agent_reply_bank / APP使用問題 / Low

### 36. 已使用或已過期退點機制

- 重複筆數：2
- 建議保留：KB-0719
- 原因：優先來源：web_faq_api；風險：High
- 候選資料：
  - 保留：KB-0719 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0747 / web_faq_api / 優惠券兌換問題 / High

### 37. 已使用退點機制

- 重複筆數：2
- 建議保留：KB-0710
- 原因：優先來源：web_faq_api；風險：High
- 候選資料：
  - 保留：KB-0710 / web_faq_api / 優惠券兌換問題 / High
  - 檢查：KB-0733 / web_faq_api / 優惠券兌換問題 / High

### 38. 什麼是紀念幣？

- 重複筆數：2
- 建議保留：KB-0033
- 原因：優先來源：official_faq；風險：High
- 候選資料：
  - 保留：KB-0033 / official_faq / 官網常見問題 / High
  - 檢查：KB-0631 / agent_reply_bank / 官網 / High

### 39. 手機驗證碼無效

- 重複筆數：2
- 建議保留：KB-0788
- 原因：優先來源：web_faq_api；風險：Medium
- 候選資料：
  - 檢查：KB-0439 / agent_reply_bank / APP2.0 / Medium
  - 保留：KB-0788 / web_faq_api / APP2.0 / Medium

### 40. 台塑生醫商城100元現金抵用券

- 重複筆數：2
- 建議保留：KB-0694
- 原因：優先來源：web_faq_api；風險：High
- 候選資料：
  - 檢查：KB-0492 / agent_reply_bank / 優惠券兌換問題 / High
  - 保留：KB-0694 / web_faq_api / 優惠券兌換問題 / High

## 待確認衝突

### 1. 未命名衝突

- 狀態：pending_review
- 說明：點數效期
- 建議：由主管或官方來源決定權威答案，再移除或合併矛盾來源。

### 2. 未命名衝突

- 狀態：pending_review
- 說明：App 版本
- 建議：由主管或官方來源決定權威答案，再移除或合併矛盾來源。

### 3. 未命名衝突

- 狀態：pending_review
- 說明：客服服務時間
- 建議：由主管或官方來源決定權威答案，再移除或合併矛盾來源。

### 4. 未命名衝突

- 狀態：pending_review
- 說明：收瓶機允收品項
- 建議：由主管或官方來源決定權威答案，再移除或合併矛盾來源。

### 5. 未命名衝突

- 狀態：pending_review
- 說明：內部資料對外揭露
- 建議：由主管或官方來源決定權威答案，再移除或合併矛盾來源。

## 完整 JSON

完整稽核結果請見：

```text
data/knowledge-quality-audit.json
```
