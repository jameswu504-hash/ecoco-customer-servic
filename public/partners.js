const partnerState = {
  companies: [],
  selectedCompanyId: null,
  detail: null,
  testSessionId: '',
  pendingLineImport: null,
};

const LINE_TXT_MAX_CHARACTERS = 250000;
const LINE_TXT_MAX_BYTES = 1000000;

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

function renderKnowledge(rows) {
  const list = document.getElementById('knowledgeList');
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = '尚未加入公司專屬資料。';
    list.appendChild(empty);
    return;
  }

  rows.forEach(item => {
    const row = document.createElement('div');
    row.className = 'data-row';
    const info = document.createElement('div');
    const category = document.createElement('strong');
    category.textContent = item.category;
    const preview = document.createElement('small');
    const content = String(item.content || '').replace(/\s+/g, ' ').trim();
    preview.textContent = content.length > 140 ? `${content.slice(0, 140)}...` : content;
    info.append(category, preview);
    const state = document.createElement('span');
    state.className = 'row-state';
    state.textContent = '專屬';
    row.append(info, state);
    list.appendChild(row);
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
  document.getElementById('knowledgeCount').textContent = String(detail.knowledge.length);

  const status = document.getElementById('companyStatus');
  const isActive = company.status === 'active';
  status.textContent = isActive ? '啟用中' : '已停用';
  status.classList.toggle('inactive', !isActive);
  document.getElementById('toggleCompanyStatusBtn').textContent = isActive ? '停用公司' : '重新啟用';
  document.getElementById('generateBindingCodeBtn').disabled = !isActive;
  document.getElementById('sendTestBtn').disabled = !isActive;

  renderLineGroups(detail.lineGroups);
  renderKnowledge(detail.knowledge);
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
  partnerState.detail = await partnerFetch(`/api/partners/${companyId}`);
  partnerState.selectedCompanyId = Number(companyId);
  renderCompanies();
  renderDetail();
}

async function selectCompany(companyId) {
  if (Number(companyId) === Number(partnerState.selectedCompanyId)) return;
  partnerState.testSessionId = '';
  clearLineImport();
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

function clearLineImport() {
  partnerState.pendingLineImport = null;
  const input = document.getElementById('lineTxtFileInput');
  const panel = document.getElementById('lineImportPanel');
  const confirmButton = document.getElementById('confirmLineImportBtn');
  if (input) input.value = '';
  if (panel) panel.hidden = true;
  if (confirmButton) confirmButton.disabled = false;
  const error = document.getElementById('lineImportError');
  if (error) error.textContent = '';
}

function openLineTxtPicker() {
  const input = document.getElementById('lineTxtFileInput');
  input.value = '';
  input.click();
}

async function prepareLineTxtImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const panel = document.getElementById('lineImportPanel');
  const error = document.getElementById('lineImportError');
  const summary = document.getElementById('lineImportSummary');
  const confirmButton = document.getElementById('confirmLineImportBtn');
  document.getElementById('lineImportFileName').textContent = file.name;
  panel.hidden = false;
  error.textContent = '';
  summary.textContent = '讀取檔案中...';
  confirmButton.textContent = '開始匯入';
  confirmButton.disabled = false;
  partnerState.pendingLineImport = null;

  try {
    if (!file.name.toLowerCase().endsWith('.txt')) {
      throw new Error('請選擇 LINE 匯出的 TXT 檔。');
    }
    if (file.size > LINE_TXT_MAX_BYTES) {
      throw new Error('TXT 檔案過大，請控制在 1 MB 以內。');
    }
    const content = await file.text();
    if (!content.trim()) throw new Error('TXT 檔案沒有內容。');
    if (content.length > LINE_TXT_MAX_CHARACTERS) {
      throw new Error(`TXT 內容需少於 ${LINE_TXT_MAX_CHARACTERS.toLocaleString('zh-TW')} 字。`);
    }
    partnerState.pendingLineImport = {
      sourceName: file.name,
      content,
    };
    summary.textContent = `${content.length.toLocaleString('zh-TW')} 字，系統會自動去識別、移除附件占位並切成多筆公司資料。`;
  } catch (err) {
    summary.textContent = '';
    error.textContent = err.message;
    confirmButton.disabled = true;
  }
}

async function importLineTxt() {
  const company = partnerState.detail?.company;
  const pending = partnerState.pendingLineImport;
  if (!company || !pending) return;
  const button = document.getElementById('confirmLineImportBtn');
  const error = document.getElementById('lineImportError');
  const summary = document.getElementById('lineImportSummary');
  let succeeded = false;
  error.textContent = '';
  setBusy(button, true, '匯入中...');

  try {
    const result = await partnerFetch(`/api/partners/${company.id}/knowledge/import-line`, {
      method: 'POST',
      body: JSON.stringify(pending),
    });
    partnerState.pendingLineImport = null;
    document.getElementById('lineTxtFileInput').value = '';
    summary.textContent = [
      `完成：新增 ${result.createdCount} 筆`,
      `略過 ${result.skippedDuplicateCount} 筆重複`,
      `忽略 ${result.ignoredAttachmentCount} 個附件占位`,
    ].join('；');
    succeeded = true;
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
  document.getElementById('emptyCreateCompanyBtn').addEventListener('click', openCreateCompanyDialog);
  document.getElementById('closeCreateCompanyBtn').addEventListener('click', () => document.getElementById('createCompanyDialog').close());
  document.getElementById('cancelCreateCompanyBtn').addEventListener('click', () => document.getElementById('createCompanyDialog').close());
  document.getElementById('createCompanyForm').addEventListener('submit', createCompany);
  document.getElementById('toggleCompanyStatusBtn').addEventListener('click', toggleCompanyStatus);
  document.getElementById('generateBindingCodeBtn').addEventListener('click', generateBindingCode);
  document.getElementById('copyBindingCodeBtn').addEventListener('click', copyBindingCode);
  document.getElementById('knowledgeForm').addEventListener('submit', addKnowledge);
  document.getElementById('selectLineTxtBtn').addEventListener('click', openLineTxtPicker);
  document.getElementById('lineTxtFileInput').addEventListener('change', prepareLineTxtImport);
  document.getElementById('cancelLineImportBtn').addEventListener('click', clearLineImport);
  document.getElementById('confirmLineImportBtn').addEventListener('click', importLineTxt);
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
