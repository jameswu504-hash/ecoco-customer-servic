const partnerState = {
  companies: [],
  selectedCompanyId: null,
  detail: null,
  conversationLog: null,
  testSessionId: '',
  pendingCleanPackage: null,
  pendingDeleteAction: null,
};

const CLEANER_MAX_BYTES = 2_000_000;

function getAdminKey() {
  return sessionStorage.getItem('adminKey') || '';
}

async function partnerFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': getAdminKey(),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    document.getElementById('loginOverlay').hidden = false;
    throw new Error('Admin Key 已失效，請重新登入。');
  }
  if (!response.ok) throw new Error(body.error || '操作失敗，請稍後再試。');
  return body;
}

function setBusy(button, busy, busyText = '處理中...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatConversationDate(value) {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatConversationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function renderCompanies() {
  const list = document.getElementById('companyList');
  list.replaceChildren();
  if (partnerState.companies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'loading-row';
    empty.textContent = '尚未建立合作公司';
    list.appendChild(empty);
    return;
  }

  partnerState.companies.forEach(company => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `company-item${Number(company.id) === Number(partnerState.selectedCompanyId) ? ' active' : ''}`;

    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = company.name;
    const slug = document.createElement('small');
    slug.textContent = `${company.slug} · ${company.status === 'active' ? '啟用' : '停用'}`;
    info.append(name, slug);

    const count = document.createElement('span');
    count.className = 'company-count';
    count.textContent = `${Number(company.line_group_count || 0)}G`;
    button.append(info, count);
    button.addEventListener('click', () => selectCompany(company.id));
    list.appendChild(button);
  });
}

function renderLineGroups(groups) {
  const list = document.getElementById('groupList');
  list.replaceChildren();
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = '尚未綁定真實 LINE 群組，仍可先使用下方測試功能。';
    list.appendChild(empty);
    return;
  }

  groups.forEach(group => {
    const row = document.createElement('div');
    row.className = 'data-row';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = group.label || `LINE 群組 • ${group.group_id_last4}`;
    const meta = document.createElement('small');
    meta.textContent = `綁定時間 ${formatTime(group.bound_at)}`;
    info.append(title, meta);
    const state = document.createElement('span');
    state.className = 'row-state';
    state.textContent = group.status === 'active' ? '已綁定' : '已停用';
    row.append(info, state);
    list.appendChild(row);
  });
}

function createCompactButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className} compact-button`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderKnowledge(rows) {
  const list = document.getElementById('knowledgeList');
  list.replaceChildren();
  const selectedStatus = document.getElementById('knowledgeStatus')?.value || 'active';
  const filteredRows = rows.filter(item => (
    selectedStatus === 'archived' ? Boolean(item.archived_at) : !item.archived_at
  ));
  if (!filteredRows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = selectedStatus === 'archived'
      ? '目前沒有已封存的公司專屬資料。'
      : '尚未加入公司專屬資料。';
    list.appendChild(empty);
    return;
  }

  filteredRows.forEach(item => {
    const isArchived = Boolean(item.archived_at);
    const row = document.createElement('details');
    row.className = 'knowledge-row';
    const summary = document.createElement('summary');
    summary.className = 'knowledge-summary';
    const info = document.createElement('div');
    info.className = 'knowledge-summary-info';
    const category = document.createElement('strong');
    category.textContent = item.category;
    const preview = document.createElement('small');
    preview.className = 'knowledge-preview';
    const content = String(item.content || '').replace(/\s+/g, ' ').trim();
    preview.textContent = content.length > 140 ? `${content.slice(0, 140)}...` : content;
    info.append(category, preview);

    const actions = document.createElement('span');
    actions.className = 'knowledge-summary-actions';
    const state = document.createElement('span');
    state.className = `row-state${isArchived ? ' archived' : ''}`;
    state.textContent = isArchived ? '已封存' : '使用中';
    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'knowledge-toggle-label';
    toggleLabel.textContent = '展開';
    actions.append(state, toggleLabel);
    summary.append(info, actions);

    const contentPanel = document.createElement('div');
    contentPanel.className = 'knowledge-content-panel';
    const contentLabel = document.createElement('strong');
    contentLabel.className = 'knowledge-content-label';
    contentLabel.textContent = '完整資料內容';
    const fullContent = document.createElement('pre');
    fullContent.className = 'knowledge-full-content';
    fullContent.textContent = String(item.content || '').trim();
    const itemActions = document.createElement('div');
    itemActions.className = 'knowledge-item-actions';
    if (isArchived) {
      itemActions.append(
        createCompactButton('恢復', 'secondary-button', () => updateKnowledgeArchive(item, false)),
        createCompactButton('永久刪除', 'danger-button', () => openDeletePartnerDataDialog({
          kind: 'knowledge',
          id: item.id,
          label: item.category,
          expected: partnerState.detail?.company?.slug || '',
        }))
      );
    } else {
      itemActions.append(
        createCompactButton('封存', 'secondary-button', () => updateKnowledgeArchive(item, true))
      );
    }
    contentPanel.append(contentLabel, fullContent, itemActions);

    row.addEventListener('toggle', () => {
      toggleLabel.textContent = row.open ? '收合' : '展開';
      preview.hidden = row.open;
    });
    row.append(summary, contentPanel);
    list.appendChild(row);
  });
}

function renderConversationLog(payload) {
  const log = document.getElementById('conversationLog');
  const summary = document.getElementById('conversationSummary');
  log.replaceChildren();
  const days = Array.isArray(payload?.days) ? payload.days : [];
  const selectedStatus = payload?.status === 'archived' ? 'archived' : 'active';

  if (!days.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = selectedStatus === 'archived'
      ? '目前沒有已封存的 LINE 群組對話紀錄。'
      : '目前沒有真實 LINE 群組對話紀錄。後台測試對話不會顯示在這裡。';
    log.appendChild(empty);
    summary.textContent = `最近 ${Number(payload?.selectedDays || 30)} 天沒有${selectedStatus === 'archived' ? '已封存的' : ''} LINE 群組訊息。`;
    return;
  }

  summary.textContent = [
    selectedStatus === 'archived' ? '已封存' : '使用中',
    `最近 ${Number(payload.selectedDays || 30)} 天`,
    `共 ${Number(payload.totalDays || days.length)} 天`,
    `${Number(payload.totalMessages || 0)} 則訊息`,
    payload.truncated ? '（紀錄較多，僅顯示最新資料）' : '',
  ].filter(Boolean).join(' · ');

  days.forEach((day, dayIndex) => {
    const section = document.createElement('details');
    section.className = 'conversation-day';
    section.open = dayIndex === 0;

    const heading = document.createElement('summary');
    heading.className = 'conversation-day-heading';
    const date = document.createElement('strong');
    date.textContent = formatConversationDate(day.date);
    const count = document.createElement('span');
    count.textContent = `${Number(day.messageCount || 0)} 則`;
    heading.append(date, count);

    const dayActions = document.createElement('div');
    dayActions.className = 'conversation-day-actions';
    if (selectedStatus === 'archived') {
      dayActions.append(
        createCompactButton('恢復當日', 'secondary-button', () => updateConversationDayArchive(day.date, false)),
        createCompactButton('永久刪除當日', 'danger-button', () => openDeletePartnerDataDialog({
          kind: 'conversation-day',
          day: day.date,
          label: `${formatConversationDate(day.date)} LINE 對話`,
          expected: day.date,
        }))
      );
    } else {
      dayActions.append(
        createCompactButton('封存當日', 'secondary-button', () => updateConversationDayArchive(day.date, true))
      );
    }

    const messages = document.createElement('div');
    messages.className = 'conversation-messages';
    (Array.isArray(day.messages) ? day.messages : []).forEach(item => {
      const message = document.createElement('article');
      const isAssistant = item.role === 'assistant';
      message.className = `conversation-message ${isAssistant ? 'assistant' : 'user'}`;

      const meta = document.createElement('div');
      meta.className = 'conversation-message-meta';
      const role = document.createElement('strong');
      role.textContent = isAssistant ? 'ECOCO AI' : 'LINE 使用者';
      const context = document.createElement('span');
      context.textContent = `${item.groupLabel || 'LINE 群組'} · ${formatConversationTime(item.timestamp)}`;
      meta.append(role, context);

      const content = document.createElement('p');
      content.textContent = String(item.content || '');
      message.append(meta, content);
      messages.appendChild(message);
    });

    section.append(heading, dayActions, messages);
    log.appendChild(section);
  });
}

function renderDetail() {
  const detail = partnerState.detail;
  const workspace = document.getElementById('partnerWorkspace');
  const empty = document.getElementById('emptySelection');
  if (!detail) {
    workspace.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  workspace.hidden = false;
  const company = detail.company;
  document.getElementById('pageTitle').textContent = company.name;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companySlug').textContent = company.slug;
  document.getElementById('testCompanyLabel').textContent = `${company.name} 分支`;
  document.getElementById('groupCount').textContent = String(detail.lineGroups.length);
  document.getElementById('knowledgeCount').textContent = String(
    detail.knowledge.filter(item => !item.archived_at).length
  );

  const status = document.getElementById('companyStatus');
  const isActive = company.status === 'active';
  status.textContent = isActive ? '啟用中' : '已停用';
  status.classList.toggle('inactive', !isActive);
  document.getElementById('toggleCompanyStatusBtn').textContent = isActive ? '停用公司' : '重新啟用';
  document.getElementById('generateBindingCodeBtn').disabled = !isActive;
  document.getElementById('sendTestBtn').disabled = !isActive;
  document.getElementById('selectCleanerFileBtn').disabled = !isActive;
  const cleanerDropZone = document.getElementById('cleanerDropZone');
  cleanerDropZone.classList.toggle('disabled', !isActive);
  cleanerDropZone.setAttribute('aria-disabled', String(!isActive));

  renderLineGroups(detail.lineGroups);
  renderKnowledge(detail.knowledge);
  renderConversationLog(partnerState.conversationLog);
}

async function loadCompanies(selectFirst = true) {
  partnerState.companies = await partnerFetch('/api/partners');
  if (
    selectFirst
    && !partnerState.selectedCompanyId
    && partnerState.companies.length > 0
  ) {
    partnerState.selectedCompanyId = partnerState.companies[0].id;
  }
  renderCompanies();
  if (partnerState.selectedCompanyId) {
    await loadCompanyDetail(partnerState.selectedCompanyId);
  } else {
    partnerState.detail = null;
    renderDetail();
  }
}

async function loadCompanyDetail(companyId) {
  const days = Number(document.getElementById('conversationDays')?.value || 30);
  const conversationStatus = document.getElementById('conversationStatus')?.value || 'active';
  const [detail, conversationResult] = await Promise.all([
    partnerFetch(`/api/partners/${companyId}`),
    partnerFetch(
      `/api/partners/${companyId}/conversations?days=${days}&status=${conversationStatus}`
    )
      .then(data => ({ data, error: null }))
      .catch(error => ({ data: null, error })),
  ]);
  partnerState.detail = detail;
  partnerState.conversationLog = conversationResult.data;
  partnerState.selectedCompanyId = Number(companyId);
  renderCompanies();
  renderDetail();
  document.getElementById('conversationError').textContent =
    conversationResult.error?.message || '';
}

async function refreshConversationLog() {
  const companyId = partnerState.selectedCompanyId;
  if (!companyId) return;
  const button = document.getElementById('refreshConversationsBtn');
  const error = document.getElementById('conversationError');
  const days = Number(document.getElementById('conversationDays').value || 30);
  const status = document.getElementById('conversationStatus').value || 'active';
  error.textContent = '';
  setBusy(button, true, '更新中...');
  try {
    partnerState.conversationLog = await partnerFetch(
      `/api/partners/${companyId}/conversations?days=${days}&status=${status}`
    );
    renderConversationLog(partnerState.conversationLog);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
  }
}

async function selectCompany(companyId) {
  if (Number(companyId) === Number(partnerState.selectedCompanyId)) return;
  partnerState.testSessionId = '';
  partnerState.conversationLog = null;
  clearCleaner();
  document.getElementById('bindingResult').hidden = true;
  const chat = document.getElementById('testChat');
  chat.replaceChildren();
  const system = document.createElement('div');
  system.className = 'system-message';
  system.textContent = '此測試只會讀取 ECOCO 共用資料與目前公司的專屬資料。';
  chat.appendChild(system);
  await loadCompanyDetail(companyId);
}

function openCreateCompanyDialog() {
  document.getElementById('createCompanyError').textContent = '';
  document.getElementById('createCompanyDialog').showModal();
  document.getElementById('newCompanyName').focus();
}

async function submitLogin(event) {
  event.preventDefault();
  const key = document.getElementById('adminKeyInput').value.trim();
  const error = document.getElementById('loginError');
  error.textContent = '';
  if (!key) return;
  sessionStorage.setItem('adminKey', key);
  try {
    await loadCompanies();
    document.getElementById('loginOverlay').hidden = true;
  } catch (err) {
    sessionStorage.removeItem('adminKey');
    error.textContent = err.message;
  }
}

async function createCompany(event) {
  event.preventDefault();
  const button = event.submitter;
  const error = document.getElementById('createCompanyError');
  error.textContent = '';
  setBusy(button, true);
  try {
    const company = await partnerFetch('/api/partners', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('newCompanyName').value,
        slug: document.getElementById('newCompanySlug').value,
      }),
    });
    document.getElementById('createCompanyDialog').close();
    event.currentTarget.reset();
    partnerState.selectedCompanyId = company.id;
    await loadCompanies(false);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
  }
}

async function toggleCompanyStatus() {
  const company = partnerState.detail?.company;
  if (!company) return;
  const button = document.getElementById('toggleCompanyStatusBtn');
  setBusy(button, true);
  try {
    await partnerFetch(`/api/partners/${company.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: company.status === 'active' ? 'inactive' : 'active',
      }),
    });
    await loadCompanies(false);
  } finally {
    setBusy(button, false);
  }
}

async function generateBindingCode() {
  const company = partnerState.detail?.company;
  if (!company) return;
  const button = document.getElementById('generateBindingCodeBtn');
  setBusy(button, true, '產生中...');
  try {
    const binding = await partnerFetch(`/api/partners/${company.id}/binding-code`, {
      method: 'POST',
      body: '{}',
    });
    document.getElementById('bindingCode').textContent = binding.code;
    document.getElementById('bindingExpiry').textContent = `有效期限 ${formatTime(binding.expiresAt)}`;
    document.getElementById('bindingResult').hidden = false;
  } finally {
    setBusy(button, false);
  }
}

async function copyBindingCode() {
  const code = document.getElementById('bindingCode').textContent;
  if (!code) return;
  await navigator.clipboard.writeText(`綁定 ${code}`);
  const button = document.getElementById('copyBindingCodeBtn');
  const original = button.textContent;
  button.textContent = '✓';
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

async function addKnowledge(event) {
  event.preventDefault();
  const company = partnerState.detail?.company;
  if (!company) return;
  const button = event.submitter;
  const error = document.getElementById('knowledgeError');
  error.textContent = '';
  setBusy(button, true);
  try {
    await partnerFetch(`/api/partners/${company.id}/knowledge`, {
      method: 'POST',
      body: JSON.stringify({
        category: document.getElementById('knowledgeCategory').value,
        content: document.getElementById('knowledgeContent').value,
      }),
    });
    event.currentTarget.reset();
    await loadCompanyDetail(company.id);
    await loadCompanies(false);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
  }
}

async function updateKnowledgeArchive(item, shouldArchive) {
  const company = partnerState.detail?.company;
  if (!company) return;
  const status = document.getElementById('clearCompanyKnowledgeStatus');
  status.textContent = '';
  try {
    await partnerFetch(`/api/partners/${company.id}/knowledge/${item.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: shouldArchive ? 'archived' : 'active' }),
    });
    await loadCompanies(false);
    document.getElementById('clearCompanyKnowledgeStatus').textContent =
      shouldArchive ? `已封存「${item.category}」。` : `已恢復「${item.category}」。`;
  } catch (err) {
    status.textContent = err.message;
  }
}

async function updateConversationDayArchive(day, shouldArchive) {
  const company = partnerState.detail?.company;
  if (!company) return;
  const status = document.getElementById('conversationOperationStatus');
  status.textContent = '';
  try {
    const result = await partnerFetch(
      `/api/partners/${company.id}/conversations/${encodeURIComponent(day)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: shouldArchive ? 'archived' : 'active' }),
      }
    );
    await refreshConversationLog();
    document.getElementById('conversationOperationStatus').textContent =
      `${shouldArchive ? '已封存' : '已恢復'} ${day}，共 ${result.updatedMessages} 則訊息。`;
  } catch (err) {
    document.getElementById('conversationError').textContent = err.message;
  }
}

function openDeletePartnerDataDialog(action) {
  partnerState.pendingDeleteAction = action;
  const isKnowledge = action.kind === 'knowledge';
  document.getElementById('deletePartnerDataTitle').textContent =
    isKnowledge ? '永久刪除公司知識' : '永久刪除 LINE 當日紀錄';
  document.getElementById('deletePartnerDataDescription').textContent = isKnowledge
    ? `這會刪除「${action.label}」、對應 RAG 切片，以及沒有其他知識使用的來源與清洗紀錄。`
    : `這會永久刪除「${action.label}」中已封存的所有訊息。`;
  document.getElementById('deletePartnerDataExpected').textContent = action.expected;
  document.getElementById('deletePartnerDataConfirmation').value = '';
  document.getElementById('deletePartnerDataError').textContent = '';
  document.getElementById('deletePartnerDataDialog').showModal();
  document.getElementById('deletePartnerDataConfirmation').focus();
}

function closeDeletePartnerDataDialog() {
  partnerState.pendingDeleteAction = null;
  document.getElementById('deletePartnerDataDialog').close();
}

async function submitDeletePartnerData(event) {
  event.preventDefault();
  const company = partnerState.detail?.company;
  const action = partnerState.pendingDeleteAction;
  if (!company || !action) return;
  const confirmation = document.getElementById('deletePartnerDataConfirmation').value.trim();
  const error = document.getElementById('deletePartnerDataError');
  error.textContent = '';
  if (confirmation !== action.expected) {
    error.textContent = `確認文字不符，請輸入 ${action.expected}。`;
    return;
  }

  const button = event.submitter;
  setBusy(button, true, '刪除中...');
  try {
    if (action.kind === 'knowledge') {
      const result = await partnerFetch(
        `/api/partners/${company.id}/knowledge/${action.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ confirmSlug: confirmation }),
        }
      );
      closeDeletePartnerDataDialog();
      await loadCompanies(false);
      document.getElementById('clearCompanyKnowledgeStatus').textContent =
        `已永久刪除「${action.label}」及 ${result.deleted.knowledgeChunks} 個 RAG 切片。`;
    } else {
      const result = await partnerFetch(
        `/api/partners/${company.id}/conversations/${encodeURIComponent(action.day)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ confirmDay: confirmation }),
        }
      );
      closeDeletePartnerDataDialog();
      await refreshConversationLog();
      document.getElementById('conversationOperationStatus').textContent =
        `已永久刪除 ${action.day} 的 ${result.deletedMessages} 則已封存訊息。`;
    }
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
  }
}

function openClearCompanyKnowledgeDialog() {
  const company = partnerState.detail?.company;
  if (!company) return;
  document.getElementById('clearKnowledgeCompanyName').textContent = company.name;
  document.getElementById('clearKnowledgeCompanySlug').textContent = company.slug;
  document.getElementById('clearKnowledgeConfirmation').value = '';
  document.getElementById('clearKnowledgeDialogError').textContent = '';
  document.getElementById('clearCompanyKnowledgeDialog').showModal();
  document.getElementById('clearKnowledgeConfirmation').focus();
}

async function submitClearCompanyKnowledge(event) {
  event.preventDefault();
  const company = partnerState.detail?.company;
  if (!company) return;
  const confirmation = document.getElementById('clearKnowledgeConfirmation').value.trim();
  const error = document.getElementById('clearKnowledgeDialogError');
  error.textContent = '';
  if (confirmation.trim() !== company.slug) {
    error.textContent = `公司代號不符，未刪除。請輸入 ${company.slug}。`;
    return;
  }

  const button = event.submitter;
  setBusy(button, true, '清除中...');
  try {
    const result = await partnerFetch(`/api/partners/${company.id}/knowledge`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmSlug: confirmation }),
    });
    document.getElementById('clearCompanyKnowledgeDialog').close();
    await loadCompanyDetail(company.id);
    await loadCompanies(false);
    document.getElementById('clearCompanyKnowledgeStatus').textContent =
      `已清空：${result.deleted.knowledgeSections} 份知識、`
      + `${result.deleted.knowledgeChunks} 個 RAG 切片、`
      + `${result.deleted.sourceDocuments} 份來源與 `
      + `${result.deleted.cleaningJobs} 筆清洗紀錄。`;
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
  }
}

function clearCleaner() {
  partnerState.pendingCleanPackage = null;
  const input = document.getElementById('cleanerFileInput');
  const panel = document.getElementById('cleanerPanel');
  const confirmButton = document.getElementById('confirmCleanerImportBtn');
  if (input) input.value = '';
  if (panel) panel.hidden = true;
  if (confirmButton) confirmButton.disabled = false;
  if (confirmButton) confirmButton.textContent = '確認並匯入知識庫';
  const error = document.getElementById('cleanerError');
  if (error) error.textContent = '';
}

function openCleanerFilePicker() {
  if (partnerState.detail?.company?.status !== 'active') return;
  const input = document.getElementById('cleanerFileInput');
  input.value = '';
  input.click();
}

function appendCleanerMetric(label, value) {
  const metrics = document.getElementById('cleanerMetrics');
  const item = document.createElement('div');
  const name = document.createElement('span');
  const data = document.createElement('strong');
  name.textContent = label;
  data.textContent = String(value);
  item.append(name, data);
  metrics.appendChild(item);
}

function renderCleanerPackage(cleanedPackage) {
  const report = cleanedPackage.report;
  document.getElementById('cleanerFileName').textContent = cleanedPackage.source.name;
  document.getElementById('cleanerSourceHash').textContent =
    `SHA-256 ${cleanedPackage.source.contentHash.slice(0, 16)}…`;
  const metrics = document.getElementById('cleanerMetrics');
  metrics.replaceChildren();
  appendCleanerMetric(
    '格式',
    cleanedPackage.source.type === 'line_txt' ? 'LINE TXT' : 'Markdown'
  );
  appendCleanerMetric('原始字數', report.sourceCharacters.toLocaleString('zh-TW'));
  appendCleanerMetric('知識文件', report.sectionCount);
  appendCleanerMetric('RAG Chunks', report.chunkCount);
  appendCleanerMetric('外部 AI', '未使用');
  appendCleanerMetric('內部聯絡資料', '保留');

  const warnings = document.getElementById('cleanerWarnings');
  warnings.replaceChildren();
  if (!report.warnings.length) {
    const item = document.createElement('p');
    item.className = 'cleaner-ok';
    item.textContent = '格式檢查完成，沒有需要人工注意的警告。';
    warnings.appendChild(item);
  } else {
    report.warnings.forEach(warning => {
      const item = document.createElement('p');
      item.textContent = warning;
      warnings.appendChild(item);
    });
  }
  document.getElementById('cleanerPreview').textContent =
    cleanedPackage.markdown.length > 16_000
      ? `${cleanedPackage.markdown.slice(0, 16_000)}\n\n（預覽僅顯示前 16,000 字）`
      : cleanedPackage.markdown;
}

async function prepareCleanerFile(file) {
  if (!file) return;
  const company = partnerState.detail?.company;
  const panel = document.getElementById('cleanerPanel');
  const error = document.getElementById('cleanerError');
  const confirmButton = document.getElementById('confirmCleanerImportBtn');
  document.getElementById('cleanerFileName').textContent = file.name;
  panel.hidden = false;
  error.textContent = '';
  document.getElementById('cleanerPreview').textContent = '本機清洗中...';
  document.getElementById('cleanerMetrics').replaceChildren();
  document.getElementById('cleanerWarnings').replaceChildren();
  confirmButton.textContent = '確認並匯入知識庫';
  confirmButton.disabled = false;
  partnerState.pendingCleanPackage = null;

  try {
    if (!company || company.status !== 'active') {
      throw new Error('請先選擇已啟用的合作公司。');
    }
    if (!/\.(?:txt|md)$/i.test(file.name)) {
      throw new Error('第一版只支援 .txt 與 .md 檔案。');
    }
    if (file.size > CLEANER_MAX_BYTES) {
      throw new Error('檔案過大，請控制在 2 MB 以內。');
    }
    const content = await file.text();
    const cleaner = window.EcocoPartnerDataCleaner;
    if (!cleaner?.cleanPartnerKnowledgeFile) {
      throw new Error('本機資料清洗模組尚未載入，請重新整理頁面。');
    }
    const cleanedPackage = await cleaner.cleanPartnerKnowledgeFile({
      company,
      sourceName: file.name,
      content,
    });
    partnerState.pendingCleanPackage = cleanedPackage;
    renderCleanerPackage(cleanedPackage);
  } catch (err) {
    error.textContent = err.message;
    document.getElementById('cleanerPreview').textContent = '';
    confirmButton.disabled = true;
  }
}

function setCleanerDropState(active) {
  document.getElementById('cleanerDropZone').classList.toggle('is-dragging', active);
}

function handleCleanerDrag(event) {
  event.preventDefault();
  if (partnerState.detail?.company?.status !== 'active') return;
  if (event.type === 'dragleave' && event.currentTarget.contains(event.relatedTarget)) return;
  setCleanerDropState(event.type !== 'dragleave');
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

async function handleCleanerDrop(event) {
  event.preventDefault();
  setCleanerDropState(false);
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  if (files.length > 1) {
    partnerState.pendingCleanPackage = null;
    const panel = document.getElementById('cleanerPanel');
    panel.hidden = false;
    document.getElementById('cleanerMetrics').replaceChildren();
    document.getElementById('cleanerWarnings').replaceChildren();
    document.getElementById('confirmCleanerImportBtn').disabled = true;
    document.getElementById('cleanerError').textContent = '一次只能清洗一個檔案。';
    document.getElementById('cleanerPreview').textContent = '';
    return;
  }
  await prepareCleanerFile(files[0]);
}

function handleCleanerDropZoneKeydown(event) {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  openCleanerFilePicker();
}

function downloadCleanerPackage() {
  const cleanedPackage = partnerState.pendingCleanPackage;
  if (!cleanedPackage) return;
  const blob = new Blob(
    [JSON.stringify(cleanedPackage, null, 2)],
    { type: 'application/json;charset=utf-8' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const base = cleanedPackage.source.name.replace(/\.(?:txt|md)$/i, '');
  link.href = url;
  link.download = `${base}-ai-cleaned.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importCleanedPackage() {
  const company = partnerState.detail?.company;
  const cleanedPackage = partnerState.pendingCleanPackage;
  if (!company || !cleanedPackage) return;
  const button = document.getElementById('confirmCleanerImportBtn');
  const error = document.getElementById('cleanerError');
  let succeeded = false;
  error.textContent = '';
  setBusy(button, true, '匯入中...');

  try {
    const result = await partnerFetch(`/api/partners/${company.id}/knowledge/import-cleaned`, {
      method: 'POST',
      body: JSON.stringify({
        format: cleanedPackage.format,
        source: cleanedPackage.source,
        policy: cleanedPackage.policy,
        skill: cleanedPackage.skill,
        report: cleanedPackage.report,
        sections: cleanedPackage.sections,
        chunks: cleanedPackage.chunks,
      }),
    });
    const success = document.createElement('p');
    success.className = 'cleaner-ok';
    success.textContent = [
      `匯入完成：${result.createdSectionCount} 份知識文件`,
      `${result.createdChunkCount} 個 RAG Chunks`,
      '姓名、電話與 Email 已保留',
      '原始檔未上傳',
    ].join('；');
    document.getElementById('cleanerWarnings').prepend(success);
    succeeded = true;
    await loadCompanyDetail(company.id);
    await loadCompanies(false);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
    if (succeeded) {
      button.textContent = '匯入完成';
      button.disabled = true;
    }
  }
}

function appendTestMessage(role, text) {
  const chat = document.getElementById('testChat');
  const message = document.createElement('div');
  message.className = `chat-message ${role}`;
  message.textContent = text;
  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;
}

async function sendTestQuestion(event) {
  event.preventDefault();
  const company = partnerState.detail?.company;
  const input = document.getElementById('testQuestion');
  const question = input.value.trim();
  if (!company || !question) return;

  const button = document.getElementById('sendTestBtn');
  const error = document.getElementById('testError');
  error.textContent = '';
  appendTestMessage('user', question);
  input.value = '';
  setBusy(button, true, '查詢中...');
  try {
    const result = await partnerFetch(`/api/partners/${company.id}/test-chat`, {
      method: 'POST',
      body: JSON.stringify({
        question,
        sessionId: partnerState.testSessionId,
      }),
    });
    partnerState.testSessionId = result.sessionId;
    appendTestMessage('bot', result.reply);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    setBusy(button, false);
    input.focus();
  }
}

function bindEvents() {
  document.getElementById('loginForm').addEventListener('submit', submitLogin);
  document.getElementById('openCreateCompanyBtn').addEventListener('click', openCreateCompanyDialog);
  document.getElementById('refreshConversationsBtn').addEventListener('click', refreshConversationLog);
  document.getElementById('conversationDays').addEventListener('change', refreshConversationLog);
  document.getElementById('conversationStatus').addEventListener('change', refreshConversationLog);
  document.getElementById('knowledgeStatus').addEventListener('change', () => {
    renderKnowledge(partnerState.detail?.knowledge || []);
  });
  document.getElementById('emptyCreateCompanyBtn').addEventListener('click', openCreateCompanyDialog);
  document.getElementById('closeCreateCompanyBtn').addEventListener('click', () => document.getElementById('createCompanyDialog').close());
  document.getElementById('cancelCreateCompanyBtn').addEventListener('click', () => document.getElementById('createCompanyDialog').close());
  document.getElementById('createCompanyForm').addEventListener('submit', createCompany);
  document.getElementById('toggleCompanyStatusBtn').addEventListener('click', toggleCompanyStatus);
  document.getElementById('generateBindingCodeBtn').addEventListener('click', generateBindingCode);
  document.getElementById('copyBindingCodeBtn').addEventListener('click', copyBindingCode);
  document.getElementById('knowledgeForm').addEventListener('submit', addKnowledge);
  document.getElementById('clearCompanyKnowledgeBtn').addEventListener('click', openClearCompanyKnowledgeDialog);
  document.getElementById('closeClearKnowledgeBtn').addEventListener('click', () => document.getElementById('clearCompanyKnowledgeDialog').close());
  document.getElementById('cancelClearKnowledgeBtn').addEventListener('click', () => document.getElementById('clearCompanyKnowledgeDialog').close());
  document.getElementById('clearCompanyKnowledgeForm').addEventListener('submit', submitClearCompanyKnowledge);
  document.getElementById('closeDeletePartnerDataBtn').addEventListener('click', closeDeletePartnerDataDialog);
  document.getElementById('cancelDeletePartnerDataBtn').addEventListener('click', closeDeletePartnerDataDialog);
  document.getElementById('deletePartnerDataForm').addEventListener('submit', submitDeletePartnerData);
  document.getElementById('selectCleanerFileBtn').addEventListener('click', openCleanerFilePicker);
  document.getElementById('cleanerFileInput').addEventListener('change', event => {
    prepareCleanerFile(event.target.files?.[0]);
  });
  const cleanerDropZone = document.getElementById('cleanerDropZone');
  cleanerDropZone.addEventListener('click', openCleanerFilePicker);
  cleanerDropZone.addEventListener('keydown', handleCleanerDropZoneKeydown);
  cleanerDropZone.addEventListener('dragenter', handleCleanerDrag);
  cleanerDropZone.addEventListener('dragover', handleCleanerDrag);
  cleanerDropZone.addEventListener('dragleave', handleCleanerDrag);
  cleanerDropZone.addEventListener('drop', handleCleanerDrop);
  document.getElementById('cancelCleanerBtn').addEventListener('click', clearCleaner);
  document.getElementById('downloadCleanerPackageBtn').addEventListener('click', downloadCleanerPackage);
  document.getElementById('confirmCleanerImportBtn').addEventListener('click', importCleanedPackage);
  document.getElementById('testForm').addEventListener('submit', sendTestQuestion);
  document.getElementById('refreshBtn').addEventListener('click', () => loadCompanies(false));
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  if (!getAdminKey()) return;
  try {
    await loadCompanies();
    document.getElementById('loginOverlay').hidden = true;
  } catch {
    sessionStorage.removeItem('adminKey');
  }
});
