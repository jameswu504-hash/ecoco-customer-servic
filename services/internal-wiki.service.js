const ALLOWED_VISIBILITIES = new Set(['staff', 'manager', 'training', 'internal']);

function isInternalMode(env = process.env) {
  return String(env.APP_MODE || 'customer').trim().toLowerCase() === 'internal';
}

function normalizeDepartment(value) {
  const department = String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return department || 'general';
}

function normalizeVisibility(value) {
  const visibility = String(value || 'staff').trim().toLowerCase();
  return ALLOWED_VISIBILITIES.has(visibility) ? visibility : 'staff';
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean).join(', ');
  }
  return String(value || '').trim();
}

function cleanWikiEntryInput(body = {}) {
  return {
    department: normalizeDepartment(body.department),
    visibility: normalizeVisibility(body.visibility),
    title: String(body.title || '').trim().slice(0, 160),
    content: String(body.content || '').trim(),
    tags: normalizeTags(body.tags).slice(0, 500),
  };
}

function validateWikiEntry(entry) {
  if (!entry.title) return 'Title is required.';
  if (entry.content.length > 20000) return 'Content must be under 20000 characters.';
  return '';
}

function normalizeSearchQuery(value) {
  return String(value || '').trim().slice(0, 120);
}

function rowToWikiEntry(row) {
  return {
    id: row.id,
    department: row.department,
    visibility: row.visibility,
    title: row.title,
    content: row.content,
    tags: row.tags,
    sort_order: Number(row.sort_order || 0),
    updated_at: row.updated_at,
    archived_at: row.archived_at || null,
  };
}

module.exports = {
  ALLOWED_VISIBILITIES,
  cleanWikiEntryInput,
  isInternalMode,
  normalizeDepartment,
  normalizeSearchQuery,
  normalizeTags,
  normalizeVisibility,
  rowToWikiEntry,
  validateWikiEntry,
};
