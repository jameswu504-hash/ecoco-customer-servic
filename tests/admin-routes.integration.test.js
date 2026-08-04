const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createInternalRouter } = require('../routes/internal.routes');
const { createReportsRouter } = require('../routes/reports.routes');

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
    current.on('error', reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    }),
  };
}

function requireHeader(name, expected) {
  return (req, res, next) => {
    if (req.get(name) !== expected) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
}

test('operations report aggregates database metrics behind admin authentication', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('COUNT(DISTINCT session_id)')) {
        return { rows: [{ sessions: '2', total_messages: '7', user_messages: '4', ai_replies: '3' }] };
      }
      if (sql.includes('SELECT content, timestamp')) {
        return { rows: [{ content: '點數怎麼計算', timestamp: '2026-08-04T00:00:00.000Z' }] };
      }
      if (sql.includes('FROM ratings')) return { rows: [{ positive: '3', negative: '1' }] };
      if (sql.includes("COUNT(*) FILTER (WHERE COALESCE(status")) {
        return { rows: [{ total: '2', resolved: '1', manual: '1' }] };
      }
      if (sql.includes("GROUP BY COALESCE(status")) {
        return { rows: [{ status: 'resolved', count: '1' }, { status: 'manual', count: '1' }] };
      }
      if (sql.includes('SELECT id, question, reply')) {
        return { rows: [{ id: 8, question: '點數問題', reason: '待補知識', status: 'resolved' }] };
      }
      if (sql.includes('FROM knowledge_sections')) return { rows: [{ count: '12' }] };
      if (sql.includes('FROM knowledge_chunks')) return { rows: [{ count: '34' }] };
      throw new Error(`Unexpected report query: ${sql}`);
    },
  };
  const app = express();
  app.use('/api/reports', createReportsRouter({
    pool,
    requireAdminKey: requireHeader('x-admin-key', 'admin-test-key'),
    readJsonFile: filename => (
      filename.includes('customer-service-database')
        ? { dedupe_applied: { archived_duplicate_records_total: 5, method: 'hash' } }
        : { summary: { duplicate_groups: 1, conflicts_pending_review: 2 }, conflicts_pending_review: [] }
    ),
  }));
  const server = await listen(app);

  try {
    const unauthorized = await fetch(`${server.baseUrl}/api/reports/operations`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${server.baseUrl}/api/reports/operations?period=week`, {
      headers: { 'x-admin-key': 'admin-test-key' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.summary, {
      sessions: 2,
      totalMessages: 7,
      userMessages: 4,
      aiReplies: 3,
      knowledgeGaps: 2,
      resolvedGaps: 1,
      manualGaps: 1,
      positiveRatings: 3,
      negativeRatings: 1,
      satisfactionRate: 75,
    });
    assert.equal(payload.knowledge.ragChunks, 34);
    assert.match(payload.reportMarkdown, /ECOCO AI 客服週報/);
  } finally {
    await server.close();
  }
});

test('internal wiki search normalizes an invalid limit before querying PostgreSQL', async () => {
  let capturedParams = null;
  const app = express();
  app.use('/api/internal', createInternalRouter({
    pool: {
      async query(sql, params) {
        capturedParams = params;
        return { rows: [] };
      },
    },
    requireStaffKey: requireHeader('x-staff-key', 'staff-test-key'),
  }));
  const server = await listen(app);

  try {
    const response = await fetch(
      `${server.baseUrl}/api/internal/wiki/search?q=%E7%AB%99%E9%BB%9E&limit=abc`,
      { headers: { 'x-staff-key': 'staff-test-key' } }
    );

    assert.equal(response.status, 200);
    assert.equal(capturedParams[2], 10);
  } finally {
    await server.close();
  }
});

test('internal wiki create, update, archive and restore use staff-only HTTP routes', async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('COALESCE(MAX(sort_order)')) return { rows: [{ next: '2' }] };
      if (sql.includes('INSERT INTO internal_wiki_entries')) return { rows: [{ id: 9 }] };
      if (sql.includes('UPDATE internal_wiki_entries')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected internal wiki query: ${sql}`);
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/internal', createInternalRouter({
    pool,
    requireStaffKey: requireHeader('x-staff-key', 'staff-test-key'),
  }));
  const server = await listen(app);
  const headers = { 'content-type': 'application/json', 'x-staff-key': 'staff-test-key' };

  try {
    const unauthorized = await fetch(`${server.baseUrl}/api/internal/wiki`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '測試', content: '內容' }),
    });
    assert.equal(unauthorized.status, 401);

    const created = await fetch(`${server.baseUrl}/api/internal/wiki`, {
      method: 'POST', headers, body: JSON.stringify({ department: 'PM 營運', title: '站點流程', content: '內容' }),
    });
    assert.deepEqual(await created.json(), { success: true, id: 9 });

    const updated = await fetch(`${server.baseUrl}/api/internal/wiki/9`, {
      method: 'PUT', headers, body: JSON.stringify({ department: 'ops', title: '新版流程', content: '新版內容' }),
    });
    assert.equal(updated.status, 200);

    const archived = await fetch(`${server.baseUrl}/api/internal/wiki/9`, {
      method: 'DELETE', headers,
    });
    assert.equal(archived.status, 200);

    const restored = await fetch(`${server.baseUrl}/api/internal/wiki/9/restore`, {
      method: 'PATCH', headers,
    });
    assert.equal(restored.status, 200);
    assert.equal(queries.filter(item => item.sql.includes('UPDATE internal_wiki_entries')).length, 3);
  } finally {
    await server.close();
  }
});
