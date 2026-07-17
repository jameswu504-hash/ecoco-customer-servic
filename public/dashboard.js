// ── XSS 防護：跳脫 HTML 特殊字元 ─────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Admin Key 管理 ────────────────────────────────────────
function getAdminKey() { return sessionStorage.getItem('adminKey') || ''; }

const LOAD_TIMEOUT_MS = 15000;
const SECTION_LOADERS = {};

async function adminFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-admin-key': getAdminKey() },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? '連線逾時（15 秒），伺服器可能正在喚醒' : '網路連線失敗');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    showLogin();
    throw new Error('需要重新登入');
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // 非 JSON 回應會在非 2xx 時轉成可讀錯誤；2xx 則回傳 null。
  }
  if (!res.ok) {
    throw new Error((payload && payload.error) || `伺服器錯誤（HTTP ${res.status}）`);
  }
  return payload;
}

function renderLoading(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '<div class="loading">載入中...</div>';
}

function renderLoadError(id, err) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div class="load-error">
      <span>⚠️ 載入失敗：${escapeHtml(err.message)}</span>
      <button class="retry-btn" type="button" data-retry-target="${escapeHtml(id)}">重試</button>
    </div>`;
}

async function safeLoad(targetIds, loader) {
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
  ids.forEach(id => {
    SECTION_LOADERS[id] = () => {
      ids.forEach(renderLoading);
      return safeLoad(ids, loader);
    };
  });
  try {
    await loader();
  } catch (err) {
    ids.forEach(id => renderLoadError(id, err));
    console.error(`[dashboard] ${ids.join(', ')} 載入失敗:`, err);
  }
}

function widthClass(value) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return `w-${percent}`;
}

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.hidden = Boolean(hidden);
}

// ── 登入 Modal ────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('adminKeyInput').value = '';
  document.getElementById('loginError').textContent = '';
}

async function submitLogin() {
  const key = document.getElementById('adminKeyInput').value.trim();
  if (!key) return;

  const res = await fetch('/api/stats', { headers: { 'x-admin-key': key } });
  if (res.status === 401) {
    document.getElementById('loginError').textContent = 'Admin Key 錯誤，請重新輸入';
    return;
  }
  sessionStorage.setItem('adminKey', key);
  document.getElementById('loginModal').classList.add('hidden');
  loadAll();
}

async function loadAll() {
  await Promise.allSettled([
    loadSystemStatus(),
    safeLoad(['supportWorkbench', 'statsGrid', 'ratingChart'], loadStats),
    safeLoad('operationsReport', () => loadOperationsReport(reportPeriod)),
    safeLoad('knowledgeOverview', loadKnowledgeOverview),
    safeLoad('keywordList', loadKeywords),
    safeLoad('sessionsList', loadSessions),
    safeLoad('unansweredList', loadUnanswered),
    safeLoad('ratingDetailList', loadRatingDetails),
    safeLoad('kbSidebar', loadKnowledge),
  ]);
  showDashboardLayer(currentLayer);
}

let reportPeriod = 'week';
let currentReport = null;
let currentLayer = 'daily';

async function loadSystemStatus() {
  const el = document.getElementById('systemStatus');
  if (!el) return;
  el.classList.remove('error');
  el.textContent = 'AI 模型：讀取中...';
  try {
    const data = await adminFetch('/api/system/status');
    const model = data.anthropicModel || data.defaultAnthropicModel || '未設定';
    el.textContent = `AI 模型：${model}`;
  } catch (err) {
    el.classList.add('error');
    el.textContent = 'AI 模型：讀取失敗';
    console.error('[dashboard] system status load failed:', err);
  }
}

function showDashboardLayer(layer) {
  currentLayer = ['daily', 'knowledge', 'report'].includes(layer) ? layer : 'daily';
  const notes = {
    daily: '日常層只放客服需要處理的待辦與對話。',
    knowledge: '維護層用來整理知識庫、下載 JSON 備份與檢查資料來源。',
    report: '報表層給主管或總經理室看客服量、分類與改善摘要。',
  };
  document.querySelectorAll('.dashboard-layer').forEach(el => {
    el.classList.toggle('hidden', !el.classList.contains(`layer-${currentLayer}`));
  });
  document.getElementById('layerDailyBtn').classList.toggle('active', currentLayer === 'daily');
  document.getElementById('layerKnowledgeBtn').classList.toggle('active', currentLayer === 'knowledge');
  document.getElementById('layerReportBtn').classList.toggle('active', currentLayer === 'report');
  document.getElementById('layerNote').textContent = notes[currentLayer];
}

function switchLayerAndScroll(layer, targetId) {
  showDashboardLayer(layer);
  requestAnimationFrame(() => {
    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return false;
}

async function loadOperationsReport(period = 'week') {
  reportPeriod = period === 'month' ? 'month' : 'week';
  document.getElementById('reportWeekBtn').classList.toggle('active', reportPeriod === 'week');
  document.getElementById('reportMonthBtn').classList.toggle('active', reportPeriod === 'month');
  const data = await adminFetch(`/api/reports/operations?period=${reportPeriod}`);
  if (!data || typeof data !== 'object') throw new Error('營運報表資料格式異常');
  currentReport = data;
  renderOperationsReport(data);
}

function renderOperationsReport(data) {
  const summary = data.summary || {};
  const knowledge = data.knowledge || {};
  const categories = renderReportDetailRows(
    (data.categories || []).slice(0, 8).map(item => ({
      label: item.category,
      count: item.count,
      unit: '則',
      samples: item.samples || [],
    }))
  );
  const optimizationRows = renderReportDetailRows(data.optimizations || []);
  const gapStatuses = renderReportDetailRows(
    (data.gapStatuses || []).map(item => ({
      label: item.statusLabel || item.status,
      count: item.count,
      unit: '則',
      samples: item.samples || [],
    }))
  );

  document.getElementById('operationsReport').innerHTML = `
    <div class="report-note">
      期間：${escapeHtml(data.range?.startDate || '')} 至 ${escapeHtml(data.range?.endDate || '')}
    </div>
    <div class="report-grid">
      <div class="report-metric">
        <div class="report-value">${summary.sessions ?? 0}</div>
        <div class="report-label">客服案件</div>
      </div>
      <div class="report-metric">
        <div class="report-value">${summary.userMessages ?? 0}</div>
        <div class="report-label">用戶訊息</div>
      </div>
      <div class="report-metric">
        <div class="report-value">${summary.aiReplies ?? 0}</div>
        <div class="report-label">AI 回覆</div>
      </div>
      <div class="report-metric">
        <div class="report-value">${summary.knowledgeGaps ?? 0}</div>
        <div class="report-label">知識缺口</div>
      </div>
      <div class="report-metric">
        <div class="report-value">${summary.satisfactionRate ?? 0}%</div>
        <div class="report-label">評分滿意度</div>
      </div>
      <div class="report-metric">
        <div class="report-value">${knowledge.activeDuplicateGroups ?? 0}</div>
        <div class="report-label">active 重複問題</div>
      </div>
    </div>
    <div class="report-columns">
      <div>
        <div class="section-title compact">問題分類</div>
        <div class="report-list">${categories || '<div class="empty-state">本期尚無用戶問題</div>'}</div>
      </div>
      <div>
        <div class="section-title compact">處理與優化</div>
        <div class="report-list">
          ${optimizationRows || '<div class="empty-state">本期尚無優化明細</div>'}
          ${gapStatuses ? `<div class="section-gap-top">${gapStatuses}</div>` : ''}
        </div>
      </div>
    </div>
    <textarea class="report-textarea" id="reportMarkdown" spellcheck="false">${escapeHtml(data.reportMarkdown || '')}</textarea>
  `;
}

function renderReportDetailRows(rows) {
  return rows.map(item => `
    <details class="report-detail">
      <summary>
        <strong>${escapeHtml(item.label || item.category || '未分類')}</strong>
        <span>${item.count ?? 0} ${escapeHtml(item.unit || '則')}</span>
      </summary>
      <div class="report-samples">
        ${renderReportSamples(item.samples || [])}
      </div>
    </details>
  `).join('');
}

function renderReportSamples(samples) {
  if (!samples.length) {
    return '<div class="report-sample">目前沒有可展開的明細。</div>';
  }
  return samples.map(sample => `
    <div class="report-sample">
      <div>${escapeHtml(sample.preview || sample.question || '（無內容）')}</div>
      ${sample.note ? `<div class="report-sample-note">${escapeHtml(sample.note)}</div>` : ''}
      ${sample.priority ? `<div class="report-sample-note">優先級：${escapeHtml(sample.priority)}</div>` : ''}
    </div>
  `).join('');
}

async function copyReportMarkdown() {
  const text = currentReport?.reportMarkdown || document.getElementById('reportMarkdown')?.value || '';
  if (!text) return;
  await navigator.clipboard.writeText(text);
  alert('已複製報表 Markdown');
}

function downloadReportMarkdown() {
  const text = currentReport?.reportMarkdown || document.getElementById('reportMarkdown')?.value || '';
  if (!text) return;
  const label = reportPeriod === 'month' ? 'monthly' : 'weekly';
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ecoco-ai-customer-service-${label}-report.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── 知識庫分類管理 ────────────────────────────────────────
let kbSections = [];     // 目前所有分類
let kbCurrentId = null;  // 正在編輯的 id（null = 新增中尚未存）
let kbRawRenderTimer = null;
let kbCurrentItemIndex = 0;
let kbSyncLock = false;
let kbExpandedSectionIds = new Set();
let kbLastSidebarQuery = '';

async function loadKnowledge() {
  const showArchived = document.getElementById('kbShowArchived')?.checked;
  const data = await adminFetch('/api/knowledge/sections' + (showArchived ? '?include_archived=true' : ''));
  if (!Array.isArray(data)) throw new Error('知識庫資料格式異常');
  kbSections = data;
  const activeCount = data.filter(s => !isArchivedSection(s)).length;
  const archivedCount = data.length - activeCount;
  const knownIds = new Set(data.map(section => Number(section.id)));
  kbExpandedSectionIds = new Set([...kbExpandedSectionIds].filter(id => knownIds.has(id)));
  document.getElementById('kbCount').textContent = showArchived
    ? `（${activeCount} 個使用中，${archivedCount} 個封存）`
    : `（共 ${activeCount} 個分類）`;
  renderKbSidebar();
  updateKbDetail();
}

async function exportKnowledgeJson() {
  const res = await fetch('/api/knowledge/export', {
    headers: { 'x-admin-key': getAdminKey() },
  });
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (!res.ok) {
    alert('知識庫匯出失敗');
    return;
  }

  const payload = await res.json();
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ecoco-knowledge-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function normalizeKbText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function displayCategoryName(value) {
  return String(value || '')
    .replace(/^AI\s*客服知識\s*[：:]\s*/i, '')
    .trim();
}

function isArchivedSection(section) {
  return Boolean(section && String(section.archived_at || '').trim());
}

function getKbSearchQuery() {
  const input = document.getElementById('kbSearch');
  return input ? input.value.trim() : '';
}

function getKbSectionContentForSidebar(section) {
  if (section.id === kbCurrentId) {
    const textarea = document.getElementById('kbContent');
    return textarea ? textarea.value : section.content;
  }
  return section.content || '';
}

function getKbSidebarItems(section, content) {
  const parsed = getKbParserApi().parseKbContent(content || '');
  return getRenderableKbItems(parsed, content);
}

function kbItemMatchesSearch(item, normalizedQuery) {
  if (!normalizedQuery) return true;
  return normalizeKbText(item.heading).includes(normalizedQuery);
}

function getKbSidebarMatch(section, normalizedQuery) {
  const content = getKbSectionContentForSidebar(section);
  const categoryMatch = normalizeKbText(displayCategoryName(section.category)).includes(normalizedQuery);
  const items = getKbSidebarItems(section, content);
  const indexedItems = items.map((item, idx) => ({ item, idx }));
  const matchingItems = normalizedQuery
    ? indexedItems.filter(({ item }) => kbItemMatchesSearch(item, normalizedQuery))
    : indexedItems;
  return {
    categoryMatch,
    items,
    matchingItems,
    matches: !normalizedQuery || categoryMatch || matchingItems.length > 0,
  };
}

function isKbSectionExpanded(sectionId) {
  return kbExpandedSectionIds.has(Number(sectionId));
}

function toggleKbSidebarSection(sectionId) {
  const id = Number(sectionId);
  if (!Number.isInteger(id)) return;
  if (kbExpandedSectionIds.has(id)) {
    kbExpandedSectionIds.delete(id);
  } else {
    kbExpandedSectionIds.add(id);
  }
  renderKbSidebar();
}

function renderKbSidebarItems(section, match) {
  const showItems = isKbSectionExpanded(section.id);
  if (!showItems) return '';
  const query = getKbSearchQuery();
  const items = match?.items || getKbSidebarItems(section, getKbSectionContentForSidebar(section));
  const displayItems = query && !match?.categoryMatch ? (match?.matchingItems || []) : items.map((item, idx) => ({ item, idx }));

  if (section.id === kbCurrentId && kbCurrentItemIndex >= items.length) {
    kbCurrentItemIndex = Math.max(0, items.length - 1);
  }

  if (!displayItems.length) {
    return `
      <div class="kb-sidebar-items empty">
        <div class="kb-sidebar-items-title">問題列表</div>
        <div class="kb-sidebar-empty">${query ? '沒有符合的題目' : '尚無問題'}</div>
      </div>`;
  }

  return `
    <div class="kb-sidebar-items">
      <div class="kb-sidebar-items-title">問題列表（${displayItems.length}${query && displayItems.length !== items.length ? ` / ${items.length}` : ''}）</div>
      ${displayItems.map(({ item, idx }) => `
        <button class="kb-question-btn ${section.id === kbCurrentId && idx === kbCurrentItemIndex ? 'active' : ''}" type="button" data-kb-nav-section-id="${section.id}" data-kb-nav-item-index="${idx}" id="kb-question-${section.id}-${idx}">
          <span class="kb-question-title">${escapeHtml(item.heading || `未命名問題 ${idx + 1}`)}</span>
        </button>
      `).join('')}
    </div>`;
}

function renderKbSidebar() {
  const el = document.getElementById('kbSidebar');
  const hint = document.getElementById('kbSearchHint');
  const query = getKbSearchQuery();
  const normalizedQuery = normalizeKbText(query);
  const sectionMatches = kbSections
    .map(section => ({ section, match: getKbSidebarMatch(section, normalizedQuery) }))
    .filter(({ match }) => match.matches);
  const matchedQuestionCount = sectionMatches.reduce((sum, { match }) => sum + match.matchingItems.length, 0);
  const scrollBox = el.closest('.kb-sidebar');
  const previousScrollTop = scrollBox ? scrollBox.scrollTop : 0;

  if (normalizedQuery && normalizedQuery !== kbLastSidebarQuery) {
    sectionMatches.forEach(({ section }) => kbExpandedSectionIds.add(Number(section.id)));
  }
  kbLastSidebarQuery = normalizedQuery;

  if (hint) {
    hint.textContent = query
      ? `找到 ${sectionMatches.length} 個分類、${matchedQuestionCount} 個題目`
      : '可搜尋分類名稱與題目標題。封存分類不會提供給 AI 使用。';
  }

  if (kbSections.length === 0) {
    el.innerHTML = '<div class="empty-state">尚無分類，按「＋ 新增分類」開始</div>';
    return;
  }
  if (sectionMatches.length === 0) {
    el.innerHTML = '<div class="empty-state">找不到相近分類，可以按「＋ 新增分類」建立</div>';
    return;
  }
  el.innerHTML = sectionMatches.map(({ section, match }) => {
    const expanded = isKbSectionExpanded(section.id);
    return `
    <div class="kb-cat-group ${expanded ? 'open' : ''}">
      <button class="kb-cat-btn ${section.id === kbCurrentId ? 'active' : ''} ${isArchivedSection(section) ? 'archived' : ''}" data-section-id="${section.id}">
        <span class="kb-cat-arrow" data-kb-section-toggle="${section.id}" title="${expanded ? '收合問題列表' : '展開問題列表'}">${expanded ? '⌄' : '›'}</span>
        <span class="kb-cat-name">${escapeHtml(displayCategoryName(section.category))}</span>
        ${isArchivedSection(section) ? '<span class="kb-archive-badge">封存</span>' : ''}
        <span class="kb-cat-size">${section.content.length}字</span>
      </button>
      ${renderKbSidebarItems(section, match)}
    </div>
  `;
  }).join('');
  if (scrollBox) scrollBox.scrollTop = previousScrollTop;
}

function focusKbSidebarItem(index = kbCurrentItemIndex, sectionId = kbCurrentId) {
  requestAnimationFrame(() => {
    const item = document.getElementById(`kb-question-${sectionId}-${index}`);
    if (!item) return;
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    item.classList.add('just-added');
    setTimeout(() => item.classList.remove('just-added'), 1800);
  });
}

function getMatchingCategories(query) {
  const normalizedQuery = normalizeKbText(query);
  if (!normalizedQuery) return [];
  return kbSections
    .filter(s => s.id !== kbCurrentId)
    .filter(s => normalizeKbText(displayCategoryName(s.category)).includes(normalizedQuery))
    .slice(0, 6);
}

function renderCategorySuggestions() {
  const box = document.getElementById('kbCategorySuggestions');
  const input = document.getElementById('kbName');
  if (!box || !input) return;
  const query = input.value.trim();
  const matches = getMatchingCategories(query);
  if (query.length < 1 || matches.length === 0) {
    box.classList.remove('open');
    box.innerHTML = '';
    return;
  }
  box.classList.add('open');
  box.innerHTML = `
    <div class="kb-suggestion-title">已存在相近分類，建議直接開啟原分類編輯，避免重複新增。</div>
    ${matches.map(s => `
      <button class="kb-suggestion-item" type="button" data-suggestion-id="${s.id}">
        <span class="kb-suggestion-name">${escapeHtml(displayCategoryName(s.category))}</span>
        <span class="kb-suggestion-size">${s.content.length}字</span>
      </button>
    `).join('')}
  `;
}

function clearCategorySuggestions() {
  const box = document.getElementById('kbCategorySuggestions');
  if (!box) return;
  box.classList.remove('open');
  box.innerHTML = '';
}

function selectCategorySuggestion(id) {
  selectSection(id);
  clearCategorySuggestions();
}

function showKbForm() {
  setHidden('kbEmpty', true);
  setHidden('kbForm', false);
  document.getElementById('kbMsg').textContent = '';
}

function updateKbDetail() {
  const detail = document.getElementById('kbDetail');
  if (!detail) return;
  const section = kbSections.find(s => s.id === kbCurrentId);
  detail.hidden = !section;
  if (!section) return;
  const content = document.getElementById('kbContent').value;
  document.getElementById('kbDetailChars').textContent = `${content.length.toLocaleString()} 字`;
  document.getElementById('kbDetailUpdated').textContent = section.updated_at || '–';
  document.getElementById('kbDetailArchived').hidden = !isArchivedSection(section);
  const items = countKbItems(content);
  document.getElementById('kbDetailItems').textContent = items > 0 ? `${items} 筆` : '未分題';
}

function getKbParserApi() {
  return window.KbParser;
}

function parseCurrentKbContent() {
  return getKbParserApi().parseKbContent(document.getElementById('kbContent').value);
}

function countKbItems(content) {
  const parsed = getKbParserApi().parseKbContent(content);
  return parsed.items.length || (String(content || '').trim() ? 1 : 0);
}

function getKbItemBody(raw) {
  const match = String(raw || '').match(/^###\s.*?(\r\n|\n|$)/);
  return match ? String(raw || '').slice(match[0].length) : '';
}

function detectKbLineEnding(text) {
  const match = String(text || '').match(/\r\n|\n/);
  return match ? match[0] : '\n';
}

function getKbHeadingLineEnding(raw, fallbackText) {
  const match = String(raw || '').match(/^###\s.*?(\r\n|\n)/);
  return match ? match[1] : detectKbLineEnding(fallbackText);
}

const KB_CREATED_AT_RE = /^\s*<!--\s*created_at:\s*([^>]+?)\s*-->\s*/i;

function getKbItemMetadata(raw) {
  const body = getKbItemBody(raw);
  const match = body.match(KB_CREATED_AT_RE);
  return {
    createdAt: match ? match[1].trim() : '',
  };
}

function stripKbItemMetadata(body) {
  return String(body || '').replace(KB_CREATED_AT_RE, '');
}

function composeKbItemBody(body, metadata = {}) {
  const cleanBody = stripKbItemMetadata(body).replace(/^\s+/, '');
  const createdAt = String(metadata.createdAt || '').trim();
  if (!createdAt) return cleanBody;
  return `<!-- created_at: ${createdAt} -->\n\n${cleanBody}`.trimEnd();
}

function buildEmptyKbItem() {
  return `### \n\n<!-- created_at: ${new Date().toISOString()} -->\n\n`;
}

function formatKbTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFallbackKbItemTitle() {
  const current = kbSections.find(s => s.id === kbCurrentId);
  return displayCategoryName(current?.category) || document.getElementById('kbName')?.value.trim() || '本分類內容';
}

function getRenderableKbItems(parsed, content) {
  if (parsed.items.length > 0) {
    return parsed.items.map(item => {
      const metadata = getKbItemMetadata(item.raw);
      return {
        heading: item.heading,
        body: stripKbItemMetadata(getKbItemBody(item.raw)),
        createdAt: metadata.createdAt,
        fallback: false,
      };
    });
  }
  if (String(content || '').trim()) {
    return [{
      heading: getFallbackKbItemTitle(),
      body: content,
      fallback: true,
    }];
  }
  return [];
}

function renderKbItems(preserveRawOpen = false) {
  const panel = document.getElementById('kbCurrentItemPanel');
  const rawDetails = document.getElementById('kbRawDetails');
  const textarea = document.getElementById('kbContent');
  if (!panel || !textarea) return;
  const parsed = parseCurrentKbContent();
  const items = getRenderableKbItems(parsed, textarea.value);
  if (items.length === 0) {
    kbCurrentItemIndex = 0;
    panel.innerHTML = '<div class="empty-state kb-items-empty">此分類目前沒有題目，按下方「＋ 新增題目」開始。</div>';
    if (rawDetails) rawDetails.open = true;
    updateKbDetail();
    renderKbSidebar();
    return;
  }
  if (kbCurrentItemIndex >= items.length) {
    kbCurrentItemIndex = Math.max(0, items.length - 1);
  }
  const item = items[kbCurrentItemIndex];
  panel.innerHTML = `
    <div class="kb-current-item ${item.fallback ? 'kb-item-fallback' : ''}">
      <div class="kb-current-item-head">
        <div>
          <div class="kb-current-item-title">${escapeHtml(item.heading || `未命名問題 ${kbCurrentItemIndex + 1}`)}</div>
          <div class="kb-current-item-note">這裡是 AI 會參考的客服回答內容，從左側問題列表切換題目。</div>
          ${item.createdAt ? `<div class="kb-current-item-meta">新增時間：${escapeHtml(formatKbTimestamp(item.createdAt))}</div>` : ''}
        </div>
        <span class="kb-current-item-count">${kbCurrentItemIndex + 1} / ${items.length}</span>
      </div>
      ${item.fallback ? '<div class="kb-item-note">此分類尚未用 ### 分題，先以完整分類內容呈現。</div>' : `
        <label class="kb-label">客服問題標題</label>
        <input class="kb-item-title" data-kb-item-index="${kbCurrentItemIndex}" data-kb-item-field="heading" value="${escapeHtml(item.heading)}" placeholder="例如：點數沒有入帳怎麼辦？" />
      `}
      <label class="kb-label">AI 可參考的回答內容</label>
      <textarea class="kb-item-editor" data-kb-item-index="${kbCurrentItemIndex}" data-kb-item-field="body" ${item.fallback ? 'data-kb-fallback="1"' : ''} spellcheck="false" placeholder="輸入客服希望 AI 參考的回答內容。">${escapeHtml(item.body)}</textarea>
      <div class="kb-item-edit-actions">
        <button class="kb-delete-question-btn" type="button" data-kb-delete-current="1">刪除此題</button>
      </div>
    </div>
  `;
  if (rawDetails && !preserveRawOpen) rawDetails.open = false;
  updateKbDetail();
  renderKbSidebar();
}

function updateKbItemFromField(field) {
  if (kbSyncLock) return;
  const index = Number(field.dataset.kbItemIndex);
  const fieldName = field.dataset.kbItemField;
  if (!Number.isInteger(index)) return;
  const textarea = document.getElementById('kbContent');
  if (field.dataset.kbFallback === '1') {
    kbSyncLock = true;
    textarea.value = field.value;
    kbSyncLock = false;
    kbCharCount();
    renderKbSidebar();
    return;
  }
  const parsed = parseCurrentKbContent();
  const item = parsed.items[index];
  if (!item || !textarea) return;
  const previousRaw = item.raw;
  const metadata = getKbItemMetadata(previousRaw);
  const heading = fieldName === 'heading' ? field.value : item.heading;
  const body = fieldName === 'body' ? field.value : stripKbItemMetadata(getKbItemBody(item.raw));
  const eol = getKbHeadingLineEnding(previousRaw, textarea.value);
  const hadHeadingEol = /^###\s.*?(\r\n|\n)/.test(previousRaw);
  const composedBody = composeKbItemBody(body, metadata);
  item.heading = heading;
  item.raw = `### ${heading}` + (composedBody.length > 0 || hadHeadingEol ? eol : '') + composedBody;
  kbSyncLock = true;
  textarea.value = getKbParserApi().assembleKbContent(parsed);
  kbSyncLock = false;
  kbCharCount();
  if (fieldName === 'heading') renderKbSidebar();
}

function handleRawKbInput() {
  if (kbSyncLock) return;
  kbCharCount();
  clearTimeout(kbRawRenderTimer);
  kbRawRenderTimer = setTimeout(() => renderKbItems(true), 400);
}

function selectSection(id, options = {}) {
  const s = kbSections.find(x => x.id === id);
  if (!s) return;
  const archived = isArchivedSection(s);
  kbCurrentId = id;
  kbCurrentItemIndex = Number.isInteger(options.itemIndex) ? options.itemIndex : 0;
  kbExpandedSectionIds.add(Number(id));
  document.getElementById('kbName').value = displayCategoryName(s.category);
  document.getElementById('kbContent').value = s.content;
  setHidden('kbDelBtn', archived);
  setHidden('kbRestoreBtn', !archived);
  document.getElementById('kbSaveBtn').disabled = archived;
  showKbForm();
  if (archived) {
    document.getElementById('kbMsg').textContent = '這筆已封存，不會提供給 AI 使用；如需修改請先恢復。';
    document.getElementById('kbMsg').className = 'save-msg err';
  }
  kbCharCount();
  renderKbItems();
  clearCategorySuggestions();
}

function newSection() {
  kbCurrentId = null;
  kbCurrentItemIndex = 0;
  document.getElementById('kbName').value = '';
  document.getElementById('kbContent').value = buildEmptyKbItem();
  setHidden('kbDelBtn', true); // 還沒存，不給刪
  setHidden('kbRestoreBtn', true);
  document.getElementById('kbSaveBtn').disabled = false;
  showKbForm();
  kbCharCount();
  renderKbItems();
  renderKbSidebar();
  clearCategorySuggestions();
  document.getElementById('kbName').focus();
}

function kbCharCount() {
  document.getElementById('kbChar').textContent =
    document.getElementById('kbContent').value.length.toLocaleString() + ' 字';
  updateKbDetail();
}

function addKbItem() {
  const textarea = document.getElementById('kbContent');
  if (!textarea) return;
  const content = buildEmptyKbItem();
  textarea.value = textarea.value.trim()
    ? `${textarea.value.trim()}\n\n${content}`
    : content;
  const parsed = parseCurrentKbContent();
  const items = getRenderableKbItems(parsed, textarea.value);
  kbCurrentItemIndex = Math.max(0, items.length - 1);
  kbCharCount();
  renderKbItems();
  focusKbSidebarItem(kbCurrentItemIndex);
  const title = document.querySelector(`[data-kb-item-index="${kbCurrentItemIndex}"][data-kb-item-field="heading"]`);
  if (title) title.focus();
  document.getElementById('kbMsg').textContent = `已新增第 ${kbCurrentItemIndex + 1} 題，請填寫後按「儲存」`;
  document.getElementById('kbMsg').className = 'save-msg ok';
}

function deleteCurrentKbItem() {
  const textarea = document.getElementById('kbContent');
  if (!textarea) return;
  const parsed = parseCurrentKbContent();
  if (parsed.items.length === 0) {
    if (!confirm('確定要清空目前這個分類的內容嗎？')) return;
    textarea.value = '';
  } else {
    const item = parsed.items[kbCurrentItemIndex];
    const label = item?.heading || `第 ${kbCurrentItemIndex + 1} 題`;
    if (!confirm(`確定要刪除「${label}」嗎？\n刪除後請按「儲存」才會生效。`)) return;
    parsed.items.splice(kbCurrentItemIndex, 1);
    textarea.value = getKbParserApi().assembleKbContent(parsed);
  }
  const items = getRenderableKbItems(parseCurrentKbContent(), textarea.value);
  kbCurrentItemIndex = Math.min(kbCurrentItemIndex, Math.max(0, items.length - 1));
  kbCharCount();
  renderKbItems();
  focusKbSidebarItem(kbCurrentItemIndex);
  document.getElementById('kbMsg').textContent = '已刪除此題，請按「儲存」才會生效';
  document.getElementById('kbMsg').className = 'save-msg ok';
}

async function saveSection() {
  const category = document.getElementById('kbName').value.trim();
  const content  = document.getElementById('kbContent').value;
  const msg = document.getElementById('kbMsg');
  const btn = document.getElementById('kbSaveBtn');
  if (!category) { msg.textContent = '❌ 請填分類名稱'; msg.className = 'save-msg err'; return; }
  const current = kbSections.find(s => s.id === kbCurrentId);
  if (isArchivedSection(current)) {
    msg.textContent = '❌ 這筆已封存，如需修改請先恢復使用';
    msg.className = 'save-msg err';
    return;
  }
  const duplicate = kbSections.find(s => !isArchivedSection(s) && s.id !== kbCurrentId && normalizeKbText(displayCategoryName(s.category)) === normalizeKbText(category));
  if (duplicate) {
    msg.textContent = '❌ 已有同名分類，請開啟原分類編輯，避免資料重複';
    msg.className = 'save-msg err';
    return;
  }

  btn.disabled = true; btn.textContent = '儲存中...'; msg.textContent = '';
  try {
    const isNew = (kbCurrentId == null);
    const url   = isNew ? '/api/knowledge/sections' : '/api/knowledge/sections/' + kbCurrentId;
    const res = await fetch(url, {
      method:  isNew ? 'POST' : 'PUT',
      headers: { 'x-admin-key': getAdminKey(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ category, content }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '儲存失敗');
    if (isNew) kbCurrentId = body.id;
    msg.textContent = '✅ 已儲存，AI 立即生效'; msg.className = 'save-msg ok';
    await loadKnowledge();
    setHidden('kbDelBtn', false);
    setHidden('kbRestoreBtn', true);
    renderKbSidebar();
    updateKbDetail();
  } catch (e) {
    msg.textContent = '❌ ' + e.message; msg.className = 'save-msg err';
  } finally {
    btn.disabled = false; btn.textContent = '💾 儲存';
    setTimeout(() => { msg.textContent = ''; }, 4000);
  }
}

async function deleteSection() {
  if (kbCurrentId == null) return;
  const s = kbSections.find(x => x.id === kbCurrentId);
  if (!confirm(`確定要永久刪除分類「${s ? displayCategoryName(s.category) : ''}」嗎？\n這會刪掉整個分類與左側所有題目，刪除後不能從後台恢復。`)) return;
  const msg = document.getElementById('kbMsg');
  try {
    const res = await fetch('/api/knowledge/sections/' + kbCurrentId + '?permanent=true', {
      method: 'DELETE',
      headers: { 'x-admin-key': getAdminKey() },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '刪除失敗');
    kbCurrentId = null;
    setHidden('kbForm', true);
    setHidden('kbEmpty', false);
    setHidden('kbDetail', true);
    await loadKnowledge();
  } catch (e) {
    msg.textContent = '❌ ' + e.message; msg.className = 'save-msg err';
  }
}

async function restoreSection() {
  if (kbCurrentId == null) return;
  const s = kbSections.find(x => x.id === kbCurrentId);
  if (!confirm(`確定要恢復分類「${s ? displayCategoryName(s.category) : ''}」嗎？\n恢復後 AI 會重新使用這筆知識。`)) return;
  const msg = document.getElementById('kbMsg');
  try {
    const res = await fetch('/api/knowledge/sections/' + kbCurrentId + '/restore', {
      method: 'PATCH',
      headers: { 'x-admin-key': getAdminKey() },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '恢復失敗');
    msg.textContent = '✅ 已恢復，AI 會重新使用這筆知識';
    msg.className = 'save-msg ok';
    await loadKnowledge();
    selectSection(kbCurrentId);
  } catch (e) {
    msg.textContent = '❌ ' + e.message; msg.className = 'save-msg err';
  }
}

// 對話紀錄搜尋
let searchTimer = null;
function handleSearch(val) {
  clearTimeout(searchTimer);
  const hint = document.getElementById('searchHint');
  if (val.trim().length === 0) {
    hint.textContent = '';
    setSessionsToolbarHidden(false);
    sessionPage = 0;
    safeLoad('sessionsList', loadSessions);
    return;
  }
  if (val.trim().length < 2) {
    setSessionsToolbarHidden(true);
    hint.textContent = '請輸入至少 2 個字';
    return;
  }
  setSessionsToolbarHidden(true);
  hint.textContent = '搜尋中...';
  searchTimer = setTimeout(() => runSearch(val.trim()), 400);
}

async function runSearch(q) {
  const hint = document.getElementById('searchHint');
  try {
    const data = await adminFetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!Array.isArray(data)) throw new Error('對話資料格式異常');
    hint.textContent = `找到 ${data.length} 筆對話`;
    renderSessions(data);
  } catch (err) {
    hint.textContent = `搜尋失敗：${err.message}`;
  }
}

function renderSupportWorkbench(data, satisfactionRate) {
  const unanswered = data.unansweredCount ?? 0;
  document.getElementById('supportWorkbench').innerHTML = `
    <a class="support-card" href="#reportSection" data-layer="report" data-scroll-target="reportSection">
      <strong>1. 先看營運報表</strong>
      <span><b>${data.totalSessions ?? 0}</b> 筆客服案件，滿意度 ${satisfactionRate}% 。可複製週報或月報給主管。</span>
    </a>
    <a class="support-card" href="#unansweredSection" data-layer="daily" data-scroll-target="unansweredSection">
      <strong>2. 處理 AI 不確定問題</strong>
      <span><b>${unanswered}</b> 筆待辦。能補知識就補，處理後改狀態，必要時再刪除。</span>
    </a>
    <a class="support-card" href="#knowledgeSection" data-layer="knowledge" data-scroll-target="knowledgeSection">
      <strong>3. 補充客服知識</strong>
      <span>用分類搜尋舊資料，新增前先確認是否已有相近分類，避免重複。</span>
    </a>
    <a class="support-card" href="#sessionsSection" data-layer="daily" data-scroll-target="sessionsSection">
      <strong>4. 查詢對話紀錄</strong>
      <span>回頭看使用者原話與 AI 回覆，找出常見問題或回答品質問題。</span>
    </a>
  `;
}

// 統計卡片 + 滿意度圖表
async function loadStats() {
  const data = await adminFetch('/api/stats');
  if (!data || typeof data !== 'object') throw new Error('統計資料格式異常');
  const total = data.positiveRatings + data.negativeRatings;
  const satisfactionRate = total > 0 ? Math.round(data.positiveRatings / total * 100) : 0;
  renderSupportWorkbench(data, satisfactionRate);

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">💬</div>
      <div class="stat-num">${data.totalSessions}</div>
      <div class="stat-label">總對話次數</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📨</div>
      <div class="stat-num">${data.totalMessages}</div>
      <div class="stat-label">總訊息數</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">👍</div>
      <div class="stat-num">${satisfactionRate}%</div>
      <div class="stat-label">回答滿意率</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📊</div>
      <div class="stat-num">${total}</div>
      <div class="stat-label">收到評分數</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">❓</div>
      <div class="stat-num alert">${data.unansweredCount ?? 0}</div>
      <div class="stat-label">知識缺口數</div>
    </div>
  `;

  const pos = data.positiveRatings;
  const neg = data.negativeRatings;
  const posWidth = total > 0 ? Math.round(pos / total * 100) : 0;
  const negWidth = total > 0 ? Math.round(neg / total * 100) : 0;

  document.getElementById('ratingChart').innerHTML = `
    <div class="rating-summary">
      共收到 <strong>${total}</strong> 筆評分
    </div>
    <div class="rating-bar-wrap">
      <span class="rating-label">👍 有幫助</span>
      <div class="rating-track">
        <div class="rating-fill positive ${widthClass(posWidth)}"></div>
      </div>
      <span class="rating-pct">${pos} 筆</span>
    </div>
    <div class="rating-bar-wrap">
      <span class="rating-label">👎 沒幫助</span>
      <div class="rating-track">
        <div class="rating-fill negative ${widthClass(negWidth)}"></div>
      </div>
      <span class="rating-pct">${neg} 筆</span>
    </div>
    <div class="rating-footnote">
      滿意率：<strong class="rating-rate">${posWidth}%</strong>
    </div>
  `;
}

async function loadKnowledgeOverview() {
  const data = await adminFetch('/api/knowledge/overview');
  if (!data || typeof data !== 'object') throw new Error('知識庫總覽資料格式異常');
  const counts = data.counts || {};
  const sourceItems = (data.sourceDocuments || []).slice(0, 5).map(source => `
    <div class="source-item">
      <div class="source-title">${escapeHtml(source.source_name || '未命名來源')}</div>
      <div class="source-meta">${escapeHtml(source.role || '未提供用途')}</div>
      <div class="source-meta">AI 用途：${escapeHtml(source.recommended_ai_use || '未標記')}</div>
      ${source.caution ? `<div class="source-meta">注意：${escapeHtml(source.caution)}</div>` : ''}
    </div>
  `).join('');

  const categoryItems = (data.topCategories || []).slice(0, 6).map(([name, count]) => `
    <div class="category-item">
      <div class="category-title">${escapeHtml(displayCategoryName(name))}</div>
      <div class="category-meta">${count} 筆資料</div>
    </div>
  `).join('');

  document.getElementById('knowledgeOverview').innerHTML = `
    <div class="overview-grid">
      <div class="overview-metric">
        <div class="overview-value">${data.dbSectionCount ?? 0}</div>
        <div class="overview-label">PostgreSQL 知識分類</div>
      </div>
      <div class="overview-metric">
        <div class="overview-value">${data.importSectionCount ?? 0}</div>
        <div class="overview-label">Git 匯入分類</div>
      </div>
      <div class="overview-metric">
        <div class="overview-value">${data.ragChunkCount ?? 0}</div>
        <div class="overview-label">RAG 檢索片段</div>
      </div>
      <div class="overview-metric">
        <div class="overview-value">${counts.knowledge_rows ?? 0}</div>
        <div class="overview-label">整理後知識筆數</div>
      </div>
      <div class="overview-metric">
        <div class="overview-value">${counts.conflicts ?? 0}</div>
        <div class="overview-label">待確認衝突</div>
      </div>
    </div>
    <details class="overview-details">
      <summary>查看資料來源與主要分類</summary>
      <div class="overview-note">
        產生時間：${escapeHtml(data.generatedAt || '未提供')}｜模型：${escapeHtml(data.model || '未設定')}｜資料庫最後更新：${escapeHtml(data.latestDbUpdate || '尚無紀錄')}｜同步模式：${escapeHtml(data.effectiveAutoSyncMode || data.autoSyncMode || 'disable')}
      </div>
      <div class="overview-columns">
        <div>
          <div class="section-title compact">資料來源</div>
          <div class="source-list">${sourceItems || '<div class="empty-state compact-empty">尚無資料來源摘要</div>'}</div>
        </div>
        <div>
          <div class="section-title compact">主要分類</div>
          <div class="category-list">${categoryItems || '<div class="empty-state compact-empty">尚無分類摘要</div>'}</div>
        </div>
      </div>
    </details>
  `;
}

// 關鍵字排行
async function loadKeywords() {
  const data = await adminFetch('/api/top-questions');
  if (!Array.isArray(data)) throw new Error('熱門關鍵字資料格式異常');
  if (data.length === 0) {
    document.getElementById('keywordList').innerHTML = '<div class="empty-state">尚無資料，開始對話後會顯示統計</div>';
    return;
  }
  const max = data[0]?.count || 1;
  document.getElementById('keywordList').innerHTML = data.slice(0, 8).map((item, i) => `
      <div class="keyword-item">
        <div class="keyword-rank ${i < 3 ? 'top3' : ''}">${i + 1}</div>
      <div class="keyword-name">${escapeHtml(item.keyword)}</div>
      <div class="keyword-bar-wrap">
        <div class="keyword-bar ${widthClass(item.count / max * 100)}"></div>
      </div>
      <div class="keyword-count">${item.count}</div>
    </div>
  `).join('');
}

// 評分明細
let ratingItems = [];
let ratingPage = 0;
let ratingPageSize = 10;

async function loadRatingDetails() {
  const data = await adminFetch('/api/ratings');
  if (!Array.isArray(data)) throw new Error('評分明細資料格式異常');
  ratingItems = data;
  ratingPage = 0;
  renderRatingDetails();
}

function renderRatingDetails() {
  const toolbar = document.getElementById('ratingToolbar');
  if (toolbar) toolbar.hidden = ratingItems.length === 0;
  if (ratingItems.length === 0) {
    document.getElementById('ratingDetailList').innerHTML =
      '<div class="empty-state">尚無評分紀錄。請到客服介面對話並按評分按鈕，內容就會出現在這裡 👆</div>';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(ratingItems.length / ratingPageSize));
  ratingPage = Math.min(ratingPage, totalPages - 1);
  const pageItems = ratingItems.slice(ratingPage * ratingPageSize, ratingPage * ratingPageSize + ratingPageSize);
  document.getElementById('ratingPageInfo').textContent = `${ratingPage + 1} / ${totalPages}`;
  document.getElementById('ratingPrevBtn').disabled = ratingPage <= 0;
  document.getElementById('ratingNextBtn').disabled = ratingPage >= totalPages - 1;
  document.getElementById('ratingDetailList').innerHTML = pageItems.map(item => {
    const date = new Date(item.timestamp).toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    const badge = item.type === 'positive' ? '👍' : '👎';
    const q = item.question ? escapeHtml(item.question.substring(0, 80)) + (item.question.length > 80 ? '…' : '') : '（無紀錄）';
    const a = item.reply   ? escapeHtml(item.reply.substring(0, 100))   + (item.reply.length   > 100 ? '…' : '') : '（無紀錄）';
    return `
      <div class="rating-detail-item">
        <div class="rating-badge">${badge}</div>
        <div class="rating-detail-body">
          <div class="rating-detail-q">用戶問：${q}</div>
          <div class="rating-detail-a">AI 答：${a}</div>
        </div>
        <div class="rating-detail-time">${date}</div>
      </div>
    `;
  }).join('');
}

// 知識缺口列表
let unansweredItems = [];
let gapPage = 0;
let gapPageSize = 5;
const GAP_STATUS_LABELS = {
  pending: '待處理',
  resolved: '已補知識',
  manual: '需人工處理',
  ignored: '不需處理',
};

async function loadUnanswered() {
  unansweredItems = await adminFetch('/api/unanswered');
  if (!Array.isArray(unansweredItems)) throw new Error('知識缺口資料格式異常');
  renderUnansweredList();
}

function renderUnansweredList() {
  const filter = document.getElementById('gapFilter')?.value || 'pending';
  const data = filter === 'all'
    ? unansweredItems
    : unansweredItems.filter(item => (item.status || 'pending') === filter);

  if (unansweredItems.length === 0) {
    document.getElementById('unansweredList').innerHTML =
      '<div class="empty-state">目前沒有客服待辦。若 AI 遇到不確定問題，會自動出現在這裡。</div>';
    document.getElementById('gapPageInfo').textContent = '0 / 0';
    document.getElementById('gapPrevBtn').disabled = true;
    document.getElementById('gapNextBtn').disabled = true;
    return;
  }
  if (data.length === 0) {
    document.getElementById('unansweredList').innerHTML =
      '<div class="empty-state">這個狀態目前沒有資料。</div>';
    document.getElementById('gapPageInfo').textContent = '0 / 0';
    document.getElementById('gapPrevBtn').disabled = true;
    document.getElementById('gapNextBtn').disabled = true;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(data.length / gapPageSize));
  gapPage = Math.min(gapPage, totalPages - 1);
  const pageItems = data.slice(gapPage * gapPageSize, gapPage * gapPageSize + gapPageSize);
  document.getElementById('gapPageInfo').textContent = `${gapPage + 1} / ${totalPages}`;
  document.getElementById('gapPrevBtn').disabled = gapPage <= 0;
  document.getElementById('gapNextBtn').disabled = gapPage >= totalPages - 1;
  document.getElementById('unansweredList').innerHTML = pageItems.map((item, idx) => {
    const absoluteIdx = gapPage * gapPageSize + idx;
    const date = new Date(item.timestamp).toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    const reply = item.reply ? escapeHtml(item.reply) : '';
    const reason = item.reason ? escapeHtml(item.reason) : 'AI 回覆表示知識庫沒有明確答案';
    const status = item.status || 'pending';
    const note = item.note || '';
    return `
      <div class="unanswered-item" id="gap-${absoluteIdx}">
        <div class="unanswered-icon">❓</div>
        <div class="unanswered-body">
          <div class="unanswered-q">${escapeHtml(item.question)}</div>
          <div class="gap-status-badge">${escapeHtml(GAP_STATUS_LABELS[status] || status)}</div>
          <div class="unanswered-reason">${reason}</div>
          ${reply ? `
            <div class="unanswered-actions">
              <button class="unanswered-toggle" id="gap-toggle-${absoluteIdx}" type="button" data-gap-index="${absoluteIdx}">查看 AI 回覆</button>
            </div>
            <div class="unanswered-reply">AI 回覆：${reply}</div>
          ` : ''}
          <div class="gap-status-row">
            <select class="gap-select" id="gap-status-${item.id}">
              <option value="pending" ${status === 'pending' ? 'selected' : ''}>待處理</option>
              <option value="resolved" ${status === 'resolved' ? 'selected' : ''}>已補知識</option>
              <option value="manual" ${status === 'manual' ? 'selected' : ''}>需人工處理</option>
              <option value="ignored" ${status === 'ignored' ? 'selected' : ''}>不需處理</option>
            </select>
            <input class="gap-note" id="gap-note-${item.id}" value="${escapeHtml(note)}" placeholder="備註：例如已補到哪個分類" />
            <button class="gap-save" type="button" data-gap-save-id="${item.id}">儲存狀態</button>
          </div>
          <div class="gap-controls">
            <a class="unanswered-toggle" href="#knowledgeSection" data-layer="knowledge" data-scroll-target="knowledgeSection">補到知識庫</a>
            <button class="gap-delete" type="button" data-gap-delete-id="${item.id}">刪除</button>
          </div>
        </div>
        <div class="unanswered-meta">${date}</div>
      </div>
    `;
  }).join('');
}

async function saveGapStatus(id) {
  const status = document.getElementById('gap-status-' + id)?.value || 'pending';
  const note = document.getElementById('gap-note-' + id)?.value || '';
  const res = await fetch('/api/unanswered/' + id, {
    method: 'PATCH',
    headers: { 'x-admin-key': getAdminKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note }),
  });
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (!res.ok) {
    alert('知識缺口狀態儲存失敗');
    return;
  }
  await loadUnanswered();
  await loadStats();
  await loadOperationsReport(reportPeriod);
}

async function deleteGap(id) {
  if (!confirm('確定要刪除這筆知識缺口嗎？\n刪除後不會再出現在後台列表。')) return;

  const res = await fetch('/api/unanswered/' + id, {
    method: 'DELETE',
    headers: { 'x-admin-key': getAdminKey() },
  });
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (!res.ok) {
    alert('知識缺口刪除失敗');
    return;
  }
  await loadUnanswered();
  await loadStats();
}

function toggleGap(idx) {
  const item = document.getElementById('gap-' + idx);
  const button = document.getElementById('gap-toggle-' + idx);
  item.classList.toggle('open');
  button.textContent = item.classList.contains('open') ? '收合 AI 回覆' : '查看 AI 回覆';
}

// 對話紀錄
let sessionPage = 0;
let sessionPageSize = 10;
let sessionTotal = 0;
const sessionMessagesCache = new Map();

function setSessionsToolbarHidden(hidden) {
  const toolbar = document.getElementById('sessionsToolbar');
  if (toolbar) toolbar.hidden = Boolean(hidden);
}

function renderSessions(data) {
  if (data.length === 0) {
    document.getElementById('sessionsList').innerHTML = '<div class="empty-state">找不到相關對話紀錄</div>';
    return;
  }
  document.getElementById('sessionsList').innerHTML = data.map((session, idx) => {
    const sessionId = String(session.session_id || '');
    const startTime = new Date(session.started_at).toLocaleString('zh-TW');
    const msgCount = Math.floor(Number(session.message_count || 0) / 2);
    const hasInline = Array.isArray(session.messages);
    const inner = hasInline ? renderMessages(session.messages) : '<div class="loading">載入中...</div>';

    return `
      <div class="session-item">
        <div class="session-header" data-session-target="sess-${idx}" data-session-index="${idx}"
             data-session-id="${escapeHtml(sessionId)}" data-session-loaded="${hasInline ? '1' : '0'}">
          <span class="session-id">${escapeHtml(sessionId.substring(0, 20))}…</span>
          <span class="session-meta">${startTime}</span>
          <span class="session-count">${msgCount} 問答</span>
          <span class="session-toggle" id="toggle-${idx}">▼</span>
        </div>
        <div class="session-messages" id="sess-${idx}">
          ${inner}
        </div>
      </div>
    `;
  }).join('');
}

function renderMessages(messages) {
  return messages.map(msg => `
    <div class="msg-item">
      <span class="msg-role ${msg.role === 'user' ? 'user' : 'assistant'}">${msg.role === 'user' ? '用戶' : 'AI'}</span>
      <div class="msg-content">${escapeHtml(msg.content)}</div>
      <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' })}</div>
    </div>
  `).join('');
}

async function loadSessions() {
  const offset = sessionPage * sessionPageSize;
  const data = await adminFetch(`/api/sessions?limit=${sessionPageSize}&offset=${offset}`);
  if (!data || !Array.isArray(data.sessions)) throw new Error('對話資料格式異常');
  sessionTotal = Number(data.total || 0);
  if (data.sessions.length === 0 && sessionTotal > 0 && sessionPage > 0) {
    sessionPage = Math.max(0, Math.ceil(sessionTotal / sessionPageSize) - 1);
    return loadSessions();
  }
  if (sessionTotal === 0) {
    document.getElementById('sessionsList').innerHTML = '<div class="empty-state">尚無對話紀錄，對話後會自動出現在這裡</div>';
  } else {
    renderSessions(data.sessions);
  }
  renderSessionPager();
}

function renderSessionPager() {
  const totalPages = Math.max(1, Math.ceil(sessionTotal / sessionPageSize));
  const pageInfo = document.getElementById('pageInfo');
  const prevBtn = document.getElementById('pagePrevBtn');
  const nextBtn = document.getElementById('pageNextBtn');
  if (pageInfo) {
    pageInfo.textContent = `第 ${sessionPage + 1} / ${totalPages} 頁，共 ${sessionTotal} 場對話`;
  }
  if (prevBtn) prevBtn.disabled = sessionPage <= 0;
  if (nextBtn) nextBtn.disabled = sessionPage >= totalPages - 1;
}

function toggleSession(id, idx) {
  const el     = document.getElementById(id);
  const toggle = document.getElementById('toggle-' + idx);
  el.classList.toggle('open');
  toggle.textContent = el.classList.contains('open') ? '▲' : '▼';
}

async function loadSessionMessages(sessionId, targetId) {
  let messages = sessionMessagesCache.get(sessionId);
  if (!messages) {
    messages = await adminFetch(`/api/session-messages?session_id=${encodeURIComponent(sessionId)}`);
    if (!Array.isArray(messages)) throw new Error('對話內容格式異常');
    sessionMessagesCache.set(sessionId, messages);
  }
  const box = document.getElementById(targetId);
  if (box) box.innerHTML = renderMessages(messages);
}

function bindDashboardEvents() {
  const backToTop = document.getElementById('backToTopBtn');
  if (backToTop) {
    let ticking = false;
    const updateBackToTop = () => {
      backToTop.classList.toggle('visible', window.scrollY >= 240);
    };
    updateBackToTop();
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        updateBackToTop();
        ticking = false;
      });
    }, { passive: true });
    backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  document.getElementById('adminKeyInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitLogin();
  });
  document.getElementById('loginBtn')?.addEventListener('click', submitLogin);
  document.getElementById('refreshBtn')?.addEventListener('click', loadAll);

  document.getElementById('layerDailyBtn')?.addEventListener('click', () => showDashboardLayer('daily'));
  document.getElementById('layerKnowledgeBtn')?.addEventListener('click', () => showDashboardLayer('knowledge'));
  document.getElementById('layerReportBtn')?.addEventListener('click', () => showDashboardLayer('report'));

  document.getElementById('reportWeekBtn')?.addEventListener('click', () => safeLoad('operationsReport', () => loadOperationsReport('week')));
  document.getElementById('reportMonthBtn')?.addEventListener('click', () => safeLoad('operationsReport', () => loadOperationsReport('month')));
  document.getElementById('copyReportBtn')?.addEventListener('click', copyReportMarkdown);
  document.getElementById('downloadReportBtn')?.addEventListener('click', downloadReportMarkdown);

  document.getElementById('kbExportBtn')?.addEventListener('click', exportKnowledgeJson);
  document.getElementById('kbNewBtn')?.addEventListener('click', newSection);
  document.getElementById('kbSearch')?.addEventListener('input', renderKbSidebar);
  document.getElementById('kbShowArchived')?.addEventListener('change', () => safeLoad('kbSidebar', loadKnowledge));
  document.getElementById('kbName')?.addEventListener('input', renderCategorySuggestions);
  document.getElementById('kbName')?.addEventListener('focus', renderCategorySuggestions);
  document.getElementById('kbAddItemBtn')?.addEventListener('click', addKbItem);
  document.getElementById('kbContent')?.addEventListener('input', handleRawKbInput);
  document.getElementById('kbCurrentItemPanel')?.addEventListener('input', event => {
    const field = event.target.closest('[data-kb-item-index][data-kb-item-field]');
    if (field) updateKbItemFromField(field);
  });
  document.getElementById('kbRestoreBtn')?.addEventListener('click', restoreSection);
  document.getElementById('kbDelBtn')?.addEventListener('click', deleteSection);
  document.getElementById('kbSaveBtn')?.addEventListener('click', saveSection);

  document.getElementById('ratingPageSizeSelect')?.addEventListener('change', event => {
    ratingPageSize = Number(event.target.value) || 10;
    ratingPage = 0;
    renderRatingDetails();
  });
  document.getElementById('ratingPrevBtn')?.addEventListener('click', () => {
    if (ratingPage > 0) {
      ratingPage -= 1;
      renderRatingDetails();
    }
  });
  document.getElementById('ratingNextBtn')?.addEventListener('click', () => {
    ratingPage += 1;
    renderRatingDetails();
  });

  document.getElementById('gapFilter')?.addEventListener('change', () => {
    gapPage = 0;
    renderUnansweredList();
  });
  document.getElementById('gapPageSizeSelect')?.addEventListener('change', event => {
    gapPageSize = Number(event.target.value) || 5;
    gapPage = 0;
    renderUnansweredList();
  });
  document.getElementById('gapPrevBtn')?.addEventListener('click', () => {
    if (gapPage > 0) {
      gapPage -= 1;
      renderUnansweredList();
    }
  });
  document.getElementById('gapNextBtn')?.addEventListener('click', () => {
    gapPage += 1;
    renderUnansweredList();
  });

  document.getElementById('searchInput')?.addEventListener('input', event => handleSearch(event.currentTarget.value));
  document.getElementById('pageSizeSelect')?.addEventListener('change', event => {
    sessionPageSize = Number(event.target.value) || 10;
    sessionPage = 0;
    safeLoad('sessionsList', loadSessions);
  });
  document.getElementById('pagePrevBtn')?.addEventListener('click', () => {
    if (sessionPage > 0) {
      sessionPage -= 1;
      safeLoad('sessionsList', loadSessions);
    }
  });
  document.getElementById('pageNextBtn')?.addEventListener('click', () => {
    sessionPage += 1;
    safeLoad('sessionsList', loadSessions);
  });

  document.addEventListener('click', event => {
    const retryButton = event.target.closest('[data-retry-target]');
    if (retryButton) {
      SECTION_LOADERS[retryButton.dataset.retryTarget]?.();
      return;
    }

    const kbNavItem = event.target.closest('[data-kb-nav-item-index]');
    if (kbNavItem) {
      const sectionId = Number(kbNavItem.dataset.kbNavSectionId);
      const itemIndex = Number(kbNavItem.dataset.kbNavItemIndex) || 0;
      if (Number.isInteger(sectionId) && sectionId !== kbCurrentId) {
        selectSection(sectionId, { itemIndex });
        return;
      }
      kbCurrentItemIndex = itemIndex;
      renderKbItems();
      return;
    }

    const deleteKbItem = event.target.closest('[data-kb-delete-current]');
    if (deleteKbItem) {
      deleteCurrentKbItem();
      return;
    }

    const kbSectionToggle = event.target.closest('[data-kb-section-toggle]');
    if (kbSectionToggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleKbSidebarSection(kbSectionToggle.dataset.kbSectionToggle);
      return;
    }

    const sectionButton = event.target.closest('[data-section-id]');
    if (sectionButton) {
      selectSection(Number(sectionButton.dataset.sectionId));
      return;
    }

    const suggestionButton = event.target.closest('[data-suggestion-id]');
    if (suggestionButton) {
      selectCategorySuggestion(Number(suggestionButton.dataset.suggestionId));
      return;
    }

    const layerLink = event.target.closest('[data-layer][data-scroll-target]');
    if (layerLink) {
      event.preventDefault();
      switchLayerAndScroll(layerLink.dataset.layer, layerLink.dataset.scrollTarget);
      return;
    }

    const gapToggle = event.target.closest('[data-gap-index]');
    if (gapToggle) {
      toggleGap(Number(gapToggle.dataset.gapIndex));
      return;
    }

    const gapSave = event.target.closest('[data-gap-save-id]');
    if (gapSave) {
      saveGapStatus(Number(gapSave.dataset.gapSaveId));
      return;
    }

    const gapDelete = event.target.closest('[data-gap-delete-id]');
    if (gapDelete) {
      deleteGap(Number(gapDelete.dataset.gapDeleteId));
      return;
    }

    const sessionHeader = event.target.closest('[data-session-target][data-session-index]');
    if (sessionHeader) {
      toggleSession(sessionHeader.dataset.sessionTarget, Number(sessionHeader.dataset.sessionIndex));
      if (sessionHeader.dataset.sessionLoaded === '0') {
        sessionHeader.dataset.sessionLoaded = '1';
        loadSessionMessages(sessionHeader.dataset.sessionId, sessionHeader.dataset.sessionTarget)
          .catch(err => {
            const box = document.getElementById(sessionHeader.dataset.sessionTarget);
            if (box) box.innerHTML = `<div class="load-error"><span>⚠️ ${escapeHtml(err.message)}</span></div>`;
            sessionHeader.dataset.sessionLoaded = '0';
          });
      }
    }
  });
}

// ── 初始化：有 key 就直接載入，沒有就顯示登入畫面 ──────
bindDashboardEvents();
if (getAdminKey()) {
  document.getElementById('loginModal').classList.add('hidden');
  loadAll();
} else {
  showLogin();
}
