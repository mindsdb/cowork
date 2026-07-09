// Purity guard  every file under src/renderer/cowork/ MUST reach
// the Electron bridge through src/renderer/platform/host.ts — never via
// window.antontron directly. host.ts's header comment has promised this
// guard since before it existed; this script makes it true.
//
// Usage: npm run check:cowork-purity   (wired into CI)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src/renderer/cowork';
const NEEDLE = 'antontron';
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.d.ts']);

const hits = [];

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(p);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    const lines = fs.readFileSync(p, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      // Any literal occurrence counts, comments included — lexing "is this a
      // comment/URL/string?" is how false negatives creep in. Don't mention
      // the bridge name under cowork/; reference host.ts instead.
      if (line.includes(NEEDLE)) hits.push(`${p}:${i + 1}: ${line.trim()}`);
    });
  }
}

scan(ROOT);

if (hits.length) {
  console.error(`✗ cowork purity violated — ${NEEDLE} referenced outside platform/host.ts:\n`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(
    '\nGo through src/renderer/platform/host.ts instead (see its header comment).',
  );
  process.exit(1);
}
console.log(`✓ cowork purity: no direct ${NEEDLE} access under ${ROOT}/`);
