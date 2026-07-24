const fs = require('fs');
const path = require('path');
const {
  EMAIL_PATTERN,
  LONG_NUMBER_PATTERN,
  TW_ID_PATTERN,
  TW_MOBILE_PATTERN,
  countSensitiveLongNumbers,
} = require('./anonymize-pii');

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', 'build', '.local-iot-sync']);
const ALLOWED_EMAILS = new Set([
  'actions@github.com',
]);
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
]);

function isTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || path.basename(filePath).startsWith('.env');
}

function collectFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) return [];
      return collectFiles(path.join(dir, entry.name));
    }

    const filePath = path.join(dir, entry.name);
    return entry.isFile() && isTextFile(filePath) ? [filePath] : [];
  });
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const emailMatches = (content.match(EMAIL_PATTERN) || [])
    .filter(email => !ALLOWED_EMAILS.has(email.toLowerCase()));

  return {
    filePath,
    phoneMatches: (content.match(TW_MOBILE_PATTERN) || []).length,
    emailMatches: emailMatches.length,
    twIdMatches: (content.match(TW_ID_PATTERN) || []).length,
    numberMatches: countSensitiveLongNumbers(content),
  };
}

function run() {
  const results = collectFiles(process.cwd())
    .map(scanFile)
    .filter(result => (
      result.phoneMatches > 0
      || result.emailMatches > 0
      || result.twIdMatches > 0
      || result.numberMatches > 0
    ));

  if (results.length === 0) {
    console.log('PII scan clean: no Taiwan mobile, email, Taiwan ID, or long number patterns found.');
    return;
  }

  for (const result of results) {
    console.log(`${path.relative(process.cwd(), result.filePath)} phones=${result.phoneMatches} emails=${result.emailMatches} twIds=${result.twIdMatches} longNumbers=${result.numberMatches}`);
  }

  console.log(`PII scan found ${results.length} file(s).`);
  process.exitCode = 1;
}

if (require.main === module) {
  run();
}
