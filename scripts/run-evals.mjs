import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const GOLDEN_SET_PATH = process.env.EVAL_GOLDEN_SET || 'evals/golden-set.json';
const DEFAULT_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 45000);

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function parseArgs(argv) {
  return {
    validateOnly: argv.includes('--validate-only'),
    json: argv.includes('--json'),
  };
}

async function readGoldenSet(filePath = GOLDEN_SET_PATH) {
  const raw = await fs.readFile(filePath, 'utf8');
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.cases) || payload.cases.length === 0) {
    throw new Error('Golden set must include a non-empty cases array.');
  }

  for (const item of payload.cases) {
    if (!item.id || !item.question) throw new Error(`Invalid eval case: ${JSON.stringify(item)}`);
    if (!Array.isArray(item.must_include)) throw new Error(`${item.id} missing must_include array.`);
    if (!Array.isArray(item.must_not_include)) throw new Error(`${item.id} missing must_not_include array.`);
    if (item.must_include_any && !Array.isArray(item.must_include_any)) {
      throw new Error(`${item.id} must_include_any must be an array.`);
    }
    for (const group of item.must_include_any || []) {
      if (!Array.isArray(group) || group.length === 0) {
        throw new Error(`${item.id} must_include_any groups must be non-empty arrays.`);
      }
    }
  }

  return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callCustomerService({ baseUrl, question, sessionId }) {
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId,
    },
    body: JSON.stringify({ message: question }),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: text };
  }

  if (!response.ok) {
    throw new Error(payload.error || `Chat API failed: ${response.status}`);
  }

  return String(payload.reply || payload.error || '').trim();
}

function deterministicJudge(answer, criteria) {
  const normalized = normalizeText(answer);
  const missing = criteria.must_include.filter(term => !normalized.includes(normalizeText(term)));
  const missingAny = (criteria.must_include_any || [])
    .filter(group => !group.some(term => normalized.includes(normalizeText(term))))
    .map(group => `one of: ${group.join(' / ')}`);
  const forbidden = criteria.must_not_include.filter(term => normalized.includes(normalizeText(term)));
  const allMissing = [...missing, ...missingAny];

  return {
    pass: allMissing.length === 0 && forbidden.length === 0,
    score: allMissing.length === 0 && forbidden.length === 0 ? 1 : 0,
    missing: allMissing,
    forbidden,
    rationale: allMissing.length || forbidden.length
      ? `Missing: ${allMissing.join(', ') || 'none'}; forbidden: ${forbidden.join(', ') || 'none'}`
      : 'All deterministic checks passed.',
  };
}

async function aiJudge({ question, answer, criteria }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.EVAL_JUDGE_MODEL;
  if (!apiKey || !model) return null;

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: [
            'You are judging an ECOCO customer-service answer.',
            'Return strict JSON only: {"pass":boolean,"score":0-1,"missing":[],"forbidden":[],"rationale":"..."}',
            `Question: ${question}`,
            `Answer: ${answer}`,
            `Must include: ${JSON.stringify(criteria.must_include)}`,
            `Must include at least one term from each group: ${JSON.stringify(criteria.must_include_any || [])}`,
            `Must not include: ${JSON.stringify(criteria.must_not_include)}`,
          ].join('\n\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge API failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload.content?.find(block => block.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return {
      pass: false,
      score: 0,
      missing: [],
      forbidden: [],
      rationale: `Judge returned non-JSON output: ${text.slice(0, 200)}`,
    };
  }
}

async function runCase(item, index, { baseUrl }) {
  const sessionId = `eval_${Date.now()}_${index}_${item.id}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const answer = baseUrl
    ? await callCustomerService({ baseUrl, question: item.question, sessionId })
    : '';
  const deterministic = deterministicJudge(answer, item);
  const modelJudge = answer ? await aiJudge({ question: item.question, answer, criteria: item }) : null;
  const result = modelJudge || deterministic;

  return {
    id: item.id,
    category: item.category,
    risk: item.risk,
    question: item.question,
    answer,
    judge: modelJudge ? 'anthropic' : 'deterministic',
    ...result,
  };
}

function summarize(results) {
  const total = results.length;
  const passed = results.filter(item => item.pass).length;
  const highRisk = results.filter(item => item.risk === 'high');
  const highRiskPassed = highRisk.filter(item => item.pass).length;
  return {
    total,
    passed,
    passRate: total ? Number((passed / total).toFixed(4)) : 0,
    highRiskTotal: highRisk.length,
    highRiskPassed,
    highRiskPassRate: highRisk.length ? Number((highRiskPassed / highRisk.length).toFixed(4)) : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const goldenSet = await readGoldenSet();

  if (args.validateOnly || !process.env.ECOCO_BASE_URL) {
    const payload = {
      mode: args.validateOnly ? 'validate-only' : 'validate-only-no-ECOCO_BASE_URL',
      cases: goldenSet.cases.length,
      message: 'Golden set is valid. Set ECOCO_BASE_URL to run live chat evals.',
    };
    console.log(args.json ? JSON.stringify(payload, null, 2) : `${payload.message} cases=${payload.cases}`);
    return;
  }

  const results = [];
  for (let i = 0; i < goldenSet.cases.length; i += 1) {
    const item = goldenSet.cases[i];
    try {
      const result = await runCase(item, i, { baseUrl: process.env.ECOCO_BASE_URL });
      results.push(result);
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${item.id} (${result.judge})`);
      if (!result.pass) console.log(`  ${result.rationale}`);
    } catch (err) {
      results.push({
        id: item.id,
        category: item.category,
        risk: item.risk,
        question: item.question,
        answer: '',
        pass: false,
        score: 0,
        missing: item.must_include,
        forbidden: [],
        rationale: err.message,
        judge: 'error',
      });
      console.log(`FAIL ${item.id} error=${err.message}`);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    golden_set_version: goldenSet.version,
    summary: summarize(results),
    results,
  };

  await fs.mkdir('evals/reports', { recursive: true });
  const outputPath = `evals/reports/eval-${new Date().toISOString().slice(0, 10)}.json`;
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Eval summary: ${report.summary.passed}/${report.summary.total} passed (${report.summary.passRate})`);
  console.log(`Report: ${outputPath}`);

  if (report.summary.passRate < Number(process.env.EVAL_MIN_PASS_RATE || 0.85)) {
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
  deterministicJudge,
  readGoldenSet,
  summarize,
};
