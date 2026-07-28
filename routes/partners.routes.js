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

function createPartnersRouter({ partnerService, requireAdminKey, pool }) {
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
      partnerService.listKnowledge(company.id),
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
    res.json(await partnerService.listKnowledge(req.params.companyId));
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

  router.post('/:companyId/knowledge/import-line', asyncHandler(async (req, res) => {
    try {
      const result = await partnerService.importLineChatKnowledge(
        req.params.companyId,
        req.body || {}
      );
      if (!result) return res.status(404).json({ error: 'Partner company not found.' });
      await saveAdminAudit(pool, {
        action: 'partner_line_knowledge_imported',
        targetType: 'partner_company',
        targetId: String(result.company.id),
        details: {
          sourceName: result.sourceName,
          sourceCharacters: result.sourceCharacters,
          preservePersonalData: result.preservePersonalData,
          totalSectionCount: result.totalSectionCount,
          createdCount: result.createdCount,
          skippedDuplicateCount: result.skippedDuplicateCount,
          ignoredAttachmentCount: result.ignoredAttachmentCount,
        },
      });
      res.status(result.createdCount > 0 ? 201 : 200).json({
        sourceName: result.sourceName,
        sourceCharacters: result.sourceCharacters,
        preservePersonalData: result.preservePersonalData,
        totalSectionCount: result.totalSectionCount,
        createdCount: result.createdCount,
        skippedDuplicateCount: result.skippedDuplicateCount,
        ignoredAttachmentCount: result.ignoredAttachmentCount,
      });
    } catch (err) {
      if (/required|must be under|does not contain usable|creates more than/i.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }));

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
