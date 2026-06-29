name: 知識庫 AI 分析

on:
  schedule:
    - cron: '20 1 * * 1'   # 每週一 09:20 台灣時間 (UTC+8 → UTC 01:20)
  workflow_dispatch:        # 也允許手動點按執行（測試用）

jobs:
  analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 安裝套件
        working-directory: scripts
        run: npm install

      - name: 執行 AI 分析
        working-directory: scripts
        env:
          ECOCO_BASE_URL: ${{ secrets.ECOCO_BASE_URL }}
          ADMIN_KEY: ${{ secrets.ADMIN_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          MAIL_USER: ${{ secrets.MAIL_USER }}
          MAIL_PASS: ${{ secrets.MAIL_PASS }}
          MAIL_TO: ${{ secrets.MAIL_TO }}
        run: node ai-analysis.mjs
