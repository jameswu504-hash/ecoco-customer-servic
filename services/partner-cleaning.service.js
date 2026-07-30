const crypto = require('crypto');

const MAX_CHUNKS = 600;
const MAX_SECTIONS = MAX_CHUNKS;
const MAX_SECTION_CHARS = 20_000;
const MAX_CHUNK_CHARS = 3_000;
const MAX_TOTAL_SECTION_CHARS = 750_000;
const MAX_TOTAL_CHUNK_CHARS = 750_000;
const ALLOWED_SOURCE_TYPES = new Set(['line_txt', 'markdown']);
const EXPECTED_SKILL_NAME = 'ecoco-clean-brand-knowledge';

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function assertHash(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(String(value || ''))) {
    throw new Error(`${label} must be a SHA-256 hash.`);
  }
}

function assertApprovedLocalPackage(companyId, payload = {}) {
  const safeCompanyId = Number(companyId);
  if (!Number.isInteger(safeCompanyId) || safeCompanyId <= 0) {
    throw new Error('A valid partner company is required.');
  }
  const source = normalizeJsonObject(payload.source);
  const policy = normalizeJsonObject(payload.policy);
  const skill = normalizeJsonObject(payload.skill);
  const sections = normalizeJsonArray(payload.sections);
  const chunks = normalizeJsonArray(payload.chunks);

  if (!ALLOWED_SOURCE_TYPES.has(source.type)) {
    throw new Error('Only LINE TXT and Markdown cleaned sources are supported.');
  }
  if (!String(source.name || '').trim()) throw new Error('Source filename is required.');
  assertHash(source.contentHash, 'Source contentHash');
  if (policy.externalAiUsed !== false) {
    throw new Error('Packages processed with external AI cannot be imported.');
  }
  if (policy.rawContentUploaded !== false) {
    throw new Error('Packages containing uploaded raw content cannot be imported.');
  }
  if (policy.preservePersonalData !== true) {
    throw new Error('Internal contact preservation policy must be explicit.');
  }
  if (skill.name !== EXPECTED_SKILL_NAME || !String(skill.version || '').trim()) {
    throw new Error('The approved ECOCO cleaning skill and version are required.');
  }
  if (sections.length < 1 || sections.length > MAX_SECTIONS) {
    throw new Error(`Cleaned package must contain 1-${MAX_SECTIONS} sections.`);
  }
  if (chunks.length < 1 || chunks.length > MAX_CHUNKS) {
    throw new Error(`Cleaned package must contain 1-${MAX_CHUNKS} chunks.`);
  }

  const normalizedSections = sections.map((section, index) => {
    const title = String(section?.title || '').trim().slice(0, 180);
    const category = String(section?.category || '').trim().slice(0, 160);
    const content = String(section?.content || '').trim();
    if (!title || !category || !content) {
      throw new Error(`Section ${index + 1} is incomplete.`);
    }
    if (content.length > MAX_SECTION_CHARS) {
      throw new Error(`Section ${index + 1} exceeds ${MAX_SECTION_CHARS} characters.`);
    }
    assertHash(section.contentHash, `Section ${index + 1} contentHash`);
    return {
      title,
      category,
      content,
      contentHash: String(section.contentHash).toLowerCase(),
      metadata: normalizeJsonObject(section.metadata),
    };
  });
  const totalSectionCharacters = normalizedSections.reduce(
    (sum, section) => sum + section.content.length,
    0
  );
  if (totalSectionCharacters > MAX_TOTAL_SECTION_CHARS) {
    throw new Error(
      `Cleaned sections exceed ${MAX_TOTAL_SECTION_CHARS} total characters.`
    );
  }

  const normalizedChunks = chunks.map((chunk, index) => {
    const sectionIndex = Number(chunk?.sectionIndex);
    const chunkIndex = Number(chunk?.chunkIndex);
    const content = String(chunk?.content || '').trim();
    const searchText = String(chunk?.searchText || '').trim();
    if (!Number.isInteger(sectionIndex) || !normalizedSections[sectionIndex]) {
      throw new Error(`Chunk ${index + 1} references an invalid section.`);
    }
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !content || !searchText) {
      throw new Error(`Chunk ${index + 1} is incomplete.`);
    }
    if (content.length > MAX_CHUNK_CHARS) {
      throw new Error(`Chunk ${index + 1} exceeds ${MAX_CHUNK_CHARS} characters.`);
    }
    return {
      sectionIndex,
      chunkIndex,
      topic: String(chunk.topic || normalizedSections[sectionIndex].title).trim().slice(0, 180),
      content,
      searchText: searchText.slice(0, 12_000),
      contentHash: /^[a-f0-9]{64}$/i.test(String(chunk.contentHash || ''))
        ? String(chunk.contentHash).toLowerCase()
        : crypto.createHash('sha256').update(content).digest('hex'),
      metadata: normalizeJsonObject(chunk.metadata),
      sourceReferences: normalizeJsonArray(chunk.sourceReferences).slice(0, 20),
    };
  });
  const totalChunkCharacters = normalizedChunks.reduce(
    (sum, chunk) => sum + chunk.content.length,
    0
  );
  if (totalChunkCharacters > MAX_TOTAL_CHUNK_CHARS) {
    throw new Error(
      `Cleaned chunks exceed ${MAX_TOTAL_CHUNK_CHARS} total characters.`
    );
  }

  return {
    companyId: safeCompanyId,
    source: {
      name: String(source.name).trim().slice(0, 180),
      type: source.type,
      contentHash: String(source.contentHash).toLowerCase(),
      characterCount: Math.max(0, Math.min(Number(source.characterCount) || 0, 500_000)),
    },
    skill: {
      name: skill.name,
      version: String(skill.version).trim().slice(0, 40),
    },
    report: normalizeJsonObject(payload.report),
    sections: normalizedSections,
    chunks: normalizedChunks,
  };
}

function createPartnerCleaningService({ pool }) {
  async function importApprovedPackage(companyId, payload = {}) {
    const cleaned = assertApprovedLocalPackage(companyId, payload);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`partner_cleaned_import:${cleaned.companyId}:${cleaned.source.contentHash}`]
      );
      const { rows: sourceRows } = await db.query(
        `INSERT INTO partner_source_documents
          (company_id, source_type, original_filename, content_hash, original_size,
           storage_mode, preserve_personal_data, raw_content_stored, status,
           created_at, imported_at)
         VALUES ($1, $2, $3, $4, $5, 'browser_local_only', TRUE, FALSE,
                 'importing', NOW(), NULL)
         ON CONFLICT (company_id, content_hash) DO NOTHING
         RETURNING id`,
        [
          cleaned.companyId,
          cleaned.source.type,
          cleaned.source.name,
          cleaned.source.contentHash,
          cleaned.source.characterCount,
        ]
      );
      if (!sourceRows[0]) {
        const error = new Error('This source file has already been imported for the selected company.');
        error.code = 'PARTNER_SOURCE_DUPLICATE';
        throw error;
      }
      const sourceDocumentId = Number(sourceRows[0].id);
      const { rows: jobRows } = await db.query(
        `INSERT INTO partner_cleaning_jobs
          (company_id, source_document_id, skill_name, skill_version, status,
           report, approved_by, created_at, completed_at, approved_at)
         VALUES ($1, $2, $3, $4, 'approved', $5::jsonb, 'admin',
                 NOW(), NOW(), NOW())
         RETURNING id`,
        [
          cleaned.companyId,
          sourceDocumentId,
          cleaned.skill.name,
          cleaned.skill.version,
          JSON.stringify(cleaned.report),
        ]
      );
      const cleaningJobId = Number(jobRows[0].id);
      const { rows: sortRows } = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
         FROM partner_knowledge_sections
         WHERE company_id = $1`,
        [cleaned.companyId]
      );
      let nextSortOrder = Number(sortRows[0]?.next || 0);
      const sectionIds = [];

      for (const section of cleaned.sections) {
        const { rows } = await db.query(
          `INSERT INTO partner_knowledge_sections
            (company_id, source_document_id, cleaning_job_id, title, category,
             content, content_hash, metadata, review_status, sort_order,
             created_at, updated_at, approved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'approved', $9,
                   NOW(), NOW(), NOW())
           RETURNING id`,
          [
            cleaned.companyId,
            sourceDocumentId,
            cleaningJobId,
            section.title,
            section.category,
            section.content,
            section.contentHash,
            JSON.stringify(section.metadata),
            nextSortOrder,
          ]
        );
        sectionIds.push(Number(rows[0].id));
        nextSortOrder += 1;
      }

      for (const chunk of cleaned.chunks) {
        await db.query(
          `INSERT INTO partner_knowledge_chunks
            (company_id, section_id, source_document_id, chunk_index, topic,
             content, search_text, content_hash, metadata, source_references,
             embedding_model, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
                   '', NOW(), NOW())`,
          [
            cleaned.companyId,
            sectionIds[chunk.sectionIndex],
            sourceDocumentId,
            chunk.chunkIndex,
            chunk.topic,
            chunk.content,
            chunk.searchText,
            chunk.contentHash,
            JSON.stringify(chunk.metadata),
            JSON.stringify(chunk.sourceReferences),
          ]
        );
      }

      await db.query(
        `UPDATE partner_source_documents
         SET status = 'imported', imported_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [sourceDocumentId, cleaned.companyId]
      );
      await db.query('COMMIT');
      return {
        companyId: cleaned.companyId,
        sourceDocumentId,
        cleaningJobId,
        createdSectionCount: sectionIds.length,
        createdChunkCount: cleaned.chunks.length,
        preservePersonalData: true,
        externalAiUsed: false,
        rawContentUploaded: false,
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }

  return {
    importApprovedPackage,
  };
}

module.exports = {
  EXPECTED_SKILL_NAME,
  assertApprovedLocalPackage,
  createPartnerCleaningService,
};
