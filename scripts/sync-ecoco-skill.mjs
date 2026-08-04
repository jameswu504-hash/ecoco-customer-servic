import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const canonicalRoot = path.join(root, 'skills', 'ecoco-clean-brand-knowledge');
const mirrorRoot = path.join(root, '.agents', 'skills', 'ecoco-clean-brand-knowledge');

function assertSafeMirrorPath() {
  const expectedParent = path.join(root, '.agents', 'skills');
  if (path.dirname(mirrorRoot) !== expectedParent || path.basename(mirrorRoot) !== 'ecoco-clean-brand-knowledge') {
    throw new Error(`Refusing to replace unexpected skill mirror path: ${mirrorRoot}`);
  }
}

assertSafeMirrorPath();
if (!fs.statSync(canonicalRoot, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`Canonical ECOCO skill is missing: ${canonicalRoot}`);
}
fs.rmSync(mirrorRoot, { recursive: true, force: true });
fs.mkdirSync(path.dirname(mirrorRoot), { recursive: true });
fs.cpSync(canonicalRoot, mirrorRoot, { recursive: true });
console.log('ECOCO skill mirror synchronized from skills/ to .agents/skills/.');
