const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const canonicalRoot = path.join(root, 'skills', 'ecoco-clean-brand-knowledge');
const agentRoot = path.join(root, '.agents', 'skills', 'ecoco-clean-brand-knowledge');

function listFiles(directory, base = directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath, base);
      return [path.relative(base, fullPath).replaceAll('\\', '/')];
    })
    .sort();
}

test('packaged agent skill is an exact mirror of the canonical ECOCO skill', () => {
  const canonicalFiles = listFiles(canonicalRoot);
  const agentFiles = listFiles(agentRoot);

  assert.deepEqual(agentFiles, canonicalFiles);
  for (const relativePath of canonicalFiles) {
    assert.equal(
      fs.readFileSync(path.join(agentRoot, relativePath), 'utf8'),
      fs.readFileSync(path.join(canonicalRoot, relativePath), 'utf8'),
      `${relativePath} differs from the canonical skill`
    );
  }
});

test('canonical ECOCO cleaning command resolves the current repository', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(canonicalRoot, 'scripts', 'clean-file.js')],
    { cwd: root, encoding: 'utf8' }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /必須提供 --input 與 --out-dir/);
  assert.doesNotMatch(result.stderr, /找不到 ECOCO 專案根目錄/);
});
