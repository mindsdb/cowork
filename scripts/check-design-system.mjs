// Design-system adoption guardrail (ENG-641 / ENG-1016).
//
// Migrating the app onto the shared `components/ui/` primitives is a RATCHET,
// not a big-bang. This guard counts known anti-patterns under
// src/renderer/cowork/ — raw <button>/<input>/<textarea> outside the
// primitives, and hardcoded colors — and fails CI only when a count RISES
// above the committed baseline. That way new code can't reintroduce what a
// sweep just removed, without blocking every PR on the existing backlog.
//
// Every sweep should LOWER the baseline: after intentionally removing
// violations, regenerate and commit the baseline —
//
//     npm run check:design-system -- --update
//
// Never raise a number just to make CI pass (same rule as the vitest
// coverage floors). A single line can opt out with a trailing `// ds-ignore`
// — use it sparingly, only for a genuinely-correct raw element (e.g. a native
// <input type="file">).
//
// Usage:
//   node scripts/check-design-system.mjs            # check against baseline
//   node scripts/check-design-system.mjs --update   # rewrite the baseline
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src/renderer/cowork';
const BASELINE_PATH = 'scripts/design-system-baseline.json';
const EXTENSIONS = new Set(['.jsx', '.tsx']);
const IGNORE = 'ds-ignore';
// The primitives themselves define the look, so raw elements there are the
// canonical implementation, not a violation.
const SKIP = (p) => p.includes(`${path.sep}components${path.sep}ui${path.sep}`) || p.includes('.test.');

const RULES = [
  {
    id: 'raw-button',
    match: (line) => /<button\b/.test(line),
    hint: 'Use <Button> from components/ui instead of a raw <button>.',
  },
  {
    id: 'raw-input',
    match: (line) => /<input\b/.test(line),
    hint: 'Use <Input> from components/ui for text inputs (a native file/checkbox/color input may add // ds-ignore).',
  },
  {
    id: 'raw-textarea',
    match: (line) => /<textarea\b/.test(line),
    hint: 'Use <Textarea> from components/ui instead of a raw <textarea>.',
  },
  {
    id: 'hardcoded-color',
    // A hex literal on a line that also names a color-ish CSS property, so we
    // catch `background: '#fff'` / `border: 1px solid #ccc` but not ids/paths.
    match: (line) =>
      /#[0-9a-fA-F]{3,8}\b/.test(line) &&
      /(color|background|border|fill|stroke|shadow|outline)/i.test(line),
    hint: 'Use a design token (var(--…) or a tailwind token alias) instead of a hardcoded hex color.',
  },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else if (EXTENSIONS.has(path.extname(entry.name)) && !SKIP(p)) files.push(p);
  }
  return files;
}

// Returns { totals: {ruleId: n}, byFile: {ruleId: {file: n}} }.
function scan() {
  const totals = Object.fromEntries(RULES.map((r) => [r.id, 0]));
  const byFile = Object.fromEntries(RULES.map((r) => [r.id, {}]));
  for (const file of walk(ROOT)) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      if (line.includes(IGNORE)) continue;
      for (const rule of RULES) {
        if (rule.match(line)) {
          totals[rule.id] += 1;
          byFile[rule.id][file] = (byFile[rule.id][file] || 0) + 1;
        }
      }
    }
  }
  return { totals, byFile };
}

const { totals, byFile } = scan();

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(totals, null, 2)}\n`);
  console.log(`✓ design-system baseline written to ${BASELINE_PATH}:`);
  for (const r of RULES) console.log(`    ${r.id}: ${totals[r.id]}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`✗ no baseline at ${BASELINE_PATH}. Generate it once with:\n    npm run check:design-system -- --update`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
const regressions = [];
const improvements = [];
for (const rule of RULES) {
  const now = totals[rule.id];
  const was = baseline[rule.id] ?? 0;
  if (now > was) regressions.push({ rule, now, was });
  else if (now < was) improvements.push({ rule, now, was });
}

if (regressions.length) {
  console.error('✗ design-system guardrail: new anti-patterns added (count rose above baseline)\n');
  for (const { rule, now, was } of regressions) {
    console.error(`  ${rule.id}: ${was} → ${now}  (+${now - was})`);
    console.error(`    ${rule.hint}`);
    const top = Object.entries(byFile[rule.id]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [file, n] of top) console.error(`      ${n.toString().padStart(3)}  ${file}`);
    console.error('');
  }
  console.error('If a raw element is genuinely correct, add a trailing `// ds-ignore`.');
  console.error('Do NOT raise the baseline to pass — that defeats the ratchet.');
  process.exit(1);
}

console.log('✓ design-system guardrail: no new anti-patterns.');
if (improvements.length) {
  console.log('  Nice — some counts dropped. Lock it in:  npm run check:design-system -- --update');
  for (const { rule, now, was } of improvements) console.log(`    ${rule.id}: ${was} → ${now}`);
}
