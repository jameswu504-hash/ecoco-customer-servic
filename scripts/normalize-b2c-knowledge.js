const fs = require('fs');
const path = require('path');
const {
  LEGACY_STATION_CATEGORY_PREFIX,
  LIVE_STATION_GUIDANCE_CATEGORY,
  LIVE_STATION_GUIDANCE_CONTENT,
} = require('../services/knowledge-maintenance.service');

const rootDir = path.join(__dirname, '..');
const importPath = path.join(rootDir, 'data', 'ecoco-knowledge-import.json');
const databasePath = path.join(rootDir, 'data', 'ecoco-ai-customer-service-database.json');
const seedPath = path.join(rootDir, 'knowledge.js');

function normalizeOfficialTerms(text) {
  return String(text || '')
    .replace(/ECOCO\s*智慧寶特瓶回收機/g, 'ECOCO 智慧收瓶機')
    .replace(/ECOCO\s*智慧回收機台/g, 'ECOCO 設備')
    .replace(/ECOCO\s*智慧回收機/g, 'ECOCO 設備')
    .replace(/ecoco\s*智慧寶特瓶回收機/gi, 'ECOCO 智慧收瓶機')
    .replace(/ecoco\s*智慧回收機台/gi, 'ECOCO 設備')
    .replace(/ecoco\s*智慧回收機/gi, 'ECOCO 設備')
    .replace(/智慧寶特瓶回收機/g, 'ECOCO 智慧收瓶機')
    .replace(/智慧回收機台/g, 'ECOCO 設備')
    .replace(/智慧回收機/g, 'ECOCO 設備');
}

function normalizeValue(value) {
  if (typeof value === 'string') return normalizeOfficialTerms(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeValue(child)])
    );
  }
  return value;
}

function updateJson(filePath, { removeLegacyStationSections = false } = {}) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let removedSections = 0;

  if (removeLegacyStationSections && Array.isArray(payload.sections)) {
    const originalCount = payload.sections.length;
    payload.sections = payload.sections.filter(section => (
      !String(section.category || '').startsWith(LEGACY_STATION_CATEGORY_PREFIX)
    ));
    removedSections = originalCount - payload.sections.length;
    payload.sections = payload.sections.map(section => (
      section.category === LIVE_STATION_GUIDANCE_CATEGORY
        ? { ...section, content: LIVE_STATION_GUIDANCE_CONTENT }
        : section
    ));
    if (payload.summary && typeof payload.summary === 'object') {
      payload.summary.section_count = payload.sections.length;
      payload.summary.content_chars = payload.sections.reduce(
        (total, section) => total + String(section.content || '').length,
        0
      );
    }
  }

  const normalized = normalizeValue(payload);
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return { removedSections };
}

function updateSeedFile(filePath) {
  const source = normalizeOfficialTerms(fs.readFileSync(filePath, 'utf8'));
  const stationBlock = /  \{\r?\n    category: `站點資訊`,\r?\n    content: `[\s\S]*?`,\r?\n  \},\r?\n  \{\r?\n    category: `產品規格`,/;
  if (!stationBlock.test(source)) {
    throw new Error('Unable to locate the legacy station section in knowledge.js');
  }
  const replacement = [
    '  {',
    '    category: `站點資訊`,',
    `    content: \`${LIVE_STATION_GUIDANCE_CONTENT}\`,`,
    '  },',
    '  {',
    '    category: `產品規格`,',
  ].join('\n');
  fs.writeFileSync(filePath, source.replace(stationBlock, replacement), 'utf8');
}

const importResult = updateJson(importPath, { removeLegacyStationSections: true });
updateJson(databasePath);
updateSeedFile(seedPath);

console.log(
  `B2C knowledge normalized: removed legacy station sections=${importResult.removedSections}`
);
