#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  cleanPartnerKnowledgeFile,
} = require('../../../public/partner-data-cleaner');

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

async function main() {
  const inputArg = getArg('input');
  const outputArg = getArg('out-dir');
  if (!inputArg || !outputArg) throw new Error('--input and --out-dir are required.');
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
  process.stderr.write(`Cleaning failed: ${error.message}\n`);
  process.exitCode = 1;
});
