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

function adminFetch(url) {
  return fetch(url, { headers: { 'x-admin-key': getAdminKey() } })
    .then(res => {
      if (res.status === 401) { showLogin(); throw new Error('401'); }
      return res.json();
    });
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
  await Promise.all([loadStats(), loadOperationsReport(reportPeriod), loadKnowledgeOverview(), loadKeywords(), loadSessions(), loadUnanswered(), loadRatingDetails(), loadKnowledge()]);
  showDashboardLayer(currentLayer);
}

let reportPeriod = 'week';
let currentReport = null;
let currentLayer = 'daily';

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

async function loadKnowledge() {
  const showArchived = document.getElementById('kbShowArchived')?.checked;
  const data = await adminFetch('/api/knowledge/sections' + (showArchived ? '?include_archived=true' : ''));
  kbSections = data;
  const activeCount = data.filter(s => !isArchivedSection(s)).length;
  const archivedCount = data.length - activeCount;
  document.getElementById('kbCount').textContent = showArchived
    ? `（${activeCount} 個使用中，${archivedCount} 個封存）`
    : `（共 ${activeCount} 個分類）`;
  renderKbSidebar();
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

function renderKbSidebar() {
  const el = document.getElementById('kbSidebar');
  const hint = document.getElementById('kbSearchHint');
  const query = getKbSearchQuery();
  const normalizedQuery = normalizeKbText(query);
  const sections = normalizedQuery
    ? kbSections.filter(s =>
        normalizeKbText(displayCategoryName(s.category)).includes(normalizedQuery)
      )
    : kbSections;

  if (hint) {
    hint.textContent = query
      ? `找到 ${sections.length} / ${kbSections.length} 個分類`
      : '搜尋只比對分類名稱，不會搜尋完整內容。封存分類不會提供給 AI 使用。';
  }

  if (kbSections.length === 0) {
    el.innerHTML = '<div class="empty-state">尚無分類，按「＋ 新增分類」開始</div>';
    return;
  }
  if (sections.length === 0) {
    el.innerHTML = '<div class="empty-state">找不到相近分類，可以按「＋ 新增分類」建立</div>';
    return;
  }
  el.innerHTML = sections.map(s => `
    <button class="kb-cat-btn ${s.id === kbCurrentId ? 'active' : ''} ${isArchivedSection(s) ? 'archived' : ''}" data-section-id="${s.id}">
      <span class="kb-cat-name">${escapeHtml(displayCategoryName(s.category))}</span>
      ${isArchivedSection(s) ? '<span class="kb-archive-badge">封存</span>' : ''}
      <span class="kb-cat-size">${s.content.length}字</span>
    </button>
  `).join('');
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

function selectSection(id) {
  const s = kbSections.find(x => x.id === id);
  if (!s) return;
  const archived = isArchivedSection(s);
  kbCurrentId = id;
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
  renderKbSidebar();
  clearCategorySuggestions();
}

function newSection() {
  kbCurrentId = null;
  document.getElementById('kbName').value = '';
  document.getElementById('kbContent').value = '';
  setHidden('kbDelBtn', true); // 還沒存，不給刪
  setHidden('kbRestoreBtn', true);
  document.getElementById('kbSaveBtn').disabled = false;
  showKbForm();
  kbCharCount();
  renderKbSidebar();
  clearCategorySuggestions();
  document.getElementById('kbName').focus();
}

function kbCharCount() {
  document.getElementById('kbChar').textContent =
    document.getElementById('kbContent').value.length.toLocaleString() + ' 字';
}

function getTemplateValue(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function applyKnowledgeTemplate() {
  const title = getTemplateValue('kbTplTitle') || document.getElementById('kbName').value.trim() || '未命名問題';
  const context = getTemplateValue('kbTplContext');
  const reply = getTemplateValue('kbTplReply');
  const collect = getTemplateValue('kbTplCollect');
  const avoid = getTemplateValue('kbTplAvoid');
  const internal = getTemplateValue('kbTplInternal');
  const content = [
    `### ${title}`,
    '',
    context ? `適用情境：\n${formatTemplateLines(context)}` : '',
    reply ? `建議回覆：\n${reply}` : '',
    collect ? `需要收集資訊：\n${formatTemplateLines(collect)}` : '',
    avoid ? `不能承諾事項：\n${formatTemplateLines(avoid)}` : '',
    internal ? `內部備註：\n${internal}` : '',
  ].filter(Boolean).join('\n\n');

  const textarea = document.getElementById('kbContent');
  if (!textarea.value.trim()) {
    textarea.value = content;
  } else {
    textarea.value = `${textarea.value.trim()}\n\n${content}`;
  }
  kbCharCount();
  document.getElementById('kbMsg').textContent = '已產生標準格式，請確認後儲存';
  document.getElementById('kbMsg').className = 'save-msg ok';
}

function formatTemplateLines(value) {
  return value
    .split(/\n|、|，|,/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => `- ${item.replace(/^-+\s*/, '')}`)
    .join('\n');
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
  } catch (e) {
    msg.textContent = '❌ ' + e.message; msg.className = 'save-msg err';
  } finally {
    btn.disabled = false; btn.textContent = '💾 儲存';
    setTimeout(() => { msg.textContent = ''; }, 4000);
  }
}

async function archiveSection() {
  if (kbCurrentId == null) return;
  const s = kbSections.find(x => x.id === kbCurrentId);
  if (!confirm(`確定要封存分類「${s ? displayCategoryName(s.category) : ''}」嗎？\n封存後 AI 不會再使用，但之後可以從「顯示封存分類」恢復。`)) return;
  const msg = document.getElementById('kbMsg');
  try {
    const res = await fetch('/api/knowledge/sections/' + kbCurrentId, {
      method: 'DELETE',
      headers: { 'x-admin-key': getAdminKey() },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '封存失敗');
    kbCurrentId = null;
    setHidden('kbForm', true);
    setHidden('kbEmpty', false);
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
    loadSessions();
    return;
  }
  if (val.trim().length < 2) {
    hint.textContent = '請輸入至少 2 個字';
    return;
  }
  hint.textContent = '搜尋中...';
  searchTimer = setTimeout(() => runSearch(val.trim()), 400);
}

async function runSearch(q) {
  const hint = document.getElementById('searchHint');
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { 'x-admin-key': getAdminKey() } });
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json();
    hint.textContent = `找到 ${data.length} 筆對話`;
    renderSessions(data);
  } catch {
    hint.textContent = '搜尋失敗';
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
  const counts = data.counts || {};
  const sourceItems = (data.sourceDocuments || []).slice(0, 6).map(source => `
    <div class="source-item">
      <div class="source-title">${escapeHtml(source.source_name || '未命名來源')}</div>
      <div class="source-meta">${escapeHtml(source.role || '未提供用途')}</div>
      <div class="source-meta">AI 用途：${escapeHtml(source.recommended_ai_use || '未標記')}</div>
      ${source.caution ? `<div class="source-meta">注意：${escapeHtml(source.caution)}</div>` : ''}
    </div>
  `).join('');

  const categoryItems = (data.topCategories || []).slice(0, 8).map(([name, count]) => `
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
        <div class="overview-value">${counts.templates ?? 0}</div>
        <div class="overview-label">社群回覆範本</div>
      </div>
      <div class="overview-metric">
        <div class="overview-value">${counts.conflicts ?? 0}</div>
        <div class="overview-label">待確認衝突</div>
      </div>
      <div class="overview-metric">
        <div class="overview-value">${escapeHtml(data.effectiveAutoSyncMode || data.autoSyncMode || 'disable')}</div>
        <div class="overview-label">知識同步模式</div>
      </div>
    </div>
    <div class="overview-note">
      產生時間：${escapeHtml(data.generatedAt || '未提供')}｜模型：${escapeHtml(data.model || '未設定')}｜資料庫最後更新：${escapeHtml(data.latestDbUpdate || '尚無紀錄')}
    </div>
    <div class="overview-columns">
      <div>
        <div class="section-title compact">資料來源</div>
        <div class="source-list">${sourceItems || '<div class="empty-state">尚無資料來源摘要</div>'}</div>
      </div>
      <div>
        <div class="section-title compact">主要分類</div>
        <div class="category-list">${categoryItems || '<div class="empty-state">尚無分類摘要</div>'}</div>
      </div>
    </div>
  `;
}

// 關鍵字排行
async function loadKeywords() {
  const data = await adminFetch('/api/top-questions');
  if (data.length === 0) {
    document.getElementById('keywordList').innerHTML = '<div class="empty-state">尚無資料，開始對話後會顯示統計</div>';
    return;
  }
  const max = data[0]?.count || 1;
  document.getElementById('keywordList').innerHTML = data.slice(0, 8).map((item, i) => `
    <div class="keyword-item">
      <div class="keyword-rank ${i < 3 ? 'top3' : ''}">${i + 1}</div>
      <div class="keyword-name">${item.keyword}</div>
      <div class="keyword-bar-wrap">
        <div class="keyword-bar ${widthClass(item.count / max * 100)}"></div>
      </div>
      <div class="keyword-count">${item.count}</div>
    </div>
  `).join('');
}

// 評分明細
async function loadRatingDetails() {
  const data = await adminFetch('/api/ratings');
  if (data.length === 0) {
    document.getElementById('ratingDetailList').innerHTML =
      '<div class="empty-state">尚無評分紀錄。請到客服介面對話並按評分按鈕，內容就會出現在這裡 👆</div>';
    return;
  }
  document.getElementById('ratingDetailList').innerHTML = data.map(item => {
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
const GAP_STATUS_LABELS = {
  pending: '待處理',
  resolved: '已補知識',
  manual: '需人工處理',
  ignored: '不需處理',
};

async function loadUnanswered() {
  unansweredItems = await adminFetch('/api/unanswered');
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
    return;
  }
  if (data.length === 0) {
    document.getElementById('unansweredList').innerHTML =
      '<div class="empty-state">這個狀態目前沒有資料。</div>';
    return;
  }
  document.getElementById('unansweredList').innerHTML = data.map((item, idx) => {
    const date = new Date(item.timestamp).toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    const reply = item.reply ? escapeHtml(item.reply) : '';
    const reason = item.reason ? escapeHtml(item.reason) : 'AI 回覆表示知識庫沒有明確答案';
    const status = item.status || 'pending';
    const note = item.note || '';
    return `
      <div class="unanswered-item" id="gap-${idx}">
        <div class="unanswered-icon">❓</div>
        <div class="unanswered-body">
          <div class="unanswered-q">${escapeHtml(item.question)}</div>
          <div class="gap-status-badge">${escapeHtml(GAP_STATUS_LABELS[status] || status)}</div>
          <div class="unanswered-reason">${reason}</div>
          ${reply ? `
            <div class="unanswered-actions">
              <button class="unanswered-toggle" id="gap-toggle-${idx}" type="button" data-gap-index="${idx}">查看 AI 回覆</button>
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
function renderSessions(data) {
  if (data.length === 0) {
    document.getElementById('sessionsList').innerHTML = '<div class="empty-state">找不到相關對話紀錄</div>';
    return;
  }
  document.getElementById('sessionsList').innerHTML = data.map((session, idx) => {
    const startTime = new Date(session.started_at).toLocaleString('zh-TW');
    const msgCount  = Math.floor(session.message_count / 2);
    const messages  = session.messages.map(msg => `
      <div class="msg-item">
        <span class="msg-role ${msg.role}">${msg.role === 'user' ? '用戶' : 'AI'}</span>
        <div class="msg-content">${escapeHtml(msg.content)}</div>
        <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' })}</div>
      </div>
    `).join('');

    return `
      <div class="session-item">
        <div class="session-header" data-session-target="sess-${idx}" data-session-index="${idx}">
          <span class="session-id">${escapeHtml(session.session_id.substring(0, 20))}…</span>
          <span class="session-meta">${startTime}</span>
          <span class="session-count">${msgCount} 問答</span>
          <span class="session-toggle" id="toggle-${idx}">▼</span>
        </div>
        <div class="session-messages" id="sess-${idx}">
          ${messages}
        </div>
      </div>
    `;
  }).join('');
}

async function loadSessions() {
  const data = await adminFetch('/api/sessions');
  if (data.length === 0) {
    document.getElementById('sessionsList').innerHTML = '<div class="empty-state">尚無對話紀錄，對話後會自動出現在這裡</div>';
    return;
  }
  renderSessions(data);
}

function toggleSession(id, idx) {
  const el     = document.getElementById(id);
  const toggle = document.getElementById('toggle-' + idx);
  el.classList.toggle('open');
  toggle.textContent = el.classList.contains('open') ? '▲' : '▼';
}

function bindDashboardEvents() {
  document.getElementById('adminKeyInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitLogin();
  });
  document.getElementById('loginBtn')?.addEventListener('click', submitLogin);
  document.getElementById('refreshBtn')?.addEventListener('click', loadAll);

  document.getElementById('layerDailyBtn')?.addEventListener('click', () => showDashboardLayer('daily'));
  document.getElementById('layerKnowledgeBtn')?.addEventListener('click', () => showDashboardLayer('knowledge'));
  document.getElementById('layerReportBtn')?.addEventListener('click', () => showDashboardLayer('report'));

  document.getElementById('reportWeekBtn')?.addEventListener('click', () => loadOperationsReport('week'));
  document.getElementById('reportMonthBtn')?.addEventListener('click', () => loadOperationsReport('month'));
  document.getElementById('copyReportBtn')?.addEventListener('click', copyReportMarkdown);
  document.getElementById('downloadReportBtn')?.addEventListener('click', downloadReportMarkdown);

  document.getElementById('kbExportBtn')?.addEventListener('click', exportKnowledgeJson);
  document.getElementById('kbNewBtn')?.addEventListener('click', newSection);
  document.getElementById('kbSearch')?.addEventListener('input', renderKbSidebar);
  document.getElementById('kbShowArchived')?.addEventListener('change', loadKnowledge);
  document.getElementById('kbName')?.addEventListener('input', renderCategorySuggestions);
  document.getElementById('kbName')?.addEventListener('focus', renderCategorySuggestions);
  document.getElementById('kbTemplateBtn')?.addEventListener('click', applyKnowledgeTemplate);
  document.getElementById('kbContent')?.addEventListener('input', kbCharCount);
  document.getElementById('kbRestoreBtn')?.addEventListener('click', restoreSection);
  document.getElementById('kbDelBtn')?.addEventListener('click', archiveSection);
  document.getElementById('kbSaveBtn')?.addEventListener('click', saveSection);

  document.getElementById('gapFilter')?.addEventListener('change', renderUnansweredList);
  document.getElementById('searchInput')?.addEventListener('input', event => handleSearch(event.currentTarget.value));

  document.addEventListener('click', event => {
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
