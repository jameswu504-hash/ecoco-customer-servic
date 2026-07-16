// Integration/unit tests for services/report.service.js (currently zero coverage).
// Pure functions only -> no external services, no mocks required.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REPORT_CATEGORIES,
  buildOperationsReportMarkdown,
  classifyQuestion,
  getReportRange,
  makePreview,
} = require('../services/report.service');

test('getReportRange week window is the last 7 days', () => {
  const { period, start, end } = getReportRange('week');
  assert.equal(period, 'week');
  assert.ok(start <= end);
  const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000));
  assert.equal(diffDays, 7);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
});

test('getReportRange month window starts on the first of the month', () => {
  const { period, start } = getReportRange('month');
  assert.equal(period, 'month');
  assert.equal(start.getDate(), 1);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
});

test('getReportRange defaults to week for unknown period', () => {
  assert.equal(getReportRange('bogus').period, 'week');
  assert.equal(getReportRange().period, 'week');
});

test('classifyQuestion maps greetings to the invalid-message bucket', () => {
  assert.equal(classifyQuestion('hi'), '問候 / 無效訊息');
  assert.equal(classifyQuestion('你好'), '問候 / 無效訊息');
  assert.equal(classifyQuestion(''), '問候 / 無效訊息');
  assert.equal(classifyQuestion('ab'), '問候 / 無效訊息');
});

test('classifyQuestion maps known keywords to report categories', () => {
  assert.equal(classifyQuestion('我的點數沒有入帳'), '點數問題');
  assert.equal(classifyQuestion('機台故障卡住了'), '機台異常');
  assert.equal(classifyQuestion('附近的回收站點在哪'), '站點 / 地點');
  assert.equal(classifyQuestion('App 登入失敗'), 'APP / 帳號問題');
});

test('classifyQuestion falls back to 其他 for unrecognized content', () => {
  assert.equal(classifyQuestion('zzqqxx 隨機字串沒有關鍵詞'), '其他');
});

test('makePreview truncates long text with an ellipsis', () => {
  const long = 'x'.repeat(100);
  const preview = makePreview(long, 80);
  assert.equal(preview.length, 83);
  assert.ok(preview.endsWith('...'));
  assert.equal(preview.startsWith('x'.repeat(80)), true);
});

test('makePreview returns short text unchanged', () => {
  assert.equal(makePreview('short text'), 'short text');
  assert.equal(makePreview('   padded   '), 'padded');
});

test('buildOperationsReportMarkdown renders all report sections', () => {
  const markdown = buildOperationsReportMarkdown({
    range: { period: 'week', startDate: '2026-07-10', endDate: '2026-07-16' },
    summary: {
      sessions: 10,
      userMessages: 20,
      aiReplies: 18,
      totalMessages: 38,
      knowledgeGaps: 3,
      resolvedGaps: 1,
      manualGaps: 2,
      positiveRatings: 5,
      negativeRatings: 2,
      satisfactionRate: 71,
    },
    categories: [
      { category: '點數問題', count: 5 },
      { category: '機台異常', count: 2 },
    ],
    gapStatuses: [
      { statusLabel: '待處理', count: 2 },
      { statusLabel: '已解決', count: 1 },
    ],
    optimizations: [
      { label: '同步知識', count: 1, unit: '次' },
    ],
    knowledge: {
      dbSections: 30,
      ragChunks: 120,
      archivedDuplicates: 4,
      conflictsPendingReview: 1,
    },
  });

  assert.match(markdown, /# ECOCO AI 客服週報/);
  assert.match(markdown, /期間：2026-07-10 至 2026-07-16/);
  assert.match(markdown, /客服案件：10 件/);
  assert.match(markdown, /使用者訊息：20 則/);
  assert.match(markdown, /AI 回覆：18 則/);
  assert.match(markdown, /1\. 點數問題：5 則/);
  assert.match(markdown, /2\. 機台異常：2 則/);
  assert.match(markdown, /知識缺口：3 則/);
  assert.match(markdown, /評分滿意度：71%/);
  assert.match(markdown, /RAG chunks：120 筆/);
  assert.match(markdown, /- 待處理：2 則/);
  assert.match(markdown, /- 同步知識：1 次/);
});

test('buildOperationsReportMarkdown uses month label and empty-state fallbacks', () => {
  const markdown = buildOperationsReportMarkdown({
    range: { period: 'month', startDate: '2026-07-01', endDate: '2026-07-31' },
    summary: {
      sessions: 0, userMessages: 0, aiReplies: 0, totalMessages: 0,
      knowledgeGaps: 0, resolvedGaps: 0, manualGaps: 0,
      positiveRatings: 0, negativeRatings: 0, satisfactionRate: 0,
    },
    categories: [],
    gapStatuses: [],
    optimizations: [],
    knowledge: {
      dbSections: 0, ragChunks: 0, archivedDuplicates: 0, conflictsPendingReview: 0,
    },
  });

  assert.match(markdown, /# ECOCO AI 客服月報/);
  assert.match(markdown, /目前沒有分類資料/);
  assert.match(markdown, /目前沒有知識缺口/);
  assert.match(markdown, /目前沒有改善紀錄/);
});

test('REPORT_CATEGORIES is a non-empty classification table', () => {
  assert.ok(Array.isArray(REPORT_CATEGORIES));
  assert.ok(REPORT_CATEGORIES.length >= 5);
  assert.ok(REPORT_CATEGORIES.every(c => c.name && Array.isArray(c.keywords)));
});
