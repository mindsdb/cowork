#!/usr/bin/env node
// Fails if anything under src/renderer/cowork/ touches `window.antontron`
// directly. The cowork SPA must go through src/renderer/platform/host.ts
// so it stays shell-agnostic (Electron + web SPA).
//
// Wired as `npm run check:cowork-purity` and run in CI.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TARGET = join(ROOT, 'src/renderer/cowork');
const PATTERN = /window\.antontron/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (/\.(jsx?|tsx?)$/.test(entry)) {
      yield full;
    }
  }
}

const offenders = [];
for (const file of walk(TARGET)) {
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (PATTERN.test(line)) {
      offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error('cowork-purity: src/renderer/cowork must not touch window.antontron directly.');
  console.error('Use src/renderer/platform/host.ts (the host abstraction) instead.\n');
  for (const o of offenders) console.error('  ' + o);
  console.error(`\n${offenders.length} offender(s).`);
  process.exit(1);
}

console.log('cowork-purity: OK — no window.antontron usage in src/renderer/cowork/');
