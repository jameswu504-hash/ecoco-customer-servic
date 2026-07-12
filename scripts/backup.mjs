import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BACKUP_DIR = path.join(ROOT, process.env.BACKUP_DIR || 'backups');
const CHANGED_MARKER = path.join(ROOT, 'scripts', '.changed');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stablePayload(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  delete clone.generated_at;
  return JSON.stringify(clone, null, 2);
}

async function readStableJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return stablePayload(JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

async function main() {
  const baseUrl = requiredEnv('ECOCO_BASE_URL').replace(/\/+$/, '');
  const adminKey = requiredEnv('ADMIN_KEY');

  const response = await fetch(`${baseUrl}/api/knowledge/export`, {
    headers: { 'x-admin-key': adminKey },
  });
  if (!response.ok) {
    throw new Error(`Knowledge export failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const latestPath = path.join(BACKUP_DIR, 'knowledge-latest.json');
  const datedPath = path.join(BACKUP_DIR, `knowledge-${new Date().toISOString().slice(0, 10)}.json`);
  const before = await readStableJson(latestPath);
  const after = stablePayload(payload);

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  if (before === after) {
    await fs.rm(CHANGED_MARKER, { force: true });
    console.log('Knowledge backup unchanged.');
    return;
  }

  const pretty = JSON.stringify(payload, null, 2) + '\n';
  await fs.writeFile(latestPath, pretty, 'utf8');
  await fs.writeFile(datedPath, pretty, 'utf8');
  await fs.writeFile(CHANGED_MARKER, 'changed\n', 'utf8');
  console.log(`Knowledge backup updated: ${payload.summary?.section_count ?? 0} sections`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
