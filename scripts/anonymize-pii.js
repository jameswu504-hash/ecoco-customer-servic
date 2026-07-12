const fs = require('fs');
const path = require('path');
const {
  EMAIL_PATTERN,
  LONG_NUMBER_PATTERN,
  TW_ID_PATTERN,
  TW_MOBILE_PATTERN,
  countSensitiveLongNumbers,
  isLikelyPublicLongNumber,
} = require('../services/privacy.service');

const DEFAULT_TARGETS = [
  path.join('data', 'ecoco-knowledge-import.json'),
  path.join('data', 'ecoco-ai-customer-service-database.json'),
];

function anonymizeText(input) {
  const content = String(input || '');
  return content
    .replace(EMAIL_PATTERN, 'redacted-email')
    .replace(TW_MOBILE_PATTERN, '09XX-XXX-XXX')
    .replace(TW_ID_PATTERN, '[tw-id]')
    .replace(LONG_NUMBER_PATTERN, (match, offset) => (
      isLikelyPublicLongNumber(match, offset, content) ? match : '[number]'
    ));
}

function anonymizeJsonValue(value) {
  if (typeof value === 'string') return anonymizeText(value);
  if (Array.isArray(value)) return value.map(anonymizeJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, anonymizeJsonValue(child)])
    );
  }
  return value;
}

function anonymizeJsonFile(original) {
  const parsed = JSON.parse(original);
  return `${JSON.stringify(anonymizeJsonValue(parsed), null, 2)}\n`;
}

function collectFiles(target) {
  const resolved = path.resolve(process.cwd(), target);
  if (!fs.existsSync(resolved)) return [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory()) return [];

  return fs.readdirSync(resolved, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(resolved, entry.name);
    if (entry.isDirectory()) return collectFiles(child);
    return entry.isFile() ? [child] : [];
  });
}

function anonymizeFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const anonymized = path.extname(filePath).toLowerCase() === '.json'
    ? anonymizeJsonFile(original)
    : anonymizeText(original);
  const changed = original !== anonymized;
  if (changed) {
    fs.writeFileSync(filePath, anonymized, 'utf8');
  }

  return {
    filePath,
    changed,
    emailMatches: (original.match(EMAIL_PATTERN) || []).length,
    phoneMatches: (original.match(TW_MOBILE_PATTERN) || []).length,
    twIdMatches: (original.match(TW_ID_PATTERN) || []).length,
    numberMatches: countSensitiveLongNumbers(original),
  };
}

function run() {
  const targets = process.argv.slice(2);
  const selectedTargets = targets.length > 0 ? targets : DEFAULT_TARGETS;
  const files = selectedTargets.flatMap(collectFiles);

  if (files.length === 0) {
    console.log('No files found to anonymize.');
    return;
  }

  const results = files.map(anonymizeFile);
  const changedCount = results.filter(result => result.changed).length;
  const emailCount = results.reduce((sum, result) => sum + result.emailMatches, 0);
  const phoneCount = results.reduce((sum, result) => sum + result.phoneMatches, 0);
  const twIdCount = results.reduce((sum, result) => sum + result.twIdMatches, 0);
  const numberCount = results.reduce((sum, result) => sum + result.numberMatches, 0);

  for (const result of results) {
    const relative = path.relative(process.cwd(), result.filePath);
    console.log(`${result.changed ? 'updated' : 'clean'} ${relative} phones=${result.phoneMatches} emails=${result.emailMatches} twIds=${result.twIdMatches} longNumbers=${result.numberMatches}`);
  }
  console.log(`Anonymization complete: files=${files.length} changed=${changedCount} phones=${phoneCount} emails=${emailCount} twIds=${twIdCount} longNumbers=${numberCount}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  EMAIL_PATTERN,
  LONG_NUMBER_PATTERN,
  TW_ID_PATTERN,
  TW_MOBILE_PATTERN,
  anonymizeJsonValue,
  anonymizeText,
  countSensitiveLongNumbers,
  isLikelyPublicLongNumber,
};
