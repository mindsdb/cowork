#!/usr/bin/env node
// Report candidate dead CSS with node scripts/css-usage-census.mjs; always exits 0.
// Static scans cannot prove runtime-injected classes dead: extend the allowlist for new libraries.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const CSS_FILES = [
  'src/renderer/cowork/styles/globals.css',
  'src/renderer/styles.css',
];

// Runtime-injected families cannot be proven dead by static scanning.
const RUNTIME_INJECTED = [/^hljs(-|$)/, /^class_$/, /^function_$/, /^gf-/];

const SRC_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.svg', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'coverage', '.git', 'release']);

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e) || e.startsWith('dist')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SRC_EXTS.has(extname(p)) && !CSS_FILES.some((c) => p.endsWith(c))) out.push(p);
  }
}

const sources = [];
walk('src', sources);
try { walk('tests', sources); } catch {}
for (const entry of ['index.html']) {
  try { statSync(entry); sources.push(entry); } catch {}
}
// Strip prose before matching, but retain trailing // to avoid truncating URLs in code.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const blob = sources.map((p) => stripComments(readFileSync(p, 'utf8'))).join('\n');
const cssBlob = CSS_FILES.map((p) => readFileSync(p, 'utf8')).join('\n');

function classIsUsed(name) {
  if (RUNTIME_INJECTED.some((re) => re.test(name))) return true;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(blob)) return true;
  // Require interpolation immediately after the dash-prefix; broader template matches falsely
  // retain sibling classes.
  let i = name.lastIndexOf('-');
  while (i > 0) {
    const prefix = name.slice(0, i + 1);
    if (blob.includes(prefix + '${')) return true;
    i = name.lastIndexOf('-', i - 1);
  }
  return false;
}

function keyframeIsUsed(name, ownFile) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cssRef = new RegExp(
    `animation(?:-name)?\\s*:[^;]*(?<![\\w-])${esc}(?![\\w-])`
  );
  if (cssRef.test(cssBlob)) return true;
  // Include inline styles and Tailwind arbitrary animations, where an underscore follows the
  // keyframe name.
  const jsRef = new RegExp(`(?<![\\w-])${esc}(?![\\w-])|animate-\\[${esc}_`);
  return jsRef.test(blob);
}

for (const f of CSS_FILES) {
  const raw = readFileSync(f, 'utf8');
  const css = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Ignore dots inside URLs and strings; they are not class selectors.
    .replace(/url\([^)]*\)/g, 'url()')
    .replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  const classes = new Set();
  for (const m of css.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)) classes.add(m[1]);
  const keyframes = new Set();
  for (const m of css.matchAll(/@keyframes\s+([a-zA-Z][\w-]*)/g)) keyframes.add(m[1]);

  const deadClasses = [...classes].sort().filter((n) => !classIsUsed(n));
  const deadKeyframes = [...keyframes].sort().filter((n) => !keyframeIsUsed(n, f));

  console.log(`\n=== ${f} ===`);
  console.log(`class names: ${classes.size} (${deadClasses.length} dead) · keyframes: ${keyframes.size} (${deadKeyframes.length} dead)`);
  if (deadClasses.length) console.log('DEAD classes:\n  ' + deadClasses.join('\n  '));
  if (deadKeyframes.length) console.log('DEAD keyframes:\n  ' + deadKeyframes.join('\n  '));
}
