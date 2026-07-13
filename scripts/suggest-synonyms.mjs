import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const OUTPUT_DIR = 'evals/reports';

function normalizeQuestion(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function fetchUnanswered({ baseUrl, adminKey }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/unanswered`, {
    headers: { 'x-admin-key': adminKey },
  });
  if (!response.ok) {
    throw new Error(`Unanswered API failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function selectCandidateQuestions(rows, limit = 50) {
  const seen = new Set();
  const candidates = [];
  for (const row of rows) {
    const status = String(row.status || 'pending');
    if (status !== 'pending') continue;
    const question = normalizeQuestion(row.question);
    if (!question || seen.has(question)) continue;
    seen.add(question);
    candidates.push(question);
    if (candidates.length >= limit) break;
  }
  return candidates;
}

async function askClaudeForSynonyms(questions) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.SYNONYM_SUGGEST_MODEL) return null;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.SYNONYM_SUGGEST_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            'Review these ECOCO unanswered customer questions.',
            'Suggest synonym groups that could improve Chinese RAG retrieval.',
            'Return strict JSON only: {"groups":[["term1","term2"]],"notes":["..."]}',
            JSON.stringify(questions, null, 2),
          ].join('\n\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Synonym suggestion API failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  const text = payload.content?.find(block => block.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return { groups: [], notes: [`Claude returned non-JSON output: ${text.slice(0, 300)}`] };
  }
}

async function main() {
  const baseUrl = process.env.ECOCO_BASE_URL;
  const adminKey = process.env.ADMIN_KEY;
  if (!baseUrl || !adminKey) {
    console.log('Set ECOCO_BASE_URL and ADMIN_KEY to generate synonym suggestions from unanswered questions.');
    return;
  }

  const rows = await fetchUnanswered({ baseUrl, adminKey });
  const questions = selectCandidateQuestions(rows);
  const suggestions = await askClaudeForSynonyms(questions);
  const report = {
    generated_at: new Date().toISOString(),
    candidate_count: questions.length,
    candidates: questions,
    suggestions: suggestions || {
      groups: [],
      notes: ['Set ANTHROPIC_API_KEY and SYNONYM_SUGGEST_MODEL to generate AI synonym suggestions.'],
    },
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const output = `${OUTPUT_DIR}/synonym-suggestions-${new Date().toISOString().slice(0, 10)}.json`;
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Synonym suggestion report written: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

export {
  normalizeQuestion,
  selectCandidateQuestions,
};
