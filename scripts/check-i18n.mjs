// Translation guard (ENG-4149): keeps every locale in step with English.
//
//   npm run check:i18n                        check (CI runs this)
//   npm run check:i18n -- --json              machine-readable issues (the /i18n-sync skill)
//   npm run check:i18n -- --write-lock        record translations you just wrote
//   npm run check:i18n -- --accept <key>      English changed but the translation is still right
//   npm run check:i18n -- --verbose           list every hard-coded English string
//   npm run check:i18n -- --update-baseline   lower the hard-coded-string ratchet after moving strings
//
// The rules live in scripts/i18n/check-lib.mjs. Docs: docs/i18n/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  SOURCE,
  checkCatalogs,
  findLiterals,
  flattenCatalogs,
  summarize,
  updateLock,
} from './i18n/check-lib.mjs';

const LOCALES_DIR = 'src/shared/i18n/locales';
const LOCK_PATH = 'src/shared/i18n/i18n.lock.json';
const CONFIG_PATH = 'src/shared/i18n/i18n.config.json';
const SCAN_ROOT = 'src/renderer';
const SCAN_EXTENSIONS = new Set(['.jsx', '.tsx']);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((arg, i) => (arg === name && args[i + 1] ? [args[i + 1]] : []));

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : fallback);
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function loadCatalogs() {
  const catalogs = {};
  for (const locale of fs.readdirSync(LOCALES_DIR).sort()) {
    const dir = path.join(LOCALES_DIR, locale);
    if (!fs.statSync(dir).isDirectory()) continue;
    const byNamespace = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      byNamespace[path.basename(file, '.json')] = readJson(path.join(dir, file), {});
    }
    catalogs[locale] = flattenCatalogs(byNamespace);
  }
  return catalogs;
}

function scanLiterals(allow) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__fixtures__' || entry.name === 'visual-fixtures') continue;
        walk(p);
      } else if (SCAN_EXTENSIONS.has(path.extname(entry.name)) && !/\.test\./.test(entry.name)) {
        files.push(p);
      }
    }
  };
  walk(SCAN_ROOT);
  return files.flatMap((file) => findLiterals(fs.readFileSync(file, 'utf-8'), allow).map((hit) => ({ file, ...hit })));
}

/* Files this branch touched (committed or not), to point at the new strings
   first. Best effort: outside git, or without the base branch, it's empty. */
function changedFiles() {
  const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
  const base = process.env.I18N_BASE_REF || 'origin/staging';
  return new Set(`${run(`git diff --name-only ${base}...HEAD`)}\n${run('git diff --name-only HEAD')}`.split('\n').filter(Boolean));
}

const config = readJson(CONFIG_PATH, {});
const catalogs = loadCatalogs();
let lock = readJson(LOCK_PATH, {});

if (flag('--write-lock') || values('--accept').length) {
  lock = updateLock(catalogs, lock, { accept: values('--accept') });
  writeJson(LOCK_PATH, lock);
  console.log(`✓ wrote ${LOCK_PATH}`);
}

const { issues } = checkCatalogs(catalogs, lock);
const literals = scanLiterals(new Set(config.literalAllowlist ?? []));
const baseline = config.literalBaseline ?? Infinity;

if (flag('--update-baseline') && literals.length < baseline) {
  writeJson(CONFIG_PATH, { ...config, literalBaseline: literals.length });
  console.log(`✓ hard-coded string baseline lowered ${baseline} → ${literals.length}`);
}

if (flag('--json')) {
  console.log(JSON.stringify({
    source: SOURCE,
    locales: Object.keys(catalogs),
    issues,
    literals: { count: literals.length, baseline, hits: literals },
  }, null, 2));
  process.exit(issues.length || literals.length > baseline ? 1 : 0);
}

const effectiveBaseline = flag('--update-baseline') ? Math.min(baseline, literals.length) : baseline;
let failed = false;

if (issues.length) {
  failed = true;
  const counts = summarize(issues);
  console.error(`✗ translations out of step with English — ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}:\n`);
  for (const issue of issues) console.error(`  [${issue.kind}] ${issue.locale} ${issue.key} — ${issue.detail}`);
  console.error('\nFix with the /i18n-sync skill, or by hand: update the translations, then');
  console.error('  npm run check:i18n -- --write-lock');
  console.error('If English changed but a translation is still right:  npm run check:i18n -- --accept <key>');
} else {
  const keys = Object.keys(catalogs[SOURCE] ?? {}).length;
  console.log(`✓ i18n: ${keys} keys, ${Object.keys(catalogs).join(' / ')} in step with English`);
}

if (literals.length > effectiveBaseline) {
  failed = true;
  console.error(`\n✗ ${literals.length - effectiveBaseline} new hard-coded English string(s) in ${SCAN_ROOT} (baseline ${effectiveBaseline}, now ${literals.length}).`);
  console.error('  Put user-visible text through t() — see docs/i18n/README.md. Hits in files this branch changed:');
  const changed = changedFiles();
  const inChanged = literals.filter((hit) => changed.has(hit.file));
  for (const hit of (inChanged.length ? inChanged : literals).slice(0, 40)) console.error(`  ${hit.file}:${hit.line}  ${JSON.stringify(hit.text)}`);
} else {
  const note = literals.length < effectiveBaseline
    ? ` — below the baseline of ${effectiveBaseline}; lock in the progress with npm run check:i18n -- --update-baseline`
    : '';
  console.log(`✓ hard-coded English left to move: ${literals.length}${note}`);
  if (flag('--verbose')) for (const hit of literals) console.log(`  ${hit.file}:${hit.line}  ${JSON.stringify(hit.text)}`);
}

process.exit(failed ? 1 : 0);
