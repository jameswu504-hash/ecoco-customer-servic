const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getLimit } = require('../routes/dashboard.routes');

test('getLimit applies fallback and maximum boundaries', () => {
  assert.equal(getLimit(undefined, 10, 200), 10);
  assert.equal(getLimit('50', 10, 200), 50);
  assert.equal(getLimit('9999', 10, 200), 200);
  assert.equal(getLimit('-3', 10, 200), 10);
  assert.equal(getLimit('abc', 10, 200), 10);
});

test('dashboard main entry serves the v2 shell before static files', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeIndex = server.indexOf("app.get('/dashboard.html'");
  const staticIndex = server.indexOf('app.use(express.static');

  assert.ok(routeIndex > -1);
  assert.ok(staticIndex > -1);
  assert.ok(routeIndex < staticIndex);
  assert.match(server, /dashboard-v2\.html/);
});

test('session detail UI ignores stale async responses and offers retry', () => {
  const dashboardJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

  assert.match(dashboardJs, /data-session-id=/);
  assert.match(dashboardJs, /box\.dataset\.sessionId === sessionId/);
  assert.match(dashboardJs, /data-session-retry-id/);
  assert.match(dashboardJs, /function escapeCss/);
  assert.match(dashboardJs, /sessionMessagesCache\.clear\(\)/);
});

test('session list queries use deterministic ordering for pagination', () => {
  const dashboardRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dashboard.routes.js'), 'utf8');

  assert.match(dashboardRoutes, /ORDER BY last_at DESC, started_at DESC, session_id ASC/);
  assert.match(dashboardRoutes, /ORDER BY session_rows\.last_at DESC, session_rows\.started_at DESC, session_rows\.session_id ASC/);
  assert.match(dashboardRoutes, /ORDER BY MAX\(timestamp\) DESC, started_at DESC, session_id ASC/);
});
