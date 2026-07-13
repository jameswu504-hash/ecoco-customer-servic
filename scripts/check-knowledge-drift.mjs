import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const LOCAL_KNOWLEDGE_PATH = process.env.KNOWLEDGE_IMPORT_PATH || 'data/ecoco-knowledge-import.json';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hashSection(section) {
  return crypto
    .createHash('sha256')
    .update(`${normalizeText(section.category)}\n---\n${normalizeText(section.content)}`)
    .digest('hex');
}

function toSectionMap(payload) {
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const map = new Map();
  for (const section of sections) {
    const category = normalizeText(section.category);
    if (!category) continue;
    map.set(category, {
      category,
      hash: hashSection(section),
      contentLength: normalizeText(section.content).length,
    });
  }
  return map;
}

async function readLocalKnowledge(filePath = LOCAL_KNOWLEDGE_PATH) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function fetchRemoteKnowledge({ baseUrl, adminKey }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/knowledge/export`, {
    headers: { 'x-admin-key': adminKey },
  });
  if (!response.ok) {
    throw new Error(`Knowledge export failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function compareKnowledgeMaps(localMap, remoteMap) {
  const localOnly = [];
  const remoteOnly = [];
  const changed = [];

  for (const [category, local] of localMap.entries()) {
    const remote = remoteMap.get(category);
    if (!remote) {
      localOnly.push(category);
    } else if (local.hash !== remote.hash) {
      changed.push({
        category,
        localLength: local.contentLength,
        remoteLength: remote.contentLength,
      });
    }
  }

  for (const category of remoteMap.keys()) {
    if (!localMap.has(category)) remoteOnly.push(category);
  }

  return { localOnly, remoteOnly, changed };
}

function hasDrift(diff) {
  return diff.localOnly.length > 0 || diff.remoteOnly.length > 0 || diff.changed.length > 0;
}

async function main() {
  const baseUrl = requiredEnv('ECOCO_BASE_URL');
  const adminKey = requiredEnv('ADMIN_KEY');
  const [localPayload, remotePayload] = await Promise.all([
    readLocalKnowledge(),
    fetchRemoteKnowledge({ baseUrl, adminKey }),
  ]);

  const localMap = toSectionMap(localPayload);
  const remoteMap = toSectionMap(remotePayload);
  const diff = compareKnowledgeMaps(localMap, remoteMap);
  const report = {
    generated_at: new Date().toISOString(),
    local_sections: localMap.size,
    remote_sections: remoteMap.size,
    drift: hasDrift(diff),
    ...diff,
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.drift) {
    console.warn('Knowledge drift detected between Git JSON and PostgreSQL export.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

export {
  compareKnowledgeMaps,
  hashSection,
  hasDrift,
  normalizeText,
  toSectionMap,
};
