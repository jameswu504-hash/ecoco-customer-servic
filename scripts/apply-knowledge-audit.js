const fs = require('fs');
const path = require('path');
const { anonymizeJsonValue } = require('./anonymize-pii');

const repoRoot = path.join(__dirname, '..');
const databasePath = path.join(repoRoot, 'data', 'ecoco-ai-customer-service-database.json');
const auditPath = path.join(repoRoot, 'data', 'knowledge-quality-audit.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(anonymizeJsonValue(payload), null, 2)}\n`, 'utf8');
}

function appendNote(existingNote, addition) {
  const note = String(existingNote || '').trim();
  if (note.includes(addition)) return note;
  return note ? `${note}；${addition}` : addition;
}

function collectArchiveActions(audit) {
  const actions = new Map();
  for (const group of audit.duplicate_groups || []) {
    const keepId = group.recommended_keep_record_id;
    for (const candidate of group.candidates || []) {
      if (!candidate.record_id || candidate.record_id === keepId) continue;
      if (candidate.recommended_action !== 'review_or_archive') continue;
      actions.set(candidate.record_id, {
        duplicateOf: keepId,
        question: group.question || group.normalized_question || '',
      });
    }
  }
  return actions;
}

function main() {
  const database = readJson(databasePath);
  const audit = readJson(auditPath);
  const archiveActions = collectArchiveActions(audit);
  const records = Array.isArray(database.knowledge_records) ? database.knowledge_records : [];
  const appliedAt = new Date().toISOString().slice(0, 10);
  let archived = 0;
  let alreadyArchived = 0;

  for (const record of records) {
    const action = archiveActions.get(record.record_id);
    if (!action) continue;

    if (record.status === 'archived') {
      alreadyArchived++;
      continue;
    }

    record.status = 'archived';
    record.notes = appendNote(
      record.notes,
      `dedupe ${appliedAt}: archived as duplicate of ${action.duplicateOf}`
    );
    archived++;
  }

  const archivedDuplicateRecordsTotal = records.filter(row =>
    row.status === 'archived' && String(row.notes || '').includes('dedupe')
  ).length;

  database.dedupe_applied = {
    applied_at: new Date().toISOString(),
    source: 'data/knowledge-quality-audit.json',
    method: 'Archived duplicate candidates recommended by audit; original records are retained for traceability.',
    audit_duplicate_candidates: archiveActions.size,
    archived_this_run: archived,
    already_archived: alreadyArchived,
    archived_duplicate_records_total: archivedDuplicateRecordsTotal,
    active_ai_records_after_apply: records.filter(row =>
      row.status === 'active' &&
      String(row.use_in_ai || '').toLowerCase() === 'yes' &&
      row.automation_level !== 'internal_only'
    ).length,
  };

  writeJson(databasePath, database);
  console.log(`Archived duplicate records: ${archived}`);
  console.log(`Already archived: ${alreadyArchived}`);
  console.log(`Archived duplicate records total: ${database.dedupe_applied.archived_duplicate_records_total}`);
  console.log(`Active AI records after apply: ${database.dedupe_applied.active_ai_records_after_apply}`);
}

main();
