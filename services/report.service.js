const REPORT_CATEGORIES = [
  { name: '問候 / 無效訊息', keywords: ['hi', 'hello', '你好', '嗨', '測試', 'test'] },
  { name: '合作商家', keywords: ['合作商家', '商家', '兌換', '優惠券', '漢堡王', '全聯'] },
  { name: '站點 / 地點', keywords: ['站點', '地點', '設點', '新竹', '哪裡', '地址'] },
  { name: '點數問題', keywords: ['點數', '入帳', '補點', '過期', '點數紀錄'] },
  { name: '回收規則', keywords: ['寶特瓶', '鋁罐', '電池', '瓶蓋', '回收', '投瓶'] },
  { name: 'APP / 帳號問題', keywords: ['App', 'APP', '登入', '註冊', '帳號', '手機', '驗證碼'] },
  { name: '機台異常', keywords: ['機台', '故障', '滿倉', '滿袋', '垃圾', '卡住', '異常'] },
  { name: '客訴 / 人工處理', keywords: ['客服', '客訴', '人工', '處理', '申訴'] },
];

function getReportRange(period) {
  const now = new Date();
  const end = now;
  const start = new Date(now);
  const normalized = period === 'month' ? 'month' : 'week';
  if (normalized === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  }
  return { period: normalized, start, end };
}

function classifyQuestion(content) {
  const text = String(content || '');
  const compact = text.replace(/\s+/g, '').toLowerCase();
  if (!compact || ['hi', 'hello', '你好', '嗨', '測試', 'test'].includes(compact) || compact.length <= 2) {
    return '問候 / 無效訊息';
  }
  const matched = REPORT_CATEGORIES.find(category =>
    category.keywords.some(keyword => text.toLowerCase().includes(String(keyword).toLowerCase()))
  );
  return matched ? matched.name : '其他';
}

function makePreview(text, maxLength = 80) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildOperationsReportMarkdown(payload) {
  const title = payload.range.period === 'month' ? '月報' : '週報';
  const categories = payload.categories
    .map((item, index) => `${index + 1}. ${item.category}：${item.count} 則`)
    .join('\n') || '目前沒有分類資料';
  const gaps = payload.gapStatuses
    .map(item => `- ${item.statusLabel}：${item.count} 則`)
    .join('\n') || '- 目前沒有知識缺口';
  const improvements = payload.optimizations
    .map(item => `- ${item.label}：${item.count} ${item.unit}`)
    .join('\n') || '- 目前沒有改善紀錄';

  return `# ECOCO AI 客服${title}

期間：${payload.range.startDate} 至 ${payload.range.endDate}

## 一、客服量總覽
- 客服案件：${payload.summary.sessions} 件
- 使用者訊息：${payload.summary.userMessages} 則
- AI 回覆：${payload.summary.aiReplies} 則
- 總訊息數：${payload.summary.totalMessages} 則

## 二、問題分類
${categories}

## 三、處理與優化
- 知識缺口：${payload.summary.knowledgeGaps} 則
- 已解決知識缺口：${payload.summary.resolvedGaps} 則
- 需人工處理：${payload.summary.manualGaps} 則
- 正向評分：${payload.summary.positiveRatings} 則
- 負向評分：${payload.summary.negativeRatings} 則
- 評分滿意度：${payload.summary.satisfactionRate}%

## 四、知識庫狀態
- PostgreSQL 知識分類：${payload.knowledge.dbSections} 筆
- RAG chunks：${payload.knowledge.ragChunks} 筆
- 已封存重複知識：${payload.knowledge.archivedDuplicates} 筆
- 待確認衝突：${payload.knowledge.conflictsPendingReview} 筆

${improvements}

## 五、知識缺口狀態
${gaps}

## 六、建議
- 優先補齊高頻問題與負向評分相關知識。
- 定期檢查知識缺口，補回知識庫後再刪除待辦。
- 大改版或交接前下載 JSON 並回寫 GitHub。`;
}

module.exports = {
  REPORT_CATEGORIES,
  buildOperationsReportMarkdown,
  classifyQuestion,
  getReportRange,
  makePreview,
};
