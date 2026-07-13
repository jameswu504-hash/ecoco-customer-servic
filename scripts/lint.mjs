// 語法檢查：自動掃描所有 .js / .mjs 檔案並執行 node --check
// 取代 package.json 內原本手動列出 28 個檔案的 lint 指令（新增檔案時常忘記加入清單）
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const INCLUDE_DIRS = ['db', 'middleware', 'routes', 'services', 'scripts', 'public', 'config', 'tests'];
const EXTENSIONS = new Set(['.js', '.mjs']);

function collect(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      collect(full, files);
    } else if (EXTENSIONS.has(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

const files = [path.join(ROOT, 'server.js'), path.join(ROOT, 'knowledge.js')];
for (const dir of INCLUDE_DIRS) {
  try {
    collect(path.join(ROOT, dir), files);
  } catch {
    // 資料夾不存在則跳過
  }
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.error(`Syntax check failed: ${path.relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message));
  }
}

console.log(`Syntax check complete: ${files.length - failed}/${files.length} files passed`);
if (failed > 0) process.exit(1);
