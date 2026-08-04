const crypto = require('crypto');
const { normalizeModelMessages } = require('./conversation-history.service');
const { stripKnowledgeGapMarker } = require('./knowledge-gap.util');
const {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  shouldUseDeterministicStationReply,
} = require('./station-response.service');
const { buildSearchTerms, escapeIlikePattern } = require('./rag.service');
const { maskSensitiveText } = require('./privacy.service');
const { saveChatTrace } = require('./trace.service');
const { splitChunkContent } = require('./partner-conversation-knowledge.service');

const PARTNER_BINDING_CODE_TTL_HOURS = 24;
const PARTNER_MAX_KNOWLEDGE_CHARS = 20_000;
const PARTNER_COMPANY_CACHE_TTL_MS = 60 * 1000;
const PARTNER_CONVERSATION_DEFAULT_DAYS = 30;
const PARTNER_CONVERSATION_MAX_DAYS = 90;
const PARTNER_CONVERSATION_DEFAULT_PAGE_SIZE = 10;
const PARTNER_CONVERSATION_PAGE_SIZES = new Set([10, 15, 20, 50, 100]);
const PARTNER_CONVERSATION_MAX_OFFSET = 1_000_000;
const PARTNER_KNOWLEDGE_DEFAULT_PAGE_SIZE = 10;
const PARTNER_KNOWLEDGE_PAGE_SIZES = new Set([10, 15, 20, 50, 100]);
const PARTNER_KNOWLEDGE_MAX_OFFSET = 1_000_000;
const PARTNER_UNBOUND_REPLY = '此 LINE 群組尚未綁定 ECOCO 合作夥伴。請由 ECOCO 管理者建立公司並產生一次性綁定碼。';
const PARTNER_NO_DATA_REPLY = '目前沒有可供此群組回答的公司專屬資料，請聯絡 ECOCO 窗口協助確認。';
const PARTNER_SCOPE_DENIED_REPLY = PARTNER_NO_DATA_REPLY;

function normalizePartnerSlug(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function hashPartnerValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parsePartnerBindingCommand(text) {
  const normalized = String(text || '').normalize('NFKC').trim();
  const match = normalized.match(/^綁定\s+(B2B-[A-Z0-9]{4}-[A-Z0-9]{4})$/i);
  return match ? match[1].toUpperCase() : '';
}

function generatePartnerBindingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ2345' + '6789';
  const randomPart = length => Array.from(
    crypto.randomBytes(length),
    byte => alphabet[byte % alphabet.length]
  ).join('');
  return `B2B-${randomPart(4)}-${randomPart(4)}`;
}

function normalizeCompanyStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'inactive') return normalized;
  const error = new Error('Partner company status must be active or inactive.');
  error.code = 'PARTNER_INVALID_STATUS';
  throw error;
}

function normalizePartnerDataStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'archived') return normalized;
  const error = new Error('Partner data status must be active or archived.');
  error.code = 'PARTNER_INVALID_STATUS';
  throw error;
}

function normalizePartnerConversationDay(value) {
  const candidate = String(value || '').trim();
  const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) {
    return '';
  }
  return candidate;
}

function normalizePartnerMatchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizePartnerQuestionText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPartnerOverviewQuestion(question) {
  const normalized = normalizePartnerQuestionText(question).replace(/\s+/g, '');
  return (
    /(?:有哪些|有什麼|有甚麼|有哪一些|列出|整理|總覽|摘要).*(?:合作|資料|紀錄|內容)/
      .test(normalized)
    || /(?:合作|資料|紀錄|內容).*(?:有哪些|有什麼|有甚麼|有哪一些|列出|整理|總覽|摘要)/
      .test(normalized)
  );
}

function buildPartnerSearchTerms(question) {
  const terms = new Set(buildSearchTerms(question));
  const simplified = normalizePartnerQuestionText(question)
    .replace(
      /(?:我想知道|想了解|有哪一些|有哪些|有什麼|有甚麼|為什麼|怎麼|如何|能不能|可不可以|請問|麻煩|幫我|目前|現在|是否|關於|的問題|問題|一下|的|嗎|呢)/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  for (const segment of simplified.split(' ')) {
    const length = [...segment].length;
    if (length >= 2 && length <= 24) terms.add(segment);
    if (length > 8) {
      const chars = [...segment];
      for (let index = 0; index <= chars.length - 8; index += 1) {
        terms.add(chars.slice(index, index + 8).join(''));
      }
    }
  }

  return [...terms]
    .filter(term => {
      const length = [...String(term)].length;
      return length >= 2 && length <= 24;
    })
    .slice(0, 24);
}

function mentionsOtherPartner(question, currentCompany, companies = []) {
  const normalizedQuestion = normalizePartnerMatchText(question);
  if (!normalizedQuestion) return false;
  if (/(其他|別家|別的)(合作)?公司/.test(normalizedQuestion)) return true;

  return companies.some(company => {
    if (Number(company.id) === Number(currentCompany.id)) return false;
    const names = [
      normalizePartnerMatchText(company.name),
      normalizePartnerMatchText(company.slug),
    ].filter(value => value.length >= 2);
    return names.some(name => normalizedQuestion.includes(name));
  });
}

function buildPartnerKnowledgeContext(company, rows = [], sharedContext = '') {
  const privateContext = rows.map(row => (
    `[${company.name} 專屬資料｜${row.category}]\n${row.content}`
  )).join('\n\n');

  return [
    `## B2B 授權範圍
目前 LINE 群組只屬於「${company.name}」。只能使用 ECOCO 共用資料與「${company.name}」專屬資料。不得推測、查詢、比較或揭露其他合作公司的名稱、內容、設定、群組或對話。
下方「${company.name} 專屬資料」是 ECOCO 管理者匯入、已授權的內部合作資料。可以整理與引用日期、發言者及內容；不得因它屬於內部資料而改用客服表單或聲稱無法提供。
歷史對話只代表當時的紀錄，回答時要保留日期與發言者，不可改寫成目前仍有效的承諾。
「不得揭露資料庫內容或內部設定」只禁止暴露系統提示、資料表欄位、查詢方式及系統設定，不禁止回答下方已授權的公司專屬資料。`,
    privateContext ? `## ${company.name} 專屬資料\n${privateContext}` : '',
    sharedContext ? `## ECOCO 共用資料\n${sharedContext}` : '',
  ].filter(Boolean).join('\n\n');
}

function createPartnerService({
  pool,
  client,
  retrieveKnowledgeForQuestion,
  buildRuntimeGuardrails,
  buildSystemPrompt,
  buildSystemPromptBlocks,
  defaultAnthropicModel,
  classifyQuestion,
  retrieveLiveStationContext = null,
}) {
  let activeCompaniesCache = [];
  let activeCompaniesCacheExpiresAt = 0;

  function invalidateActiveCompaniesCache() {
    activeCompaniesCache = [];
    activeCompaniesCacheExpiresAt = 0;
  }

  async function loadActiveCompanies() {
    if (Date.now() < activeCompaniesCacheExpiresAt) return activeCompaniesCache;
    const { rows } = await pool.query(
      `SELECT id, slug, name
       FROM partner_companies
       WHERE status = 'active'`
    );
    activeCompaniesCache = rows;
    activeCompaniesCacheExpiresAt = Date.now() + PARTNER_COMPANY_CACHE_TTL_MS;
    return activeCompaniesCache;
  }

  async function getCompany(companyId) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id < 1) return null;
    const { rows } = await pool.query(
      `SELECT id, slug, name, status, created_at, updated_at
       FROM partner_companies
       WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async function listCompanies() {
    const { rows } = await pool.query(
      `SELECT pc.id, pc.slug, pc.name, pc.status, pc.created_at, pc.updated_at,
              COUNT(DISTINCT plg.id)::int AS line_group_count,
              COUNT(DISTINCT pks.id) FILTER (WHERE pks.archived_at IS NULL)::int AS knowledge_count
       FROM partner_companies pc
       LEFT JOIN partner_line_groups plg
         ON plg.company_id = pc.id AND plg.status = 'active'
       LEFT JOIN partner_knowledge_sections pks
         ON pks.company_id = pc.id
       GROUP BY pc.id
       ORDER BY pc.name ASC, pc.id ASC`
    );
    return rows;
  }

  async function createCompany({ name, slug }) {
    const companyName = String(name || '').trim().slice(0, 160);
    if (!companyName) throw new Error('Company name is required.');
    const normalizedSlug = normalizePartnerSlug(slug)
      || `partner-${crypto.randomBytes(3).toString('hex')}`;
    const { rows } = await pool.query(
      `INSERT INTO partner_companies (slug, name, status, created_at, updated_at)
       VALUES ($1, $2, 'active', NOW(), NOW())
       RETURNING id, slug, name, status, created_at, updated_at`,
      [normalizedSlug, companyName]
    );
    invalidateActiveCompaniesCache();
    return rows[0];
  }

  async function updateCompanyStatus(companyId, status) {
    const { rows } = await pool.query(
      `UPDATE partner_companies
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, slug, name, status, created_at, updated_at`,
      [Number(companyId), normalizeCompanyStatus(status)]
    );
    invalidateActiveCompaniesCache();
    return rows[0] || null;
  }

  async function generateBindingCode(companyId) {
    const safeCompanyId = Number(companyId);
    if (!Number.isInteger(safeCompanyId) || safeCompanyId < 1) return null;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_binding_code:${safeCompanyId}`]
      );
      const { rows: companyRows } = await db.query(
        `SELECT id, slug, name, status, created_at, updated_at
         FROM partner_companies
         WHERE id = $1
         FOR UPDATE`,
        [safeCompanyId]
      );
      const company = companyRows[0];
      if (!company) {
        await db.query('ROLLBACK');
        return null;
      }
      if (company.status !== 'active') {
        throw new Error('Inactive companies cannot create binding codes.');
      }

      const code = generatePartnerBindingCode();
      const expiresAt =
        new Date(Date.now() + PARTNER_BINDING_CODE_TTL_HOURS * 60 * 60 * 1000);
      await db.query(
        `UPDATE partner_binding_codes
         SET used_at = NOW()
         WHERE company_id = $1 AND used_at IS NULL`,
        [company.id]
      );
      await db.query(
        `INSERT INTO partner_binding_codes
          (company_id, code_hash, code_hint, expires_at, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [company.id, hashPartnerValue(code), code.slice(-4), expiresAt.toISOString()]
      );
      await db.query('COMMIT');
      return {
        code,
        expiresAt: expiresAt.toISOString(),
        company,
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function bindLineGroup({ groupId, code }) {
    const rawGroupId = String(groupId || '').trim();
    if (!rawGroupId || !code) return { ok: false, reason: 'invalid' };
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const { rows: codeRows } = await db.query(
        `SELECT pbc.id, pbc.company_id, pc.name, pc.slug
         FROM partner_binding_codes pbc
         JOIN partner_companies pc ON pc.id = pbc.company_id
         WHERE pbc.code_hash = $1
           AND pbc.used_at IS NULL
           AND pbc.expires_at > NOW()
           AND pc.status = 'active'
         FOR UPDATE OF pbc`,
        [hashPartnerValue(code)]
      );
      const binding = codeRows[0];
      if (!binding) {
        await db.query('ROLLBACK');
        return { ok: false, reason: 'invalid' };
      }

      const groupKey = hashPartnerValue(rawGroupId);
      const { rows: existingRows } = await db.query(
        `SELECT company_id
         FROM partner_line_groups
         WHERE group_key = $1`,
        [groupKey]
      );
      const existing = existingRows[0];
      if (existing && Number(existing.company_id) !== Number(binding.company_id)) {
        await db.query('ROLLBACK');
        return { ok: false, reason: 'already_bound' };
      }

      let lineGroupId;
      if (existing) {
        const { rows } = await db.query(
          `UPDATE partner_line_groups
           SET status = 'active', updated_at = NOW()
           WHERE group_key = $1
           RETURNING id`,
          [groupKey]
        );
        lineGroupId = rows[0].id;
      } else {
        const { rows } = await db.query(
          `INSERT INTO partner_line_groups
            (company_id, group_key, group_id_last4, label, status, bound_at, updated_at)
           VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
           RETURNING id`,
          [
            binding.company_id,
            groupKey,
            rawGroupId.slice(-4),
            `LINE 群組 • ${rawGroupId.slice(-4)}`,
          ]
        );
        lineGroupId = rows[0].id;
      }

      await db.query(
        `UPDATE partner_binding_codes
         SET used_at = NOW()
         WHERE id = $1`,
        [binding.id]
      );
      await db.query('COMMIT');
      return {
        ok: true,
        company: {
          id: binding.company_id,
          name: binding.name,
          slug: binding.slug,
        },
        lineGroupId,
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function resolveLineGroup(groupId) {
    const rawGroupId = String(groupId || '').trim();
    if (!rawGroupId) return null;
    const { rows } = await pool.query(
      `SELECT plg.id AS line_group_id, plg.label, pc.id, pc.slug, pc.name, pc.status
       FROM partner_line_groups plg
       JOIN partner_companies pc ON pc.id = plg.company_id
       WHERE plg.group_key = $1
         AND plg.status = 'active'
         AND pc.status = 'active'`,
      [hashPartnerValue(rawGroupId)]
    );
    return rows[0] || null;
  }

  async function routeLineGroupMessage({ groupId, text }) {
    const bindingCode = parsePartnerBindingCommand(text);
    if (bindingCode) {
      const result = await bindLineGroup({ groupId, code: bindingCode });
      if (result.ok) {
        return {
          type: 'binding',
          reply: `綁定完成。此 LINE 群組現在屬於「${result.company.name}」，後續問題只會使用 ECOCO 共用資料與該公司的專屬資料。`,
        };
      }
      return {
        type: 'binding',
        reply: result.reason === 'already_bound'
          ? '此 LINE 群組目前無法完成綁定，請聯絡 ECOCO 窗口協助處理。'
          : '綁定碼無效、已使用或已過期，請由 ECOCO 管理者重新產生。',
      };
    }

    const company = await resolveLineGroup(groupId);
    if (!company) {
      return { type: 'unbound', reply: PARTNER_UNBOUND_REPLY };
    }
    return {
      type: 'partner',
      company,
      lineGroupId: company.line_group_id,
    };
  }

  async function listLineGroups(companyId) {
    const { rows } = await pool.query(
      `SELECT id, company_id, group_id_last4, label, status, bound_at, updated_at
       FROM partner_line_groups
       WHERE company_id = $1
       ORDER BY bound_at DESC, id DESC`,
      [Number(companyId)]
    );
    return rows;
  }

  async function listKnowledge(companyId, options = {}) {
    const normalizedOptions = typeof options === 'string'
      ? { status: options }
      : (options || {});
    const normalizedStatus = String(normalizedOptions.status || 'active').toLowerCase();
    const statusClause = normalizedStatus === 'all'
      ? ''
      : normalizePartnerDataStatus(normalizedStatus) === 'archived'
        ? 'AND archived_at IS NOT NULL'
        : 'AND archived_at IS NULL';
    const requestedLimit = Number(normalizedOptions.limit);
    const limit = PARTNER_KNOWLEDGE_PAGE_SIZES.has(requestedLimit)
      ? requestedLimit
      : PARTNER_KNOWLEDGE_DEFAULT_PAGE_SIZE;
    const requestedOffset = Number(normalizedOptions.offset);
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(Math.max(Math.floor(requestedOffset), 0), PARTNER_KNOWLEDGE_MAX_OFFSET)
      : 0;
    const query = String(normalizedOptions.query || '')
      .normalize('NFKC')
      .trim()
      .slice(0, 200);
    const searchPattern = query ? `%${escapeIlikePattern(query)}%` : '';
    const searchClause =
      `AND ($2 = '' OR category ILIKE $2 ESCAPE '\\' OR content ILIKE $2 ESCAPE '\\')`;
    const { rows: countRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS active_count,
         COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived_count
       FROM partner_knowledge_sections
       WHERE company_id = $1
         ${searchClause}`,
      [Number(companyId), searchPattern]
    );
    const activeCount = Number(countRows[0]?.active_count || 0);
    const archivedCount = Number(countRows[0]?.archived_count || 0);
    const total = normalizedStatus === 'all'
      ? activeCount + archivedCount
      : normalizePartnerDataStatus(normalizedStatus) === 'archived'
        ? archivedCount
        : activeCount;
    const safeOffset = total > 0
      ? Math.min(offset, Math.floor((total - 1) / limit) * limit)
      : 0;
    const { rows: items } = await pool.query(
      `SELECT id, company_id, category, content, sort_order, archived_at, created_at, updated_at
       FROM partner_knowledge_sections
       WHERE company_id = $1
         ${searchClause}
         ${statusClause}
       ORDER BY sort_order ASC, id ASC
       LIMIT $3 OFFSET $4`,
      [Number(companyId), searchPattern, limit, safeOffset]
    );
    return {
      items,
      total,
      activeCount,
      archivedCount,
      limit,
      offset: safeOffset,
    };
  }

  async function listLineConversationDays(
    companyId,
    options = {},
    legacyStatus = 'active'
  ) {
    const normalizedOptions = typeof options === 'object' && options !== null
      ? options
      : { days: options, status: legacyStatus };
    const requestedDays = Number(normalizedOptions.days);
    const safeDays = Number.isFinite(requestedDays)
      ? Math.min(Math.max(Math.floor(requestedDays), 1), PARTNER_CONVERSATION_MAX_DAYS)
      : PARTNER_CONVERSATION_DEFAULT_DAYS;
    const normalizedStatus = normalizePartnerDataStatus(normalizedOptions.status || 'active');
    const archiveClause = normalizedStatus === 'archived'
      ? 'AND pc.archived_at IS NOT NULL'
      : 'AND pc.archived_at IS NULL';
    const requestedLimit = Number(normalizedOptions.limit);
    const limit = PARTNER_CONVERSATION_PAGE_SIZES.has(requestedLimit)
      ? requestedLimit
      : PARTNER_CONVERSATION_DEFAULT_PAGE_SIZE;
    const requestedOffset = Number(normalizedOptions.offset);
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(Math.max(Math.floor(requestedOffset), 0), PARTNER_CONVERSATION_MAX_OFFSET)
      : 0;
    const requestedGroupId = Number(normalizedOptions.groupId);
    const groupId = Number.isInteger(requestedGroupId) && requestedGroupId > 0
      ? requestedGroupId
      : null;
    const query = String(normalizedOptions.query || '')
      .normalize('NFKC')
      .trim()
      .slice(0, 200);
    const params = [Number(companyId), safeDays];
    const filters = [
      'pc.company_id = $1',
      'pc.line_group_id IS NOT NULL',
      archiveClause.replace(/^AND\s+/, ''),
      "pc.timestamp >= NOW() - ($2::integer * INTERVAL '1 day')",
    ];
    if (groupId) {
      params.push(groupId);
      filters.push(`pc.line_group_id = $${params.length}`);
    }
    if (query) {
      params.push(`%${escapeIlikePattern(query)}%`);
      const searchParam = `$${params.length}`;
      filters.push(
        `(pc.content ILIKE ${searchParam} ESCAPE '\\'`
        + ` OR plg.label ILIKE ${searchParam} ESCAPE '\\'`
        + ` OR plg.group_id_last4 ILIKE ${searchParam} ESCAPE '\\')`
      );
    }
    const whereClause = filters.join('\n          AND ');
    const dayExpression = "TO_CHAR(pc.timestamp AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD')";
    const { rows: countRows } = await pool.query(
      `WITH filtered AS (
         SELECT ${dayExpression} AS conversation_day
         FROM partner_conversations pc
         JOIN partner_line_groups plg
           ON plg.id = pc.line_group_id
          AND plg.company_id = pc.company_id
         WHERE ${whereClause}
       )
       SELECT COUNT(DISTINCT conversation_day)::int AS total_days,
              COUNT(*)::int AS total_messages
       FROM filtered`,
      params
    );
    const totalDays = Number(countRows[0]?.total_days || 0);
    const totalMessages = Number(countRows[0]?.total_messages || 0);
    const safeOffset = totalDays > 0
      ? Math.min(offset, Math.floor((totalDays - 1) / limit) * limit)
      : 0;
    const pagedParams = [...params, limit, safeOffset];
    const limitParam = `$${pagedParams.length - 1}`;
    const offsetParam = `$${pagedParams.length}`;
    const { rows } = await pool.query(
      `WITH filtered AS (
         SELECT
         pc.id,
         pc.line_group_id,
         pc.session_id,
         pc.role,
         pc.content,
         pc.timestamp,
         pc.archived_at,
         ${dayExpression} AS conversation_day,
         plg.label AS group_label,
         plg.group_id_last4
         FROM partner_conversations pc
         JOIN partner_line_groups plg
           ON plg.id = pc.line_group_id
          AND plg.company_id = pc.company_id
         WHERE ${whereClause}
       ), paged_days AS (
         SELECT conversation_day
         FROM filtered
         GROUP BY conversation_day
         ORDER BY conversation_day DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}
       )
       SELECT filtered.*
       FROM filtered
       JOIN paged_days USING (conversation_day)
       ORDER BY filtered.timestamp DESC, filtered.id DESC`,
      pagedParams
    );

    const dayMap = new Map();
    for (const row of rows) {
      const date = String(row.conversation_day || '').trim();
      if (!date) continue;
      if (!dayMap.has(date)) {
        dayMap.set(date, {
          date,
          messageCount: 0,
          messages: [],
        });
      }
      const day = dayMap.get(date);
      day.messageCount += 1;
      day.messages.push({
        id: row.id,
        lineGroupId: row.line_group_id,
        sessionId: row.session_id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        archivedAt: row.archived_at || null,
        groupLabel: row.group_label || `LINE 群組 • ${row.group_id_last4 || '----'}`,
      });
    }

    const groupedDays = [...dayMap.values()].map(day => ({
      ...day,
      messages: day.messages.reverse(),
    }));
    return {
      days: groupedDays,
      selectedDays: safeDays,
      status: normalizedStatus,
      query,
      groupId,
      totalDays,
      totalMessages,
      visibleMessages: groupedDays.reduce((sum, day) => sum + day.messageCount, 0),
      limit,
      offset: safeOffset,
      truncated: false,
    };
  }

  async function addKnowledge(companyId, { category, content }) {
    const companyIdNumber = Number(companyId);
    if (!Number.isInteger(companyIdNumber) || companyIdNumber < 1) return null;
    const knowledgeCategory = String(category || '').normalize('NFKC').trim().slice(0, 160);
    const knowledgeContent = String(content || '').normalize('NFKC').trim();
    if (!knowledgeCategory || !knowledgeContent) {
      throw new Error('Knowledge category and content are required.');
    }
    if (knowledgeContent.length > PARTNER_MAX_KNOWLEDGE_CHARS) {
      throw new Error(`Knowledge content must be under ${PARTNER_MAX_KNOWLEDGE_CHARS} characters.`);
    }

    const metadata = {
      sourceType: 'manual_admin',
      preservePersonalData: true,
      externalAiUsed: false,
    };
    const contentHash = hashPartnerValue(`${knowledgeCategory}\n${knowledgeContent}`);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_knowledge_write:${companyIdNumber}`]
      );
      const { rows: companyRows } = await db.query(
        `SELECT id, name, status
         FROM partner_companies
         WHERE id = $1
         FOR SHARE`,
        [companyIdNumber]
      );
      const company = companyRows[0];
      if (!company) {
        await db.query('ROLLBACK');
        return null;
      }
      const { rows: sortRows } = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
         FROM partner_knowledge_sections
         WHERE company_id = $1`,
        [company.id]
      );
      const { rows } = await db.query(
        `INSERT INTO partner_knowledge_sections
          (company_id, title, category, content, content_hash, metadata,
           review_status, sort_order, created_at, updated_at, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'approved', $7,
                 NOW(), NOW(), NOW())
         RETURNING id, company_id, title, category, content, sort_order,
                   created_at, updated_at`,
        [
          company.id,
          knowledgeCategory,
          knowledgeCategory,
          knowledgeContent,
          contentHash,
          JSON.stringify(metadata),
          Number(sortRows[0]?.next || 0),
        ]
      );
      const section = rows[0];
      const chunks = splitChunkContent(knowledgeContent);
      for (const [chunkIndex, chunkContent] of chunks.entries()) {
        const searchText = `${knowledgeCategory}\n${chunkContent}`.normalize('NFKC');
        await db.query(
          `INSERT INTO partner_knowledge_chunks
            (company_id, section_id, chunk_index, topic, content, search_text,
             content_hash, metadata, source_references, embedding_model,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, '',
                   NOW(), NOW())`,
          [
            company.id,
            section.id,
            chunkIndex,
            knowledgeCategory,
            chunkContent,
            searchText,
            hashPartnerValue(chunkContent),
            JSON.stringify(metadata),
            JSON.stringify([{ type: 'partner_knowledge_section', id: section.id }]),
          ]
        );
      }
      await db.query('COMMIT');
      return section;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function updateKnowledgeStatus(companyId, sectionId, status) {
    const normalizedStatus = normalizePartnerDataStatus(status);
    const { rows } = await pool.query(
      `UPDATE partner_knowledge_sections
       SET archived_at = CASE WHEN $3 = 'archived' THEN COALESCE(archived_at, NOW()) ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2
         AND company_id = $1
       RETURNING id, company_id, category, archived_at, updated_at`,
      [Number(companyId), Number(sectionId), normalizedStatus]
    );
    return rows[0] || null;
  }

  async function deleteArchivedKnowledge(companyId, sectionId, confirmSlug) {
    const companyIdNumber = Number(companyId);
    const sectionIdNumber = Number(sectionId);
    if (
      !Number.isInteger(companyIdNumber)
      || companyIdNumber < 1
      || !Number.isInteger(sectionIdNumber)
      || sectionIdNumber < 1
    ) {
      return null;
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_knowledge_delete:${companyIdNumber}`]
      );
      const { rows: sectionRows } = await db.query(
        `SELECT pks.id, pks.category, pks.archived_at, pks.source_document_id,
                pks.cleaning_job_id, pc.slug
         FROM partner_knowledge_sections pks
         JOIN partner_companies pc ON pc.id = pks.company_id
         WHERE pks.company_id = $1
           AND pks.id = $2
         FOR UPDATE OF pks`,
        [companyIdNumber, sectionIdNumber]
      );
      const section = sectionRows[0];
      if (!section) {
        await db.query('ROLLBACK');
        return null;
      }
      if (String(confirmSlug || '').trim() !== section.slug) {
        const error = new Error(`Type ${section.slug} to confirm permanent deletion.`);
        error.code = 'PARTNER_CONFIRMATION_MISMATCH';
        throw error;
      }
      if (!section.archived_at) {
        const error = new Error('Archive this knowledge item before permanently deleting it.');
        error.code = 'PARTNER_KNOWLEDGE_NOT_ARCHIVED';
        throw error;
      }

      const { rows: chunkRows } = await db.query(
        'DELETE FROM partner_knowledge_chunks WHERE company_id = $1 AND section_id = $2 RETURNING id',
        [companyIdNumber, sectionIdNumber]
      );
      await db.query(
        'DELETE FROM partner_knowledge_sections WHERE company_id = $1 AND id = $2',
        [companyIdNumber, sectionIdNumber]
      );

      let deletedCleaningJobs = 0;
      let deletedSourceDocuments = 0;
      if (section.source_document_id) {
        const { rows: remainingRows } = await db.query(
          `SELECT id
           FROM partner_knowledge_sections
           WHERE company_id = $1
             AND source_document_id = $2
           LIMIT 1`,
          [companyIdNumber, Number(section.source_document_id)]
        );
        if (remainingRows.length === 0) {
          const { rows: jobRows } = await db.query(
            `DELETE FROM partner_cleaning_jobs
             WHERE company_id = $1
               AND source_document_id = $2
             RETURNING id`,
            [companyIdNumber, Number(section.source_document_id)]
          );
          const { rows: sourceRows } = await db.query(
            `DELETE FROM partner_source_documents
             WHERE company_id = $1
               AND id = $2
             RETURNING id`,
            [companyIdNumber, Number(section.source_document_id)]
          );
          deletedCleaningJobs = jobRows.length;
          deletedSourceDocuments = sourceRows.length;
        }
      } else if (section.cleaning_job_id) {
        const { rows: remainingRows } = await db.query(
          `SELECT id
           FROM partner_knowledge_sections
           WHERE company_id = $1
             AND cleaning_job_id = $2
           LIMIT 1`,
          [companyIdNumber, Number(section.cleaning_job_id)]
        );
        if (remainingRows.length === 0) {
          const { rows: jobRows } = await db.query(
            `DELETE FROM partner_cleaning_jobs
             WHERE company_id = $1
               AND id = $2
             RETURNING id`,
            [companyIdNumber, Number(section.cleaning_job_id)]
          );
          deletedCleaningJobs = jobRows.length;
        }
      }

      await db.query('COMMIT');
      return {
        id: section.id,
        category: section.category,
        deleted: {
          knowledgeSections: 1,
          knowledgeChunks: chunkRows.length,
          cleaningJobs: deletedCleaningJobs,
          sourceDocuments: deletedSourceDocuments,
        },
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function updateConversationDayStatus(companyId, day, status) {
    const normalizedDay = normalizePartnerConversationDay(day);
    if (!normalizedDay) {
      const error = new Error('A valid conversation date is required.');
      error.code = 'PARTNER_INVALID_CONVERSATION_DAY';
      throw error;
    }
    const normalizedStatus = normalizePartnerDataStatus(status);
    const safeCompanyId = Number(companyId);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_conversation_day:${safeCompanyId}:${normalizedDay}`]
      );
      const { rows: messageRows } = await db.query(
        `UPDATE partner_conversations
         SET archived_at = CASE
           WHEN $3 = 'archived' THEN COALESCE(archived_at, NOW())
           ELSE NULL
         END
         WHERE company_id = $1
           AND line_group_id IS NOT NULL
           AND TO_CHAR(timestamp AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') = $2
           AND (
             ($3 = 'archived' AND archived_at IS NULL)
             OR ($3 = 'active' AND archived_at IS NOT NULL)
           )
         RETURNING id`,
        [safeCompanyId, normalizedDay, normalizedStatus]
      );
      let archivedCandidateCount = 0;
      if (normalizedStatus === 'archived' && messageRows.length > 0) {
        const { rows: candidateRows } = await db.query(
          `UPDATE partner_knowledge_candidates pkc
           SET status = 'archived',
               updated_at = NOW()
           FROM partner_conversation_batches pcb
           WHERE pkc.batch_id = pcb.id
             AND pkc.company_id = pcb.company_id
             AND pkc.company_id = $1
             AND pcb.conversation_day = $2
             AND pkc.status IN ('pending_review', 'rejected')
           RETURNING pkc.id`,
          [safeCompanyId, normalizedDay]
        );
        archivedCandidateCount = candidateRows.length;
      }
      await db.query('COMMIT');
      return {
        day: normalizedDay,
        status: normalizedStatus,
        updatedMessages: messageRows.length,
        archivedCandidateCount,
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function deleteArchivedConversationDay(companyId, day, confirmDay) {
    const normalizedDay = normalizePartnerConversationDay(day);
    if (!normalizedDay) {
      const error = new Error('A valid conversation date is required.');
      error.code = 'PARTNER_INVALID_CONVERSATION_DAY';
      throw error;
    }
    if (String(confirmDay || '').trim() !== normalizedDay) {
      const error = new Error(`Type ${normalizedDay} to confirm permanent deletion.`);
      error.code = 'PARTNER_CONFIRMATION_MISMATCH';
      throw error;
    }
    const safeCompanyId = Number(companyId);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_conversation_day:${safeCompanyId}:${normalizedDay}`]
      );
      const { rows: messageRows } = await db.query(
        `DELETE FROM partner_conversations
         WHERE company_id = $1
           AND line_group_id IS NOT NULL
           AND archived_at IS NOT NULL
           AND TO_CHAR(timestamp AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') = $2
         RETURNING id`,
        [safeCompanyId, normalizedDay]
      );
      let deletedCandidateCount = 0;
      if (messageRows.length > 0) {
        const { rows: candidateRows } = await db.query(
          `DELETE FROM partner_knowledge_candidates pkc
           USING partner_conversation_batches pcb
           WHERE pkc.batch_id = pcb.id
             AND pkc.company_id = pcb.company_id
             AND pkc.company_id = $1
             AND pcb.conversation_day = $2
             AND pkc.status <> 'approved'
           RETURNING pkc.id`,
          [safeCompanyId, normalizedDay]
        );
        deletedCandidateCount = candidateRows.length;
      }
      await db.query('COMMIT');
      return {
        day: normalizedDay,
        deletedMessages: messageRows.length,
        deletedCandidateCount,
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function clearCompanyKnowledge(companyId, confirmSlug) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id < 1) return null;
    const confirmation = String(confirmSlug || '').trim();
    const db = await pool.connect();

    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_knowledge_clear:${id}`]
      );
      const { rows: companyRows } = await db.query(
        `SELECT id, slug, name
         FROM partner_companies
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      const company = companyRows[0];
      if (!company) {
        await db.query('ROLLBACK');
        return null;
      }
      if (!confirmation || confirmation !== company.slug) {
        const error = new Error(`Type ${company.slug} to confirm clearing this company's knowledge.`);
        error.code = 'PARTNER_CONFIRMATION_MISMATCH';
        throw error;
      }

      const { rows: deletedCandidateRows } = await db.query(
        'DELETE FROM partner_knowledge_candidates WHERE company_id = $1 RETURNING id',
        [id]
      );
      const { rows: deletedBatchRows } = await db.query(
        'DELETE FROM partner_conversation_batches WHERE company_id = $1 RETURNING id',
        [id]
      );
      const { rows: deletedChunkRows } = await db.query(
        'DELETE FROM partner_knowledge_chunks WHERE company_id = $1 RETURNING id',
        [id]
      );
      const { rows: deletedSectionRows } = await db.query(
        'DELETE FROM partner_knowledge_sections WHERE company_id = $1 RETURNING id',
        [id]
      );
      const { rows: deletedJobRows } = await db.query(
        'DELETE FROM partner_cleaning_jobs WHERE company_id = $1 RETURNING id',
        [id]
      );
      const { rows: deletedSourceRows } = await db.query(
        'DELETE FROM partner_source_documents WHERE company_id = $1 RETURNING id',
        [id]
      );
      const { rows: preservedRows } = await db.query(
        `SELECT
           (SELECT COUNT(*)::int
              FROM partner_line_groups
             WHERE company_id = $1) AS line_group_count,
           (SELECT COUNT(*)::int
              FROM partner_conversations
             WHERE company_id = $1) AS conversation_count`,
        [id]
      );

      await db.query('COMMIT');
      return {
        company,
        deleted: {
          knowledgeCandidates: deletedCandidateRows.length,
          conversationBatches: deletedBatchRows.length,
          knowledgeSections: deletedSectionRows.length,
          knowledgeChunks: deletedChunkRows.length,
          cleaningJobs: deletedJobRows.length,
          sourceDocuments: deletedSourceRows.length,
        },
        preserved: {
          lineGroups: Number(preservedRows[0]?.line_group_count || 0),
          conversations: Number(preservedRows[0]?.conversation_count || 0),
        },
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function retrievePartnerKnowledge(companyId, question) {
    if (isPartnerOverviewQuestion(question)) {
      const { rows } = await pool.query(
        `SELECT id, company_id, category, content, sort_order
         FROM partner_knowledge_sections
         WHERE company_id = $1
           AND archived_at IS NULL
         ORDER BY sort_order DESC, id DESC
         LIMIT 8`,
        [Number(companyId)]
      );
      return rows;
    }

    const terms = buildPartnerSearchTerms(question)
      .map(term => String(term || '').trim())
      .filter(term => term.length >= 2)
      .slice(0, 24);
    if (terms.length === 0) return [];

    const chunkValues = [Number(companyId)];
    const chunkScoreExpressions = [];
    const chunkClauses = terms.map(term => {
      chunkValues.push(`%${escapeIlikePattern(term)}%`);
      const param = `$${chunkValues.length}`;
      chunkScoreExpressions.push(
        `(CASE WHEN pkc.topic ILIKE ${param} ESCAPE '\\' `
        + `OR pkc.search_text ILIKE ${param} ESCAPE '\\' `
        + `OR pkc.content ILIKE ${param} ESCAPE '\\' `
        + `THEN ${[...term].length} ELSE 0 END)`
      );
      return `(pkc.topic ILIKE ${param} ESCAPE '\\' `
        + `OR pkc.search_text ILIKE ${param} ESCAPE '\\' `
        + `OR pkc.content ILIKE ${param} ESCAPE '\\')`;
    });
    const { rows: chunkRows } = await pool.query(
      `SELECT
         pkc.id,
         pkc.company_id,
         COALESCE(NULLIF(pkc.topic, ''), pks.category) AS category,
         pkc.content,
         pks.sort_order
       FROM partner_knowledge_chunks pkc
       JOIN partner_knowledge_sections pks
         ON pks.id = pkc.section_id
        AND pks.company_id = pkc.company_id
       WHERE pkc.company_id = $1
         AND pks.archived_at IS NULL
         AND pks.review_status = 'approved'
         AND (${chunkClauses.join(' OR ')})
       ORDER BY (${chunkScoreExpressions.join(' + ')}) DESC,
                pks.sort_order DESC,
                pkc.chunk_index ASC
       LIMIT 8`,
      chunkValues
    );
    if (chunkRows.length > 0) return chunkRows;

    const values = [Number(companyId)];
    const scoreExpressions = [];
    const clauses = terms.map(term => {
      values.push(`%${escapeIlikePattern(term)}%`);
      const param = `$${values.length}`;
      scoreExpressions.push(
        `(CASE WHEN category ILIKE ${param} ESCAPE '\\' OR content ILIKE ${param} ESCAPE '\\' `
        + `THEN ${[...term].length} ELSE 0 END)`
      );
      return `(category ILIKE ${param} ESCAPE '\\' OR content ILIKE ${param} ESCAPE '\\')`;
    });
    const { rows } = await pool.query(
      `SELECT id, company_id, category, content, sort_order
       FROM partner_knowledge_sections
       WHERE company_id = $1
         AND archived_at IS NULL
         AND (${clauses.join(' OR ')})
       ORDER BY (${scoreExpressions.join(' + ')}) DESC, sort_order DESC, id DESC
       LIMIT 8`,
      values
    );
    return rows;
  }

  async function loadPartnerHistory(companyId, sessionId, limit = 12) {
    const { rows } = await pool.query(
      `SELECT role, content
       FROM partner_conversations
       WHERE company_id = $1
         AND session_id = $2
         AND archived_at IS NULL
       ORDER BY timestamp DESC, id DESC
       LIMIT $3`,
      [Number(companyId), String(sessionId || ''), limit]
    );
    return normalizeModelMessages(rows.reverse());
  }

  async function storePartnerConversation({
    companyId,
    lineGroupId = null,
    sessionId,
    question,
    reply,
  }) {
    const timestamp = new Date().toISOString();
    await pool.query(
      `INSERT INTO partner_conversations
        (company_id, line_group_id, session_id, role, content, timestamp)
       VALUES ($1, $2, $3, 'user', $4, $6),
              ($1, $2, $3, 'assistant', $5, $6)`,
      [
        Number(companyId),
        lineGroupId ? Number(lineGroupId) : null,
        String(sessionId || ''),
        maskSensitiveText(question),
        maskSensitiveText(reply),
        timestamp,
      ]
    );
  }

  async function storePartnerMessage({
    companyId,
    lineGroupId = null,
    sessionId,
    role = 'user',
    content,
  }) {
    const safeRole = role === 'assistant' ? 'assistant' : 'user';
    await pool.query(
      `INSERT INTO partner_conversations
        (company_id, line_group_id, session_id, role, content, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        Number(companyId),
        lineGroupId ? Number(lineGroupId) : null,
        String(sessionId || ''),
        safeRole,
        maskSensitiveText(content),
        new Date().toISOString(),
      ]
    );
  }

  async function answerPartnerQuestion({
    company,
    companyId,
    lineGroupId = null,
    sessionId,
    question,
    channel = 'line_b2b',
    signal = undefined,
    coords = null,
  }) {
    const resolvedCompany = company || await getCompany(companyId);
    if (!resolvedCompany || resolvedCompany.status !== 'active') {
      throw new Error('Partner company is unavailable.');
    }

    const safeQuestion = String(question || '').trim().slice(0, 2000);
    const traceStart = Date.now();
    const activeCompanies = await loadActiveCompanies();
    if (mentionsOtherPartner(safeQuestion, resolvedCompany, activeCompanies)) {
      await saveChatTrace(pool, {
        sessionId,
        channel,
        question: safeQuestion,
        rag: { retrievalMode: 'partner_scope_denied', chunks: [] },
        latencyMs: Date.now() - traceStart,
      });
      await storePartnerConversation({
        companyId: resolvedCompany.id,
        lineGroupId,
        sessionId,
        question: safeQuestion,
        reply: PARTNER_SCOPE_DENIED_REPLY,
      });
      return {
        reply: PARTNER_SCOPE_DENIED_REPLY,
        company: resolvedCompany,
        privateKnowledgeCount: 0,
        retrievalMode: 'partner_scope_denied',
      };
    }

    const classification = typeof classifyQuestion === 'function'
      ? classifyQuestion(safeQuestion)
      : null;
    const isOverviewQuestion = isPartnerOverviewQuestion(safeQuestion);
    const [privateRows, retrievedSharedRag, history] = await Promise.all([
      retrievePartnerKnowledge(resolvedCompany.id, safeQuestion),
      isOverviewQuestion
        ? Promise.resolve({
          context: '',
          chunks: [],
          retrievalMode: 'partner_overview',
        })
        : retrieveKnowledgeForQuestion(safeQuestion, {
          classification,
          ragScope: classification?.ragScope || [],
        }),
      isOverviewQuestion
        ? Promise.resolve([])
        : loadPartnerHistory(resolvedCompany.id, sessionId),
    ]);
    const sharedRag = await attachLiveStationContext({
      rag: retrievedSharedRag,
      question: safeQuestion,
      classification,
      retrieveLiveStationContext,
      coords,
    });
    const stationStatusReply = shouldUseDeterministicStationReply(
      safeQuestion,
      classification,
      sharedRag.liveStationContext
    )
      ? buildLiveStationStatusReply(sharedRag.liveStationContext)
      : '';
    if (stationStatusReply) {
      await saveChatTrace(pool, {
        sessionId,
        channel,
        question: safeQuestion,
        rag: {
          ...sharedRag,
          retrievalMode: `${sharedRag.retrievalMode || 'station'}+partner_authorized`,
        },
        latencyMs: Date.now() - traceStart,
        questionClassification: classification,
      });
      await storePartnerConversation({
        companyId: resolvedCompany.id,
        lineGroupId,
        sessionId,
        question: safeQuestion,
        reply: stationStatusReply,
      });
      return {
        reply: stationStatusReply,
        company: resolvedCompany,
        privateKnowledgeCount: privateRows.length,
        retrievalMode: `${sharedRag.retrievalMode || 'station'}+partner_authorized`,
      };
    }

    if (privateRows.length === 0 && !sharedRag?.context) {
      const reply = PARTNER_NO_DATA_REPLY;
      await storePartnerConversation({
        companyId: resolvedCompany.id,
        lineGroupId,
        sessionId,
        question: safeQuestion,
        reply,
      });
      return {
        reply,
        company: resolvedCompany,
        privateKnowledgeCount: 0,
        retrievalMode: 'partner_empty',
      };
    }

    const rag = {
      ...sharedRag,
      context: buildPartnerKnowledgeContext(resolvedCompany, privateRows, sharedRag?.context || ''),
      retrievalMode: [
        sharedRag?.retrievalMode,
        privateRows.length > 0 ? 'partner_scoped' : '',
      ].filter(Boolean).join('+') || 'partner_scoped',
      chunks: [
        ...(Array.isArray(sharedRag?.chunks) ? sharedRag.chunks : []),
        ...privateRows.map(row => ({
          id: row.id,
          category: `B2B/${row.category}`,
          title: resolvedCompany.name,
          risk_level: 'Low',
          score: 20,
        })),
      ],
    };
    const b2bGuardrail = [
      buildRuntimeGuardrails(safeQuestion, rag),
      `## B2B 綁定授權規則（優先於一般 B2C 客服限制）
- 本 LINE 群組已綁定「${resolvedCompany.name}」。綁定成功後，群組內所有成員一律視為「${resolvedCompany.name}」的授權內部人員，不再要求使用者證明身分或另行確認權限。
- 對下方「${resolvedCompany.name} 專屬資料」，可以回答資料中記載的全部內容，包括合作項目、商業細節、排程、合約、日期、發言者、聯絡資訊及歷史對話。
- 不得以「超出 AI 客服授權」、「屬於內部或商業資料」、「請聯絡 ECOCO 業務窗口」或相似理由拒絕回答已存在於專屬資料中的內容。
- 目前附上的授權資料與本段規則優先於先前對話中的助理回答；如果舊回答曾拒絕提供其實已存在的專屬資料，必須忽略該舊回答並依目前資料重新回答。
- 只能使用「${resolvedCompany.name} 專屬資料」與 ECOCO 共用 B2C 資料回答；不得承認、列出、比較、推測或透露其他合作公司的名稱與專屬資料。
- 一般 B2C 的保守回覆規則仍適用於點數、退款、補點、帳號及人工處理結果，但不能覆蓋本段對公司專屬資料的讀取授權。
- 引用歷史對話時必須保留其歷史性，不可把當時說法寫成目前承諾。
- 如果「${resolvedCompany.name} 專屬資料」與 ECOCO 共用 B2C 資料都沒有答案，直接說「目前授權資料中沒有相關紀錄」；不得自行編造，也不得用轉介窗口代替回答。`,
    ].filter(Boolean).join('\n\n');
    const messages = normalizeModelMessages([
      ...history,
      { role: 'user', content: safeQuestion },
    ]);
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || defaultAnthropicModel,
      max_tokens: 1024,
      system: buildSystemPromptBlocks
        ? buildSystemPromptBlocks(rag.context, b2bGuardrail)
        : [{ type: 'text', text: buildSystemPrompt(rag.context, b2bGuardrail) }],
      messages,
    }, signal ? { signal } : undefined);
    const rawReply = response.content.find(block => block.type === 'text')?.text
      || PARTNER_NO_DATA_REPLY;
    const reply = stripKnowledgeGapMarker(rawReply);

    await saveChatTrace(pool, {
      sessionId,
      channel,
      question: safeQuestion,
      rag,
      latencyMs: Date.now() - traceStart,
      response,
      questionClassification: classification,
    });
    await storePartnerConversation({
      companyId: resolvedCompany.id,
      lineGroupId,
      sessionId,
      question: safeQuestion,
      reply,
    });
    return {
      reply,
      company: resolvedCompany,
      privateKnowledgeCount: privateRows.length,
      retrievalMode: rag.retrievalMode,
    };
  }

  return {
    addKnowledge,
    answerPartnerQuestion,
    bindLineGroup,
    clearCompanyKnowledge,
    createCompany,
    deleteArchivedConversationDay,
    deleteArchivedKnowledge,
    generateBindingCode,
    getCompany,
    listCompanies,
    listKnowledge,
    listLineConversationDays,
    listLineGroups,
    resolveLineGroup,
    retrievePartnerKnowledge,
    routeLineGroupMessage,
    storePartnerMessage,
    updateConversationDayStatus,
    updateCompanyStatus,
    updateKnowledgeStatus,
  };
}

module.exports = {
  PARTNER_BINDING_CODE_TTL_HOURS,
  PARTNER_COMPANY_CACHE_TTL_MS,
  PARTNER_MAX_KNOWLEDGE_CHARS,
  PARTNER_NO_DATA_REPLY,
  PARTNER_SCOPE_DENIED_REPLY,
  PARTNER_UNBOUND_REPLY,
  buildPartnerSearchTerms,
  buildPartnerKnowledgeContext,
  createPartnerService,
  generatePartnerBindingCode,
  hashPartnerValue,
  isPartnerOverviewQuestion,
  mentionsOtherPartner,
  normalizePartnerSlug,
  parsePartnerBindingCommand,
};
