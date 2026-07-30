const crypto = require('crypto');
const express = require('express');
const { saveAdminAudit } = require('../services/trace.service');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function getPartnerTestSessionId(companyId, value) {
  const candidate = String(value || '').trim();
  if (/^partner_test_[A-Za-z0-9_-]{8,100}$/.test(candidate)) return candidate;
  return `partner_test_${companyId}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function createPartnersRouter({
  partnerService,
  partnerCleaningService,
  partnerConversationKnowledgeService,
  requireAdminKey,
  pool,
}) {
  const router = express.Router();
  router.use(requireAdminKey);

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await partnerService.listCompanies());
  }));

  router.post('/', asyncHandler(async (req, res) => {
    try {
      const company = await partnerService.createCompany(req.body || {});
      await saveAdminAudit(pool, {
        action: 'partner_company_created',
        targetType: 'partner_company',
        targetId: String(company.id),
        details: { slug: company.slug, name: company.name },
      });
      res.status(201).json(company);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Company code already exists.' });
      }
      if (/required/i.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.get('/:companyId', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    const [lineGroups, knowledge] = await Promise.all([
      partnerService.listLineGroups(company.id),
      partnerService.listKnowledge(company.id, 'all'),
    ]);
    res.json({
      company,
      lineGroups,
      knowledge,
    });
  }));

  router.patch('/:companyId/status', asyncHandler(async (req, res) => {
    const company = await partnerService.updateCompanyStatus(
      req.params.companyId,
      req.body?.status
    );
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    await saveAdminAudit(pool, {
      action: 'partner_company_status_updated',
      targetType: 'partner_company',
      targetId: String(company.id),
      details: { status: company.status },
    });
    res.json(company);
  }));

  router.post('/:companyId/binding-code', asyncHandler(async (req, res) => {
    const binding = await partnerService.generateBindingCode(req.params.companyId);
    if (!binding) return res.status(404).json({ error: 'Partner company not found.' });
    await saveAdminAudit(pool, {
      action: 'partner_binding_code_created',
      targetType: 'partner_company',
      targetId: String(binding.company.id),
      details: { expiresAt: binding.expiresAt },
    });
    res.status(201).json({
      code: binding.code,
      expiresAt: binding.expiresAt,
    });
  }));

  router.get('/:companyId/line-groups', asyncHandler(async (req, res) => {
    res.json(await partnerService.listLineGroups(req.params.companyId));
  }));

  router.get('/:companyId/knowledge', asyncHandler(async (req, res) => {
    res.json(await partnerService.listKnowledge(req.params.companyId, req.query.status));
  }));

  router.get('/:companyId/conversations', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    res.json(await partnerService.listLineConversationDays(
      company.id,
      req.query.days,
      req.query.status
    ));
  }));

  router.patch('/:companyId/conversations/:day/status', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    try {
      const result = await partnerService.updateConversationDayStatus(
        company.id,
        req.params.day,
        req.body?.status
      );
      const archivedCandidateCount = result.status === 'archived'
        ? await partnerConversationKnowledgeService.archiveCandidatesForDay(
          company.id,
          result.day
        )
        : 0;
      await saveAdminAudit(pool, {
        action: result.status === 'archived'
          ? 'partner_conversation_day_archived'
          : 'partner_conversation_day_restored',
        targetType: 'partner_conversation_day',
        targetId: `${company.id}:${result.day}`,
        details: {
          companySlug: company.slug,
          day: result.day,
          updatedMessages: result.updatedMessages,
          archivedCandidateCount,
        },
      });
      res.json({
        ...result,
        archivedCandidateCount,
      });
    } catch (err) {
      if (err.code === 'PARTNER_INVALID_CONVERSATION_DAY') {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.delete('/:companyId/conversations/:day', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    try {
      const result = await partnerService.deleteArchivedConversationDay(
        company.id,
        req.params.day,
        req.body?.confirmDay
      );
      const deletedCandidateCount =
        await partnerConversationKnowledgeService.deleteUnapprovedCandidatesForDay(
          company.id,
          result.day
        );
      await saveAdminAudit(pool, {
        action: 'partner_conversation_day_deleted',
        targetType: 'partner_conversation_day',
        targetId: `${company.id}:${result.day}`,
        details: {
          companySlug: company.slug,
          day: result.day,
          deletedMessages: result.deletedMessages,
          deletedCandidateCount,
        },
      });
      res.json({
        ...result,
        deletedCandidateCount,
      });
    } catch (err) {
      if (
        err.code === 'PARTNER_INVALID_CONVERSATION_DAY'
        || err.code === 'PARTNER_CONFIRMATION_MISMATCH'
      ) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.post('/:companyId/knowledge', asyncHandler(async (req, res) => {
    try {
      const section = await partnerService.addKnowledge(req.params.companyId, req.body || {});
      if (!section) return res.status(404).json({ error: 'Partner company not found.' });
      await saveAdminAudit(pool, {
        action: 'partner_knowledge_created',
        targetType: 'partner_knowledge',
        targetId: String(section.id),
        details: { companyId: section.company_id, category: section.category },
      });
      res.status(201).json(section);
    } catch (err) {
      if (/required|under \d+ characters/i.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.delete('/:companyId/knowledge', asyncHandler(async (req, res) => {
    try {
      const result = await partnerService.clearCompanyKnowledge(
        req.params.companyId,
        req.body?.confirmSlug
      );
      if (!result) return res.status(404).json({ error: 'Partner company not found.' });
      await saveAdminAudit(pool, {
        action: 'partner_company_knowledge_cleared',
        targetType: 'partner_company',
        targetId: String(result.company.id),
        details: {
          companySlug: result.company.slug,
          deleted: result.deleted,
          preserved: result.preserved,
        },
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'PARTNER_CONFIRMATION_MISMATCH') {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.patch('/:companyId/knowledge/:sectionId/status', asyncHandler(async (req, res) => {
    const section = await partnerService.updateKnowledgeStatus(
      req.params.companyId,
      req.params.sectionId,
      req.body?.status
    );
    if (!section) return res.status(404).json({ error: 'Partner knowledge not found.' });
    const status = section.archived_at ? 'archived' : 'active';
    await saveAdminAudit(pool, {
      action: status === 'archived'
        ? 'partner_knowledge_archived'
        : 'partner_knowledge_restored',
      targetType: 'partner_knowledge',
      targetId: String(section.id),
      details: {
        companyId: section.company_id,
        category: section.category,
        status,
      },
    });
    res.json(section);
  }));

  router.delete('/:companyId/knowledge/:sectionId', asyncHandler(async (req, res) => {
    try {
      const result = await partnerService.deleteArchivedKnowledge(
        req.params.companyId,
        req.params.sectionId,
        req.body?.confirmSlug
      );
      if (!result) return res.status(404).json({ error: 'Partner knowledge not found.' });
      await saveAdminAudit(pool, {
        action: 'partner_knowledge_deleted',
        targetType: 'partner_knowledge',
        targetId: String(result.id),
        details: {
          companyId: Number(req.params.companyId),
          category: result.category,
          deleted: result.deleted,
        },
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'PARTNER_CONFIRMATION_MISMATCH') {
        return res.status(400).json({ error: err.message });
      }
      if (err.code === 'PARTNER_KNOWLEDGE_NOT_ARCHIVED') {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.post('/:companyId/knowledge/import-cleaned', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    try {
      const result = await partnerCleaningService.importApprovedPackage(
        company.id,
        req.body || {}
      );
      await saveAdminAudit(pool, {
        action: 'partner_cleaned_knowledge_imported',
        targetType: 'partner_company',
        targetId: String(company.id),
        details: {
          sourceDocumentId: result.sourceDocumentId,
          cleaningJobId: result.cleaningJobId,
          createdSectionCount: result.createdSectionCount,
          createdChunkCount: result.createdChunkCount,
          preservePersonalData: true,
          externalAiUsed: false,
          rawContentUploaded: false,
        },
      });
      res.status(201).json(result);
    } catch (err) {
      if (err.code === 'PARTNER_SOURCE_DUPLICATE') {
        return res.status(409).json({ error: err.message });
      }
      if (/required|supported|must|cannot|incomplete|invalid|exceeds/i.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

  router.get('/:companyId/knowledge-candidates', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    res.json({
      status: req.query.status || 'pending_review',
      candidates: await partnerConversationKnowledgeService.listCandidates(
        company.id,
        req.query.status
      ),
    });
  }));

  router.post('/:companyId/knowledge-candidates/generate', asyncHandler(async (req, res) => {
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    const result = await partnerConversationKnowledgeService.generateCandidates(
      company.id,
      req.body?.days
    );
    await saveAdminAudit(pool, {
      action: 'partner_knowledge_candidates_generated',
      targetType: 'partner_company',
      targetId: String(company.id),
      details: {
        selectedDays: result.selectedDays,
        sourceMessageCount: result.sourceMessageCount,
        createdBatchCount: result.createdBatchCount,
        createdCandidateCount: result.createdCandidateCount,
        duplicateCandidateCount: result.duplicateCandidateCount,
        skill: result.skill,
      },
    });
    res.status(201).json(result);
  }));

  router.patch(
    '/:companyId/knowledge-candidates/:candidateId',
    asyncHandler(async (req, res) => {
      try {
        const result = await partnerConversationKnowledgeService.reviewCandidate(
          req.params.companyId,
          req.params.candidateId,
          req.body || {}
        );
        if (!result) return res.status(404).json({ error: 'Knowledge candidate not found.' });
        await saveAdminAudit(pool, {
          action: `partner_knowledge_candidate_${result.candidate.status}`,
          targetType: 'partner_knowledge_candidate',
          targetId: String(result.candidate.id),
          details: {
            companyId: Number(req.params.companyId),
            status: result.candidate.status,
            approvedSectionId: result.createdKnowledgeSectionId,
          },
        });
        res.json(result);
      } catch (err) {
        if (
          err.code === 'PARTNER_CANDIDATE_ALREADY_APPROVED'
          || err.code === 'PARTNER_CANDIDATE_REVIEW_REQUIRED'
        ) {
          return res.status(409).json({ error: err.message });
        }
        if (err.code === 'PARTNER_INVALID_CANDIDATE_STATUS') {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }
    })
  );

  router.post('/:companyId/test-chat', asyncHandler(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required.' });
    if (question.length > 2000) {
      return res.status(400).json({ error: 'Question must be under 2000 characters.' });
    }
    const company = await partnerService.getCompany(req.params.companyId);
    if (!company) return res.status(404).json({ error: 'Partner company not found.' });
    const sessionId = getPartnerTestSessionId(company.id, req.body?.sessionId);
    const result = await partnerService.answerPartnerQuestion({
      company,
      sessionId,
      question,
      channel: 'partner_test',
    });
    res.json({
      reply: result.reply,
      company: {
        id: company.id,
        slug: company.slug,
        name: company.name,
      },
      sessionId,
      privateKnowledgeCount: result.privateKnowledgeCount,
      retrievalMode: result.retrievalMode,
    });
  }));

  return router;
}

module.exports = {
  createPartnersRouter,
  getPartnerTestSessionId,
};
