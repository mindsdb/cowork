#!/usr/bin/env node
// CSS usage census for the legacy stylesheet retirement (ENG-1020).
//
// Classifies every class selector and @keyframes name in the legacy CSS
// files as used / dead by scanning all renderer + main source, HTML entry
// points, and SVGs. Run it before deleting anything from globals.css or
// styles.css, and re-run as migration phases retire more classes:
//
//   node scripts/css-usage-census.mjs
//
// Exit code 0 always — this is a report, not a gate. Pipe to a file to
// diff between phases.
//
// Matching rules (each one exists because a naive version shipped a bug):
//   - Comments are stripped from CSS before collecting names, so
//     commented-out selectors don't count as definitions.
//   - A class is "used" if its exact name appears ANYWHERE in source —
//     substring match, deliberately conservative (`typing-dots` keeps
//     `typing-dot` alive).
//   - Dynamic names: a class also counts as used when a dash-prefix of it
//     is being template-composed (`menu-item${...}`), so `menu-item-on`
//     survives even if only built dynamically.
//   - Runtime-injected classes can NEVER be proven dead by this scan:
//     highlight.js emits `hljs-*` / `class_` / `function_` at runtime;
//     third-party kits (gravity-field) add their own. Those families are
//     allowlisted below — extend the list when adopting a library that
//     injects classes.
//   - Keyframes: referenced from CSS `animation(-name)` shorthands AND
//     from JSX inline styles AND from Tailwind arbitrary utilities like
//     `animate-[queue-pop-in_220ms_ease]` — where the name is followed by
//     an underscore, not a word boundary. The keyframe matcher treats `_`
//     as a boundary for CSS-side names precisely because of that case.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const CSS_FILES = [
  'src/renderer/cowork/styles/globals.css',
  'src/renderer/styles.css',
];

// Class-name families injected at runtime by libraries — unprovable by
// static scan, always treated as used.
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
for (const entry of ['index.html']) {
  try { statSync(entry); sources.push(entry); } catch {}
}
const blob = sources.map((p) => readFileSync(p, 'utf8')).join('\n');
const cssBlob = CSS_FILES.map((p) => readFileSync(p, 'utf8')).join('\n');

function classIsUsed(name) {
  if (RUNTIME_INJECTED.some((re) => re.test(name))) return true;
  if (blob.includes(name)) return true;
  // dynamic-suffix heuristic: any dash-prefix composed via template literal
  let i = name.lastIndexOf('-');
  while (i > 0) {
    const prefix = name.slice(0, i + 1);
    if (blob.includes(prefix + '${') || blob.includes('`' + prefix)) return true;
    i = name.lastIndexOf('-', i - 1);
  }
  return false;
}

function keyframeIsUsed(name, ownFile) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CSS animation shorthand/longhand references (any css file in src)
  const cssRef = new RegExp(
    `animation(?:-name)?\\s*:[^;]*(?<![\\w-])${esc}(?![\\w-])`
  );
  if (cssRef.test(cssBlob)) return true;
  // other css files (arcade.css, skin css) — scan them too
  // JS/JSX references: inline styles, animationName, and Tailwind
  // arbitrary values (animate-[name_duration...]) where `_` follows.
  const jsRef = new RegExp(`(?<![\\w-])${esc}(?![\\w-])|animate-\\[${esc}_`);
  return jsRef.test(blob);
}

for (const f of CSS_FILES) {
  const raw = readFileSync(f, 'utf8');
  const css = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // url(...) payloads and quoted strings hold dots that are not class
    // selectors (font file extensions, data URIs, content: values)
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
