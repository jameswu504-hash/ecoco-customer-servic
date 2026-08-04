#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function findRepositoryRoot(startDirectories) {
  for (const startDirectory of startDirectories) {
    let current = path.resolve(startDirectory);
    while (true) {
      if (fs.existsSync(path.join(current, 'public', 'partner-data-cleaner.js'))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('找不到 ECOCO 專案根目錄。請從專案目錄執行清洗指令。');
}

const repositoryRoot = findRepositoryRoot([process.cwd(), __dirname]);
const {
  cleanPartnerKnowledgeFile,
} = require(path.join(repositoryRoot, 'public', 'partner-data-cleaner'));

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

async function main() {
  const inputArg = getArg('input');
  const outputArg = getArg('out-dir');
  if (!inputArg || !outputArg) throw new Error('必須提供 --input 與 --out-dir。');
  const inputPath = path.resolve(inputArg);
  const outputDir = path.resolve(outputArg);
  const company = {
    id: Number(getArg('company-id')),
    name: getArg('company-name'),
    slug: getArg('company-slug'),
  };
  const content = fs.readFileSync(inputPath, 'utf8');
  const cleaned = await cleanPartnerKnowledgeFile({
    company,
    sourceName: path.basename(inputPath),
    content,
  });
  fs.mkdirSync(outputDir, { recursive: true });
  const basename = path.basename(inputPath).replace(/\.(?:txt|md)$/i, '');
  const markdownPath = path.join(outputDir, `${basename}-ai-cleaned.md`);
  const packagePath = path.join(outputDir, `${basename}-ai-cleaned.json`);
  fs.writeFileSync(markdownPath, cleaned.markdown, 'utf8');
  fs.writeFileSync(packagePath, JSON.stringify(cleaned, null, 2), 'utf8');
  process.stdout.write(JSON.stringify({
    companyId: cleaned.company.id,
    sourceType: cleaned.source.type,
    sourceHashPrefix: cleaned.source.contentHash.slice(0, 12),
    sectionCount: cleaned.report.sectionCount,
    chunkCount: cleaned.report.chunkCount,
    warningCount: cleaned.report.warnings.length,
    preservePersonalData: true,
    externalAiUsed: false,
    rawContentUploaded: false,
    markdownPath,
    packagePath,
  }));
}

main().catch(error => {
  process.stderr.write(`清洗失敗：${error.message}\n`);
  process.exitCode = 1;
});
