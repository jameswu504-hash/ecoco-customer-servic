const crypto = require('crypto');
const {
  attachLiveStationContext,
  buildLiveStationStatusReply,
  normalizeModelMessages,
  shouldUseDeterministicStationReply,
  stripKnowledgeGapMarker,
} = require('../routes/chat.routes');
const { buildSearchTerms, escapeIlikePattern } = require('./rag.service');
const { maskSensitiveText } = require('./privacy.service');
const { saveChatTrace } = require('./trace.service');

const PARTNER_BINDING_CODE_TTL_HOURS = 24;
const PARTNER_MAX_KNOWLEDGE_CHARS = 20_000;
const PARTNER_UNBOUND_REPLY = '此 LINE 群組尚未綁定 ECOCO 合作夥伴。請由 ECOCO 管理者建立公司並產生一次性綁定碼。';
const PARTNER_NO_DATA_REPLY = companyName => `目前「${companyName}」尚未匯入可用的合作資料，請先由 ECOCO 管理者新增公司專屬知識後再測試。`;
const PARTNER_SCOPE_DENIED_REPLY = '此群組只能查詢所屬公司的合作資料，無法查詢、比較或透露其他公司的內容。';

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
  return String(value || '').toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

function normalizePartnerMatchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
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
    `## B2B 授權範圍\n目前 LINE 群組只屬於「${company.name}」。只能使用 ECOCO 共用資料與「${company.name}」專屬資料。不得推測、查詢、比較或揭露其他合作公司的名稱、內容、設定、群組或對話。`,
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
    return rows[0] || null;
  }

  async function generateBindingCode(companyId) {
    const company = await getCompany(companyId);
    if (!company) return null;
    if (company.status !== 'active') throw new Error('Inactive companies cannot create binding codes.');

    const code = generatePartnerBindingCode();
    const expiresAt = new Date(Date.now() + PARTNER_BINDING_CODE_TTL_HOURS * 60 * 60 * 1000);
    await pool.query(
      `UPDATE partner_binding_codes
       SET used_at = NOW()
       WHERE company_id = $1 AND used_at IS NULL`,
      [company.id]
    );
    await pool.query(
      `INSERT INTO partner_binding_codes
        (company_id, code_hash, code_hint, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [company.id, hashPartnerValue(code), code.slice(-4), expiresAt.toISOString()]
    );
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      company,
    };
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
          ? '此 LINE 群組已綁定其他合作公司，請由 ECOCO 管理者先停用原綁定。'
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

  async function listKnowledge(companyId) {
    const { rows } = await pool.query(
      `SELECT id, company_id, category, content, sort_order, created_at, updated_at
       FROM partner_knowledge_sections
       WHERE company_id = $1 AND archived_at IS NULL
       ORDER BY sort_order ASC, id ASC`,
      [Number(companyId)]
    );
    return rows;
  }

  async function addKnowledge(companyId, { category, content }) {
    const company = await getCompany(companyId);
    if (!company) return null;
    const cleanCategory = String(category || '').trim().slice(0, 160);
    const cleanContent = String(content || '').trim();
    if (!cleanCategory || !cleanContent) throw new Error('Knowledge category and content are required.');
    if (cleanContent.length > PARTNER_MAX_KNOWLEDGE_CHARS) {
      throw new Error(`Knowledge content must be under ${PARTNER_MAX_KNOWLEDGE_CHARS} characters.`);
    }
    const { rows: sortRows } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM partner_knowledge_sections
       WHERE company_id = $1`,
      [company.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO partner_knowledge_sections
        (company_id, category, content, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, company_id, category, content, sort_order, created_at, updated_at`,
      [company.id, cleanCategory, cleanContent, Number(sortRows[0].next || 0)]
    );
    return rows[0];
  }

  async function retrievePartnerKnowledge(companyId, question) {
    const terms = buildSearchTerms(question)
      .map(term => String(term || '').trim())
      .filter(term => term.length >= 2)
      .slice(0, 8);
    if (terms.length === 0) return [];

    const values = [Number(companyId)];
    const clauses = terms.map(term => {
      values.push(`%${escapeIlikePattern(term)}%`);
      const param = `$${values.length}`;
      return `(category ILIKE ${param} ESCAPE '\\' OR content ILIKE ${param} ESCAPE '\\')`;
    });
    const { rows } = await pool.query(
      `SELECT id, company_id, category, content, sort_order
       FROM partner_knowledge_sections
       WHERE company_id = $1
         AND archived_at IS NULL
         AND (${clauses.join(' OR ')})
       ORDER BY sort_order ASC, id ASC
       LIMIT 8`,
      values
    );
    return rows;
  }

  async function loadPartnerHistory(companyId, sessionId, limit = 12) {
    const { rows } = await pool.query(
      `SELECT role, content
       FROM partner_conversations
       WHERE company_id = $1 AND session_id = $2
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

  async function answerPartnerQuestion({
    company,
    companyId,
    lineGroupId = null,
    sessionId,
    question,
    channel = 'line_b2b',
    signal = undefined,
  }) {
    const resolvedCompany = company || await getCompany(companyId);
    if (!resolvedCompany || resolvedCompany.status !== 'active') {
      throw new Error('Partner company is unavailable.');
    }

    const safeQuestion = String(question || '').trim().slice(0, 2000);
    const traceStart = Date.now();
    const { rows: activeCompanies } = await pool.query(
      `SELECT id, slug, name
       FROM partner_companies
       WHERE status = 'active'`
    );
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
    const [privateRows, retrievedSharedRag, history] = await Promise.all([
      retrievePartnerKnowledge(resolvedCompany.id, safeQuestion),
      retrieveKnowledgeForQuestion(safeQuestion, {
        classification,
        ragScope: classification?.ragScope || [],
      }),
      loadPartnerHistory(resolvedCompany.id, sessionId),
    ]);
    const sharedRag = await attachLiveStationContext({
      rag: retrievedSharedRag,
      question: safeQuestion,
      classification,
      retrieveLiveStationContext,
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
      const reply = PARTNER_NO_DATA_REPLY(resolvedCompany.name);
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
      `## B2B 公司隔離規則
你只能回答目前授權公司「${resolvedCompany.name}」的問題。
不得承認、列出、比較或透露其他合作公司的資料。
如果授權資料沒有答案，直接說目前沒有可確認資料，不得用其他公司資訊或自行推測。`,
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
      || PARTNER_NO_DATA_REPLY(resolvedCompany.name);
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
    createCompany,
    generateBindingCode,
    getCompany,
    listCompanies,
    listKnowledge,
    listLineGroups,
    resolveLineGroup,
    retrievePartnerKnowledge,
    routeLineGroupMessage,
    updateCompanyStatus,
  };
}

module.exports = {
  PARTNER_BINDING_CODE_TTL_HOURS,
  PARTNER_MAX_KNOWLEDGE_CHARS,
  PARTNER_SCOPE_DENIED_REPLY,
  PARTNER_UNBOUND_REPLY,
  buildPartnerKnowledgeContext,
  createPartnerService,
  generatePartnerBindingCode,
  hashPartnerValue,
  mentionsOtherPartner,
  normalizePartnerSlug,
  parsePartnerBindingCommand,
};
