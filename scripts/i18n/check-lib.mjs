// The rules behind `npm run check:i18n` (ENG-4149), as pure functions so
// scripts/i18n/check-lib.test.mjs can test them without touching the repo.
//
// English is the source. For every other locale the check finds:
//   missing      a key English has and the translation lacks
//   extra        a key only the translation has (English removed or renamed it)
//   invalid      a message that is not valid ICU MessageFormat
//   mismatch     a translation whose {arguments} or select branches differ
//                from English, or a plural with no `other` branch
//   unlocked     a translation the lock file has never recorded
//   stale        English changed since the translation was made
// and, across the renderer source, English hard-coded outside t().
//
// The lock (src/shared/i18n/i18n.lock.json) is what makes edits visible, not
// just additions. Per key and locale it records a hash of the English text
// the translation was made from, and a hash of the translation itself.
// `--write-lock` re-stamps an entry only when the translation text changed
// (it was retranslated), so changing English alone leaves the key stale
// until someone actually updates the translation, or accepts it as still
// right with `--accept <key>`.
import crypto from 'node:crypto';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

export const SOURCE = 'en';

export function hash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
}

/* { ns: nestedJson } → { "ns:a.b.c": "message" } */
export function flattenCatalogs(catalogsByNamespace) {
  const out = {};
  for (const [ns, catalog] of Object.entries(catalogsByNamespace)) {
    const walk = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) walk(value, path);
        else out[`${ns}:${path}`] = value;
      }
    };
    walk(catalog, '');
  }
  return out;
}

/* What a message needs from its caller: argument names with their kind, and
   the exact branches of every select. Plural branches are not compared:
   languages have different plural categories (Spanish and Portuguese add
   `many`), so only `other` is required. */
export function messageShape(message) {
  const args = new Map();
  const selects = new Map();
  const problems = [];
  const walk = (elements) => {
    for (const el of elements) {
      switch (el.type) {
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
          args.set(el.value, el.type === TYPE.argument ? 'text' : TYPE[el.type]);
          break;
        case TYPE.plural:
          args.set(el.value, 'plural');
          if (!el.options.other) problems.push(`plural {${el.value}} has no "other" branch`);
          for (const option of Object.values(el.options)) walk(option.value);
          break;
        case TYPE.select:
          args.set(el.value, 'select');
          selects.set(el.value, Object.keys(el.options).sort().join('|'));
          if (!el.options.other) problems.push(`select {${el.value}} has no "other" branch`);
          for (const option of Object.values(el.options)) walk(option.value);
          break;
        case TYPE.tag:
          args.set(`<${el.value}>`, 'tag');
          walk(el.children);
          break;
        default:
          break;
      }
    }
  };
  walk(parse(String(message), { captureLocation: false }));
  return { args, selects, problems };
}

function describeArgs(args) {
  return [...args.entries()].map(([name, kind]) => `${name}:${kind}`).sort().join(', ') || '(none)';
}

/* Compare one translation against English. */
export function compareMessages(source, translation) {
  let sourceShape;
  let targetShape;
  try { sourceShape = messageShape(source); } catch (err) { return [`English is not valid ICU: ${err.message}`]; }
  try { targetShape = messageShape(translation); } catch (err) { return [`not valid ICU: ${err.message}`]; }
  const problems = [...targetShape.problems];
  if (describeArgs(sourceShape.args) !== describeArgs(targetShape.args)) {
    problems.push(`arguments differ: English has ${describeArgs(sourceShape.args)}, translation has ${describeArgs(targetShape.args)}`);
  }
  for (const [name, branches] of sourceShape.selects) {
    if (targetShape.selects.get(name) !== branches) {
      problems.push(`select {${name}} branches differ: English has ${branches}, translation has ${targetShape.selects.get(name) ?? '(none)'}`);
    }
  }
  return problems;
}

/* catalogs: { locale: { "ns:key": message } } (already flattened).
   Returns { issues: [{ kind, locale, key, detail }] }. */
export function checkCatalogs(catalogs, lock = {}) {
  const issues = [];
  const source = catalogs[SOURCE] ?? {};
  for (const [key, message] of Object.entries(source)) {
    if (typeof message !== 'string') {
      issues.push({ kind: 'invalid', locale: SOURCE, key, detail: 'value must be a string' });
      continue;
    }
    try { messageShape(message); } catch (err) {
      issues.push({ kind: 'invalid', locale: SOURCE, key, detail: err.message });
    }
  }
  for (const [locale, messages] of Object.entries(catalogs)) {
    if (locale === SOURCE) continue;
    for (const key of Object.keys(source)) {
      if (!(key in messages)) {
        issues.push({ kind: 'missing', locale, key, detail: `English: ${JSON.stringify(source[key])}` });
        continue;
      }
      const translation = messages[key];
      if (typeof translation !== 'string') {
        issues.push({ kind: 'invalid', locale, key, detail: 'value must be a string' });
        continue;
      }
      for (const detail of compareMessages(source[key], translation)) {
        issues.push({ kind: detail.startsWith('not valid') ? 'invalid' : 'mismatch', locale, key, detail });
      }
      const entry = lock[key]?.[locale];
      if (!entry) {
        issues.push({ kind: 'unlocked', locale, key, detail: 'not in i18n.lock.json; run npm run check:i18n -- --write-lock after translating' });
      } else if (entry.from !== hash(source[key])) {
        issues.push({ kind: 'stale', locale, key, detail: `English is now ${JSON.stringify(source[key])}; translation is ${JSON.stringify(translation)}` });
      } else if (entry.text !== hash(translation)) {
        // Edited by hand without a lock write. Left alone, the next lock write
        // for any other key would re-stamp it from whatever English is then,
        // so a later English change could go unnoticed.
        issues.push({ kind: 'unlocked', locale, key, detail: 'translation changed since i18n.lock.json was written; run npm run check:i18n -- --write-lock' });
      }
    }
    for (const key of Object.keys(messages)) {
      if (!(key in source)) issues.push({ kind: 'extra', locale, key, detail: 'English no longer has this key' });
    }
  }
  return { issues };
}

/* The new lock. An entry is (re)stamped from the current English when it is
   new, when its translation text changed, or when its key is accepted.
   Otherwise it is kept as is, so a stale translation stays stale. */
export function updateLock(catalogs, lock = {}, { accept = [] } = {}) {
  const source = catalogs[SOURCE] ?? {};
  const accepted = (key) => accept.some((pattern) => key === pattern || key.startsWith(`${pattern}.`) || (pattern.endsWith(':') && key.startsWith(pattern)));
  const next = {};
  for (const key of Object.keys(source).sort()) {
    for (const [locale, messages] of Object.entries(catalogs)) {
      if (locale === SOURCE || typeof messages[key] !== 'string') continue;
      const current = lock[key]?.[locale];
      const text = hash(messages[key]);
      const entry = !current || current.text !== text || accepted(key)
        ? { from: hash(source[key]), text }
        : current;
      next[key] = { ...(next[key] ?? {}), [locale]: entry };
    }
  }
  // Stable key order inside each entry too, so the file diffs cleanly.
  for (const key of Object.keys(next)) {
    next[key] = Object.fromEntries(Object.entries(next[key]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return next;
}

/* English hard-coded in JSX: text between tags, and the attributes people
   read. A heuristic — it looks for capitalised words — so it is a ratchet
   on the total, not a per-line gate.
   JSX_TEXT: a capitalised word, a separator, then any letters and
   separators, ending on a letter and its trailing apostrophes. The letter
   and separator classes don't overlap, so each line splits one way only and
   a failed match can't backtrack exponentially. */
const JSX_TEXT = />\s*([A-Z][a-z]+[ ,.'’!?:;-][ ,.'’!?:;A-Za-z-]*[A-Za-z]['’]*[.!?…]?)\s*(?=[<{])/g;
const ATTRIBUTE = /\b(?:title|subtitle|placeholder|aria-label|ariaLabel|alt|label|description)=(?:"([A-Z][^"]*[a-z][^"]*)"|'([A-Z][^']*[a-z][^']*)')/g;

export function findLiterals(source, allow = new Set()) {
  const hits = [];
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const pattern of [JSX_TEXT, ATTRIBUTE]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line))) {
        const text = (match[1] ?? match[2] ?? '').trim();
        if (text && !allow.has(text)) hits.push({ line: index + 1, text });
      }
    }
  });
  return hits;
}

export function summarize(issues) {
  const counts = {};
  for (const issue of issues) counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  return counts;
}
