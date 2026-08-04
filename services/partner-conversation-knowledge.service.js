const crypto = require('crypto');

const SKILL_NAME = 'ecoco-clean-brand-knowledge';
const SKILL_VERSION = '1.3.0';
const MAX_GENERATION_DAYS = 7;
const MAX_SOURCE_MESSAGES = 2_000;
const MAX_CANDIDATE_CONTENT = 12_000;
const REVIEW_STATUSES = new Set(['pending_review', 'approved', 'rejected', 'archived']);

const NOISE_PATTERN = /^(?:哈囉|嗨|hello|hi|早安|午安|晚安|謝謝|感謝|收到|ok|okay|好的|了解|辛苦了|測試)[!！,.，。?？~～\s]*$/i;
const ATTACHMENT_PATTERN = /^\[(?:照片|貼圖|檔案|影片|語音訊息)\]$/;
const ASSISTANT_ERROR_PATTERN = /(?:系統忙碌|稍後再試|目前無法回覆|quota|rate limit|429|服務暫時無法使用)/i;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function normalizeDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return 1;
  return Math.min(Math.max(Math.floor(days), 1), MAX_GENERATION_DAYS);
}

function normalizeReviewStatus(value) {
  const status = String(value || 'pending_review').trim().toLowerCase();
  return REVIEW_STATUSES.has(status) ? status : 'pending_review';
}

function isNoiseMessage(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return !text || ATTACHMENT_PATTERN.test(text) || NOISE_PATTERN.test(text);
}

function detectCategory(value) {
  const text = String(value || '');
  if (/派工|工單|維修|報修/.test(text)) return '派工與維修';
  if (/清運|滿桶|回收槽|容量/.test(text)) return '清運與容量';
  if (/離線|故障|異常|設備|機台|連線/.test(text)) return '設備狀態';
  if (/站點|門市|地址|據點/.test(text)) return '站點資訊';
  if (/合約|報價|費用|付款|請款/.test(text)) return '商務合作';
  if (/活動|點數|兌換|優惠/.test(text)) return '活動與點數';
  return '一般合作事項';
}

function detectRiskFlags(value) {
  const text = String(value || '');
  const flags = [];
  if (/報價|費用|金額|付款|請款|合約/.test(text)) flags.push('commercial_terms');
  if (/今天|明天|本週|下週|日期|期限|截止|排程|活動/.test(text)) flags.push('time_sensitive');
  if (/狀態|離線|故障|異常|容量|滿桶|清運|派工/.test(text)) {
    flags.push('operational_status');
  }
  return flags;
}

function buildCandidateTitle(question, category) {
  const firstLine = String(question || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) || category;
  const compact = firstLine.replace(/\s+/g, ' ');
  return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
}

function splitChunkContent(value, limit = 1_800) {
  const chunks = [];
  let remaining = String(value || '').trim();
  while (remaining.length > limit) {
    const candidates = [
      remaining.lastIndexOf('\n\n', limit),
      remaining.lastIndexOf('\n', limit),
      remaining.lastIndexOf('。', limit),
    ];
    let cutAt = Math.max(...candidates);
    if (cutAt < Math.floor(limit * 0.45)) cutAt = limit;
    if (remaining[cutAt] === '。') cutAt += 1;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function buildCandidate({
  companyId,
  lineGroupId,
  conversationDay,
  groupLabel,
  userMessages,
  assistantMessage,
}) {
  const question = userMessages.map(message => message.content).join('\n').trim();
  const answer = String(assistantMessage?.content || '').trim();
  const category = detectCategory(`${question}\n${answer}`);
  const riskFlags = detectRiskFlags(`${question}\n${answer}`);
  const sourceMessageIds = [
    ...userMessages.map(message => Number(message.id)),
    ...(assistantMessage ? [Number(assistantMessage.id)] : []),
  ].filter(Number.isInteger);
  const content = [
    `# ${buildCandidateTitle(question, category)}`,
    '',
    `[來源日期] ${conversationDay}`,
    `[來源群組] ${groupLabel}`,
    '',
    '## 問題或討論',
    question,
    '',
    '## LINE 回覆',
    answer || '尚無回覆；核准前請由 PM 或營運補充正確結論。',
  ].join('\n').trim().slice(0, MAX_CANDIDATE_CONTENT);
  const todos = userMessages
    .map(message => message.content)
    .filter(text => /請|需要|協助|確認|追蹤|派工|清運|處理/.test(text))
    .slice(0, 20);
  // LINE replies are evidence for human review, not verified facts by themselves.
  const pendingItems = [question];
  const contentHash = sha256(JSON.stringify({
    companyId,
    lineGroupId,
    conversationDay,
    sourceMessageIds,
    content,
  }));

  return {
    title: buildCandidateTitle(question, category),
    category: `LINE 待審｜${category}`,
    content,
    summary: answer
      ? `${question.slice(0, 180)} → ${answer.slice(0, 260)}`
      : `${question.slice(0, 360)}（尚待回覆）`,
    facts: [],
    pendingItems,
    todos,
    sourceMessageIds,
    riskFlags,
    contentHash,
  };
}

function buildCandidatesForConversationGroup({
  companyId,
  lineGroupId,
  conversationDay,
  groupLabel,
  messages,
}) {
  const candidates = [];
  const pendingUsers = [];
  let skippedNoise = 0;
  let skippedAssistantErrors = 0;

  for (const message of messages) {
    const content = String(message.content || '').trim();
    if (isNoiseMessage(content)) {
      skippedNoise += 1;
      continue;
    }
    if (message.role !== 'assistant') {
      pendingUsers.push({ ...message, content });
      continue;
    }
    if (ASSISTANT_ERROR_PATTERN.test(content)) {
      skippedAssistantErrors += 1;
      continue;
    }
    if (pendingUsers.length === 0) continue;
    candidates.push(buildCandidate({
      companyId,
      lineGroupId,
      conversationDay,
      groupLabel,
      userMessages: pendingUsers.splice(0),
      assistantMessage: { ...message, content },
    }));
  }

  if (pendingUsers.length > 0) {
    candidates.push(buildCandidate({
      companyId,
      lineGroupId,
      conversationDay,
      groupLabel,
      userMessages: pendingUsers,
      assistantMessage: null,
    }));
  }

  return {
    candidates,
    skippedNoise,
    skippedAssistantErrors,
  };
}

function createPartnerConversationKnowledgeService({ pool }) {
  async function listCandidates(companyId, status = 'pending_review') {
    const safeCompanyId = normalizeId(companyId);
    if (!safeCompanyId) return [];
    const safeStatus = normalizeReviewStatus(status);
    const { rows } = await pool.query(
      `SELECT
         pkc.id,
         pkc.company_id,
         pkc.batch_id,
         pkc.title,
         pkc.category,
         pkc.content,
         pkc.summary,
         pkc.facts,
         pkc.pending_items,
         pkc.todos,
         pkc.source_message_ids,
         pkc.risk_flags,
         pkc.status,
         pkc.reviewed_by,
         pkc.reviewed_at,
         pkc.approved_section_id,
         pkc.revision_of_candidate_id,
         pkc.revision_number,
         pkc.created_at,
         pkc.updated_at,
         pcb.conversation_day,
         pcb.line_group_id,
         COALESCE(NULLIF(plg.label, ''), 'LINE 群組 • ' || plg.group_id_last4) AS group_label,
         pcb.skill_name,
         pcb.skill_version
       FROM partner_knowledge_candidates pkc
       JOIN partner_conversation_batches pcb
         ON pcb.id = pkc.batch_id
        AND pcb.company_id = pkc.company_id
       LEFT JOIN partner_line_groups plg
         ON plg.id = pcb.line_group_id
        AND plg.company_id = pkc.company_id
       WHERE pkc.company_id = $1
         AND pkc.status = $2
       ORDER BY pcb.conversation_day DESC, pkc.id DESC
       LIMIT 300`,
      [safeCompanyId, safeStatus]
    );
    return rows;
  }

  async function generateCandidates(companyId, days = 1) {
    const safeCompanyId = normalizeId(companyId);
    if (!safeCompanyId) throw new Error('A valid partner company is required.');
    const safeDays = normalizeDays(days);
    const { rows } = await pool.query(
      `SELECT recent.*
       FROM (
         SELECT
           pc.id,
           pc.line_group_id,
           pc.role,
           pc.content,
           pc.timestamp,
           TO_CHAR(pc.timestamp AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS conversation_day,
           COALESCE(NULLIF(plg.label, ''), 'LINE 群組 • ' || plg.group_id_last4) AS group_label,
           COUNT(*) OVER() AS total_source_count
         FROM partner_conversations pc
         JOIN partner_line_groups plg
           ON plg.id = pc.line_group_id
          AND plg.company_id = pc.company_id
         WHERE pc.company_id = $1
           AND pc.line_group_id IS NOT NULL
           AND pc.archived_at IS NULL
           AND (pc.timestamp AT TIME ZONE 'Asia/Taipei')::date
               >= (NOW() AT TIME ZONE 'Asia/Taipei')::date - ($2::integer - 1)
         ORDER BY pc.timestamp DESC, pc.id DESC
         LIMIT $3
       ) recent
       ORDER BY recent.line_group_id ASC, recent.conversation_day ASC,
                recent.timestamp ASC, recent.id ASC`,
      [safeCompanyId, safeDays, MAX_SOURCE_MESSAGES]
    );
    const truncated = Number(rows[0]?.total_source_count || 0) > MAX_SOURCE_MESSAGES;

    const groups = new Map();
    for (const row of rows) {
      const key = `${row.line_group_id}:${row.conversation_day}`;
      if (!groups.has(key)) {
        groups.set(key, {
          companyId: safeCompanyId,
          lineGroupId: Number(row.line_group_id),
          conversationDay: row.conversation_day,
          groupLabel: row.group_label,
          messages: [],
        });
      }
      groups.get(key).messages.push(row);
    }

    const db = await pool.connect();
    let createdBatchCount = 0;
    let createdCandidateCount = 0;
    let duplicateCandidateCount = 0;
    let skippedNoiseCount = 0;
    let skippedAssistantErrorCount = 0;
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_conversation_candidates:${safeCompanyId}`]
      );

      for (const group of groups.values()) {
        const sourceHash = sha256(JSON.stringify(group.messages.map(message => ({
          id: Number(message.id),
          role: message.role,
          content: message.content,
        }))));
        const cleaned = buildCandidatesForConversationGroup(group);
        skippedNoiseCount += cleaned.skippedNoise;
        skippedAssistantErrorCount += cleaned.skippedAssistantErrors;
        const report = {
          sourceMessageCount: group.messages.length,
          generatedCandidateCount: cleaned.candidates.length,
          skippedNoiseCount: cleaned.skippedNoise,
          skippedAssistantErrorCount: cleaned.skippedAssistantErrors,
          externalAiUsed: false,
          rawContentUploaded: false,
        };
        const { rows: batchRows } = await db.query(
          `INSERT INTO partner_conversation_batches
            (company_id, line_group_id, conversation_day, status, skill_name,
             skill_version, source_message_count, content_hash, report,
             created_at, completed_at, updated_at)
           VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8::jsonb,
                   NOW(), NOW(), NOW())
           ON CONFLICT (company_id, line_group_id, conversation_day, content_hash)
           DO NOTHING
           RETURNING id`,
          [
            safeCompanyId,
            group.lineGroupId,
            group.conversationDay,
            SKILL_NAME,
            SKILL_VERSION,
            group.messages.length,
            sourceHash,
            JSON.stringify(report),
          ]
        );
        let batchId = Number(batchRows[0]?.id || 0);
        if (batchId) {
          createdBatchCount += 1;
        } else {
          const { rows: existingBatchRows } = await db.query(
            `SELECT id
             FROM partner_conversation_batches
             WHERE company_id = $1
               AND line_group_id = $2
               AND conversation_day = $3
               AND content_hash = $4
             LIMIT 1`,
            [safeCompanyId, group.lineGroupId, group.conversationDay, sourceHash]
          );
          batchId = Number(existingBatchRows[0]?.id || 0);
        }
        if (!batchId) throw new Error('Failed to create or find the conversation batch.');

        for (const candidate of cleaned.candidates) {
          const { rows: candidateRows } = await db.query(
            `INSERT INTO partner_knowledge_candidates
              (company_id, batch_id, line_group_id, title, category, content,
               summary, facts, pending_items, todos, source_message_ids,
               risk_flags, content_hash, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
                     $10::jsonb, $11::jsonb, $12::jsonb, $13,
                     'pending_review', NOW(), NOW())
             ON CONFLICT (company_id, content_hash) DO NOTHING
             RETURNING id`,
            [
              safeCompanyId,
              batchId,
              group.lineGroupId,
              candidate.title,
              candidate.category,
              candidate.content,
              candidate.summary,
              JSON.stringify(candidate.facts),
              JSON.stringify(candidate.pendingItems),
              JSON.stringify(candidate.todos),
              JSON.stringify(candidate.sourceMessageIds),
              JSON.stringify(candidate.riskFlags),
              candidate.contentHash,
            ]
          );
          if (candidateRows[0]) createdCandidateCount += 1;
          else duplicateCandidateCount += 1;
        }
      }

      await db.query('COMMIT');
      return {
        companyId: safeCompanyId,
        selectedDays: safeDays,
        sourceMessageCount: rows.length,
        processedGroupDays: groups.size,
        createdBatchCount,
        createdCandidateCount,
        duplicateCandidateCount,
        skippedNoiseCount,
        skippedAssistantErrorCount,
        truncated,
        skill: {
          name: SKILL_NAME,
          version: SKILL_VERSION,
          externalAiUsed: false,
        },
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function createCandidateRevision(companyId, candidateId) {
    const safeCompanyId = normalizeId(companyId);
    const safeCandidateId = normalizeId(candidateId);
    if (!safeCompanyId || !safeCandidateId) return null;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_candidate_revision:${safeCompanyId}:${safeCandidateId}`]
      );
      const { rows } = await db.query(
        `SELECT pkc.*
         FROM partner_knowledge_candidates pkc
         WHERE pkc.company_id = $1
           AND pkc.id = $2
         FOR UPDATE`,
        [safeCompanyId, safeCandidateId]
      );
      const candidate = rows[0];
      if (!candidate) {
        await db.query('ROLLBACK');
        return null;
      }
      if (candidate.status !== 'approved' || !candidate.approved_section_id) {
        const error = new Error('Only approved knowledge can create a revision.');
        error.code = 'PARTNER_CANDIDATE_REVISION_REQUIRES_APPROVAL';
        throw error;
      }
      const { rows: revisionRows } = await db.query(
        `SELECT COALESCE(MAX(revision_number), $3::integer) + 1 AS next
         FROM partner_knowledge_candidates
         WHERE company_id = $1
           AND (id = $2 OR revision_of_candidate_id = $2)`,
        [safeCompanyId, safeCandidateId, Number(candidate.revision_number || 1)]
      );
      const revisionNumber = Number(revisionRows[0]?.next || 2);
      const revisionHash = sha256(
        `${candidate.content_hash}:${safeCandidateId}:${revisionNumber}:${crypto.randomUUID()}`
      );
      const { rows: createdRows } = await db.query(
        `INSERT INTO partner_knowledge_candidates
          (company_id, revision_of_candidate_id, revision_number, batch_id,
           line_group_id, title, category, content, summary, facts,
           pending_items, todos, source_message_ids, risk_flags, content_hash,
           status, reviewed_by, reviewed_at, approved_section_id,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                 $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15,
                 'pending_review', '', NULL, NULL, NOW(), NOW())
         RETURNING *`,
        [
          safeCompanyId,
          safeCandidateId,
          revisionNumber,
          Number(candidate.batch_id),
          Number(candidate.line_group_id),
          candidate.title,
          candidate.category,
          candidate.content,
          candidate.summary || '',
          JSON.stringify(candidate.facts || []),
          JSON.stringify(candidate.pending_items || []),
          JSON.stringify(candidate.todos || []),
          JSON.stringify(candidate.source_message_ids || []),
          JSON.stringify(candidate.risk_flags || []),
          revisionHash,
        ]
      );
      await db.query('COMMIT');
      return { candidate: createdRows[0] };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  async function reviewCandidate(companyId, candidateId, payload = {}) {
    const safeCompanyId = normalizeId(companyId);
    const safeCandidateId = normalizeId(candidateId);
    if (!safeCompanyId || !safeCandidateId) return null;
    const rawStatus = String(payload.status || '').trim().toLowerCase();
    if (!REVIEW_STATUSES.has(rawStatus)) {
      const error = new Error('A valid candidate review status is required.');
      error.code = 'PARTNER_INVALID_CANDIDATE_STATUS';
      throw error;
    }
    const requestedStatus = rawStatus;
    const titleInput = String(payload.title || '').trim().slice(0, 180);
    const categoryInput = String(payload.category || '').trim().slice(0, 160);
    const contentInput = String(payload.content || '').trim().slice(0, MAX_CANDIDATE_CONTENT);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_candidate_review:${safeCompanyId}:${safeCandidateId}`]
      );
      const { rows } = await db.query(
        `SELECT pkc.*, pcb.conversation_day, pcb.skill_name, pcb.skill_version
         FROM partner_knowledge_candidates pkc
         JOIN partner_conversation_batches pcb
           ON pcb.id = pkc.batch_id
          AND pcb.company_id = pkc.company_id
         WHERE pkc.company_id = $1
           AND pkc.id = $2
         FOR UPDATE OF pkc`,
        [safeCompanyId, safeCandidateId]
      );
      const candidate = rows[0];
      if (!candidate) {
        await db.query('ROLLBACK');
        return null;
      }
      const approvedCandidateWasEdited = candidate.status === 'approved' && (
        (titleInput && titleInput !== String(candidate.title || '').trim())
        || (categoryInput && categoryInput !== String(candidate.category || '').trim())
        || (contentInput && contentInput !== String(candidate.content || '').trim())
      );
      if (
        candidate.status === 'approved'
        && (requestedStatus !== 'approved' || approvedCandidateWasEdited)
      ) {
        const error = new Error('Approved knowledge cannot be edited or moved to another state.');
        error.code = 'PARTNER_CANDIDATE_ALREADY_APPROVED';
        throw error;
      }
      if (candidate.status === 'approved') {
        const existingSectionId = Number(candidate.approved_section_id);
        if (!Number.isInteger(existingSectionId) || existingSectionId < 1) {
          const error = new Error('Approved knowledge is missing its published section reference.');
          error.code = 'PARTNER_CANDIDATE_ALREADY_APPROVED';
          throw error;
        }
        await db.query('COMMIT');
        return {
          candidate,
          createdKnowledgeSectionId: existingSectionId,
        };
      }
      if (
        requestedStatus === 'approved'
        && candidate.status !== 'pending_review'
      ) {
        const error = new Error('Move this candidate back to pending review before approving it.');
        error.code = 'PARTNER_CANDIDATE_REVIEW_REQUIRED';
        throw error;
      }

      const title = titleInput || candidate.title;
      const category = categoryInput || candidate.category;
      const content = contentInput || candidate.content;
      let approvedSectionId = candidate.approved_section_id
        ? Number(candidate.approved_section_id)
        : null;
      let replacedKnowledgeSectionId = null;

      if (requestedStatus === 'approved' && candidate.revision_of_candidate_id) {
        const { rows: parentRows } = await db.query(
          `SELECT approved_section_id
           FROM partner_knowledge_candidates
           WHERE company_id = $1
             AND id = $2
             AND status = 'approved'
           FOR UPDATE`,
          [safeCompanyId, Number(candidate.revision_of_candidate_id)]
        );
        replacedKnowledgeSectionId = Number(parentRows[0]?.approved_section_id || 0) || null;
        if (!replacedKnowledgeSectionId) {
          const error = new Error('The knowledge revision no longer has an approved source.');
          error.code = 'PARTNER_CANDIDATE_REVISION_SOURCE_MISSING';
          throw error;
        }
      }

      if (requestedStatus === 'approved' && !approvedSectionId) {
        const { rows: sortRows } = await db.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
           FROM partner_knowledge_sections
           WHERE company_id = $1`,
          [safeCompanyId]
        );
        const metadata = {
          sourceType: 'line_conversation_candidate',
          candidateId: safeCandidateId,
          batchId: Number(candidate.batch_id),
          conversationDay: candidate.conversation_day,
          lineGroupId: Number(candidate.line_group_id),
          skillName: candidate.skill_name,
          skillVersion: candidate.skill_version,
          riskFlags: candidate.risk_flags || [],
          revisionOfCandidateId: candidate.revision_of_candidate_id
            ? Number(candidate.revision_of_candidate_id)
            : null,
          revisionNumber: Number(candidate.revision_number || 1),
          externalAiUsed: false,
        };
        const approvedContentHash = sha256(content);
        const { rows: sectionRows } = await db.query(
          `INSERT INTO partner_knowledge_sections
            (company_id, title, category, content, content_hash, metadata,
             review_status, sort_order, created_at, updated_at, approved_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'approved', $7,
                   NOW(), NOW(), NOW())
           RETURNING id`,
          [
            safeCompanyId,
            title,
            category.replace(/^LINE 待審｜/, 'LINE 核准｜'),
            content,
            approvedContentHash,
            JSON.stringify(metadata),
            Number(sortRows[0]?.next || 0),
          ]
        );
        approvedSectionId = Number(sectionRows[0].id);
        const chunks = splitChunkContent(content);
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const chunk = chunks[chunkIndex];
          await db.query(
            `INSERT INTO partner_knowledge_chunks
              (company_id, section_id, chunk_index, topic, content, search_text,
               content_hash, metadata, source_references, embedding_model,
               created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, '',
                     NOW(), NOW())`,
            [
              safeCompanyId,
              approvedSectionId,
              chunkIndex,
              title,
              chunk,
              `${title} ${category} ${chunk}`.replace(/\s+/g, ' ').trim(),
              sha256(chunk),
              JSON.stringify(metadata),
              JSON.stringify((candidate.source_message_ids || []).map(messageId => ({
                type: 'partner_conversation',
                messageId,
                conversationDay: candidate.conversation_day,
              }))),
            ]
          );
        }
        if (replacedKnowledgeSectionId) {
          await db.query(
            `UPDATE partner_knowledge_sections
             SET archived_at = NOW(),
                 updated_at = NOW()
             WHERE company_id = $1
               AND id = $2
               AND archived_at IS NULL`,
            [safeCompanyId, replacedKnowledgeSectionId]
          );
        }
      }

      const { rows: updatedRows } = await db.query(
        `UPDATE partner_knowledge_candidates
         SET title = $3,
             category = $4,
             content = $5,
             status = $6,
             approved_section_id = $7,
             reviewed_by = 'admin',
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE company_id = $1
           AND id = $2
         RETURNING *`,
        [
          safeCompanyId,
          safeCandidateId,
          title,
          category,
          content,
          requestedStatus,
          approvedSectionId,
        ]
      );
      await db.query('COMMIT');
      return {
        candidate: updatedRows[0],
        createdKnowledgeSectionId: requestedStatus === 'approved'
          ? approvedSectionId
          : null,
        replacedKnowledgeSectionId: requestedStatus === 'approved'
          ? replacedKnowledgeSectionId
          : null,
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  return {
    createCandidateRevision,
    generateCandidates,
    listCandidates,
    reviewCandidate,
  };
}

module.exports = {
  MAX_GENERATION_DAYS,
  SKILL_NAME,
  SKILL_VERSION,
  buildCandidatesForConversationGroup,
  createPartnerConversationKnowledgeService,
  detectCategory,
  detectRiskFlags,
  isNoiseMessage,
  splitChunkContent,
};
