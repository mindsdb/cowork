// The editor's column and block typography, as the shared page (cowork-server's
// PAGE_CSS) copies them. The pinned fixture is the contract between the two.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RULES_BYTES = readFileSync(resolve(__dirname, '../../__fixtures__/docs-typography/rules.json'));
const shared = JSON.parse(RULES_BYTES);
// The same digest is pinned in cowork-server's tests/test_docs_page_typography.py.
const RULES_SHA256 = '621c3295182af196d7977c5c911ccc3e2fc9fc2fa51f7dfb49d5f3adb42be10d';

const read = (name) => readFileSync(resolve(__dirname, name), 'utf8');
// The design tokens live in tokens.css, which globals.css imports.
const GLOBALS = ['tokens.css', 'globals.css']
  .map((name) => readFileSync(resolve(__dirname, '../../styles', name), 'utf8')).join('\n');
const SIDES = ['top', 'right', 'bottom', 'left'];

function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const selector = (text) => text.trim().replace(/\s+/g, ' ').replace(/\s*([>+,])\s*/g, '$1');

/** Each selector's declarations in source order; a rule in @media is keyed `@media (...) sel`. */
function parse(css, prefix = '', rules = new Map()) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  for (let brace = src.indexOf('{', i); brace !== -1; brace = src.indexOf('{', i)) {
    const head = src.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    for (; depth; j += 1) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    const body = src.slice(brace + 1, j - 1);
    if (head.startsWith('@media')) parse(body, `@media ${head.slice(6).replace(/\s+/g, '')} `, rules);
    else if (!head.startsWith('@')) {
      const decls = splitTopLevel(body, ';').map((d) => {
        const at = d.indexOf(':');
        return [d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()];
      });
      for (const sel of splitTopLevel(head, ',')) {
        const key = prefix + selector(sel);
        rules.set(key, [...(rules.get(key) || []), ...decls]);
      }
    }
    i = j;
  }
  return rules;
}

const EDITOR = parse(read('doc.css') + read('docPane.css'));

function side(shorthand, which) {
  const p = shorthand.split(/\s+/);
  if (p.length === 1) p.push(p[0]);
  if (p.length === 2) p.push(p[0]);
  if (p.length === 3) p.push(p[1]);
  return p[SIDES.indexOf(which)];
}

function token(name) {
  const m = new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`, 'm').exec(GLOBALS);
  return m && m[1].trim();
}

/** The last value `prop` gets across `selectors` (then `.doc-root`, then the app's tokens). */
function value(selectors, prop) {
  let found = null;
  for (const sel of selectors) {
    for (const [name, v] of EDITOR.get(sel) || []) {
      const which = prop.split('-').at(-1);
      if (name === prop) found = v;
      else if ((name === 'padding' || name === 'margin') && prop.startsWith(`${name}-`) && SIDES.includes(which)) {
        found = side(v, which);
      }
    }
  }
  if (found === null && selectors[0] !== '.doc-root') found = prop.startsWith('--') ? value(['.doc-root'], prop) : null;
  if (found === null && prop.startsWith('--')) found = token(prop);
  return found && found.replace(/var\((--[\w-]+)\)/g, (m, name) => value(selectors, name) ?? m);
}

const norm = (v) => v.trim().toLowerCase().replace(/\s*,\s*/g, ',').replace(/(?<![\d.])0\.(\d)/g, '.$1');
const px = (v) => Number.parseFloat(v);

describe('doc typography shared with the page', () => {
  it('runs the pinned copy of the shared rules', () => {
    // A change to the rules stops here until its digest is pinned: the reminder to copy the
    // file to cowork-server and pin the same digest there. Neither suite reads the other's copy.
    expect(createHash('sha256').update(RULES_BYTES).digest('hex')).toBe(RULES_SHA256);
  });

  it.each(shared.rules.map((r) => [r.editor.join(' + '), r]))('%s', (_, rule) => {
    for (const [prop, want] of Object.entries(rule.css)) {
      expect([prop, norm(value(rule.editor, prop) ?? '')]).toEqual([prop, norm(want)]);
    }
  });

  it('narrows the gutter below the same pane width', () => {
    expect(/contentRect\.width < (\d+)/.exec(read('DocPane.jsx'))[1]).toBe(String(shared.narrow_below_px));
  });

  it('starts list text where the page does', () => {
    const { indent_step: indent, mark_min_width: mark, mark_gap: gap, task_box: box } = shared.list;
    expect(value(['.doc-li__mark'], 'min-width')).toBe(mark);
    expect(value(['.doc-li'], 'gap')).toBe(gap);
    expect(value(['.doc-check'], 'width')).toBe(box);
    expect(/paddingLeft: \(b\.indent \|\| 0\) \* (\d+)/.exec(read('TextBlock.jsx'))[1]).toBe(String(px(indent)));
  });
});

const CODE = JSON.parse(readFileSync(resolve(__dirname, '../../__fixtures__/docs-code-highlight/contract.json')));
// Only the hljs theme: the rest of globals.css holds at-rules and strings this parser doesn't read.
const THEME = parse(GLOBALS.slice(
  GLOBALS.indexOf('/* Scoped highlight.js theme'),
  GLOBALS.indexOf('/* ─── iOS auto-zoom suppression'),
));
const flat = (v) => v.replace(/\s+/g, '');

describe('code colours', () => {
  const SCOPE = ':is(.anton-code-block,.doc-code) .hljs-';
  const LIGHT = 'body[data-theme="light"] ';

  it.each(['dark', 'light'])('give a doc\'s code the %s palette the page uses', (theme) => {
    for (const [cls, value] of Object.entries(CODE.colors[theme])) {
      const prop = cls.endsWith('-bg') ? 'background' : 'color';
      const sel = SCOPE + cls.replace(/-bg$/, '');
      // The light theme overrides only some classes; the rest keep the dark rule.
      const decls = (theme === 'light' && THEME.get(LIGHT + sel)?.some(([p]) => p === prop))
        ? THEME.get(LIGHT + sel) : THEME.get(sel);
      expect(decls, sel).toBeDefined();
      expect(decls.filter(([p]) => p === prop).map(([, v]) => flat(v)).pop(), sel).toBe(flat(value));
    }
  });

  it('lay the highlight layer out as the code box, character for character', () => {
    const box = Object.fromEntries(EDITOR.get('.doc-code__text'));
    const layer = Object.fromEntries(EDITOR.get('.doc-code__hl'));
    for (const prop of ['padding', 'font-family', 'font-size', 'line-height', 'white-space', 'tab-size']) {
      expect(layer[prop], prop).toBe(box[prop]);
    }
  });
});
