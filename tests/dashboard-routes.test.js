const test = require('node:test');
const assert = require('node:assert/strict');

const { getLimit } = require('../routes/dashboard.routes');

test('getLimit applies fallback and maximum boundaries', () => {
  assert.equal(getLimit(undefined, 10, 200), 10);
  assert.equal(getLimit('50', 10, 200), 50);
  assert.equal(getLimit('9999', 10, 200), 200);
  assert.equal(getLimit('-3', 10, 200), 10);
  assert.equal(getLimit('abc', 10, 200), 10);
});
