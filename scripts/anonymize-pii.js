const fs = require('fs');
const path = require('path');

const DEFAULT_TARGETS = [
  path.join('data', 'ecoco-knowledge-import.json'),
  path.join('data', 'ecoco-ai-customer-service-database.json'),
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TW_MOBILE_PATTERN = /(?<!\d)(?:\+?886[-\s]?)?9\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)|(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/g;

function anonymizeText(input) {
  return String(input || '')
    .replace(EMAIL_PATTERN, 'redacted-email')
    .replace(TW_MOBILE_PATTERN, '09XX-XXX-XXX');
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

  for (const result of results) {
    const relative = path.relative(process.cwd(), result.filePath);
    console.log(`${result.changed ? 'updated' : 'clean'} ${relative} phones=${result.phoneMatches} emails=${result.emailMatches}`);
  }
  console.log(`Anonymization complete: files=${files.length} changed=${changedCount} phones=${phoneCount} emails=${emailCount}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  EMAIL_PATTERN,
  TW_MOBILE_PATTERN,
  anonymizeJsonValue,
  anonymizeText,
};
