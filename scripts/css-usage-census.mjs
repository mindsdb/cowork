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
//   - A class is "used" if its name appears in source as an exact token
//     (not inside a longer identifier — class attributes are
//     space-separated, so `onboarding-step-row` must NOT keep `step-row`
//     alive, and the Tailwind token `text-success-text` must not keep
//     `success-text`).
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
try { walk('tests', sources); } catch {} // Playwright e2e specs query the DOM too
for (const entry of ['index.html']) {
  try { statSync(entry); sources.push(entry); } catch {}
}
// Strip comments before matching — a class named only in prose ("Reuse the
// global .btn-primary styling — …") is not a usage. Whole-line `//` comments
// and block comments only; trailing same-line `//` is left alone so URLs
// (`https://…`) can't truncate real code.
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
  // dynamic-suffix heuristic: a dash-prefix of the name composed via a
  // template literal, with the interpolation starting RIGHT AFTER the
  // prefix (`menu-item${…}` keeps menu-item-on). A looser "any template
  // literal starting with this prefix" check false-kept 13 dead
  // settings-* classes off one `settings-section${…}` hit.
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
