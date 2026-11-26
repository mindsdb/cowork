// The spellings a doc's code block highlights, as cowork-server's Pygments
// side does. The pinned fixture is the contract between the two.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import hljsCore from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import {
  CODE_LANGUAGES, DOC_CODE_MAX_CHARS, DOC_CODE_SPELLINGS, fitsDocCodeLimit, highlightCode, isDocCodeLanguage,
} from './hljs';

const BYTES = readFileSync(resolve(__dirname, '../../__fixtures__/docs-code-highlight/contract.json'));
// The same digest is pinned in cowork-server's tests/test_docs_highlight.py.
const SHA256 = '49bff234452131da4bbf58257056fbd66bb75e9e078cf047bb3dd34a09ba0f17';
const contract = JSON.parse(BYTES);
const MODULES = { bash, css, diff, dockerfile, go, javascript, json, markdown, python, rust, shell, sql, typescript, xml, yaml };
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'" };

/** The text hljs markup shows, and each span as {cls, start, end, depth}. */
function read(markup) {
  const spans = [];
  const open = [];
  let text = '';
  for (const m of markup.matchAll(/<span class="([^"]+)">|<\/span>|&[#\w]+;|[^<&]+/g)) {
    if (m[1]) open.push({ cls: m[1].split(' ')[0].replace(/^hljs-/, ''), start: text.length, depth: open.length });
    else if (m[0] === '</span>') spans.push({ ...open.pop(), end: text.length });
    else text += ENTITIES[m[0]] ?? m[0];
  }
  return { text, spans };
}

function classOf({ text, spans }, sub) {
  const start = text.indexOf(sub);
  expect(start, sub).toBeGreaterThanOrEqual(0);
  const end = start + sub.length;
  const holding = spans.filter((s) => s.start <= start && s.end >= end).sort((a, b) => b.depth - a.depth);
  if (holding.length) return holding[0].cls;
  return spans.some((s) => s.start < end && s.end > start) ? 'straddles a span' : null;
}

describe('doc code languages', () => {
  it('pins the fixture cowork-server pins', () => {
    expect(createHash('sha256').update(BYTES).digest('hex')).toBe(SHA256);
  });

  it('highlights the contract\'s spellings with its modules, up to its limit', () => {
    expect(Object.fromEntries(Object.entries(DOC_CODE_SPELLINGS).map(([k, [mod, name]]) => [k, { mod, name }])))
      .toEqual(Object.fromEntries(Object.entries(contract.languages).map(([k, v]) => [k, { mod: v.hljs, name: v.name }])));
    expect(CODE_LANGUAGES).toEqual([...new Set(Object.values(contract.languages).map((v) => v.name))]);
    expect(DOC_CODE_MAX_CHARS).toBe(contract.max_chars);
  });

  it('reads a spelling in any case and around spaces', () => {
    for (const lang of ['python', 'py', 'PY', ' py ']) expect(isDocCodeLanguage(lang)).toBe(true);
    for (const lang of ['java', '', null, undefined]) expect(isDocCodeLanguage(lang)).toBe(false);
  });

  it('turns down the spellings hljs knows only from its modules', () => {
    // The page has no lexer for these, so the editor leaves them plain too.
    const extra = Object.values(MODULES).flatMap((def) => def(hljsCore).aliases || [])
      .map((a) => a.toLowerCase()).filter((a) => !(a in contract.languages));
    expect(extra).toEqual(expect.arrayContaining(['svg', 'mjs']));
    for (const alias of extra) expect(isDocCodeLanguage(alias)).toBe(false);
  });

  it.each(Object.keys(contract.anchors))('gives the main tokens of %s the page\'s classes', (spelling) => {
    const { code, expect: pairs } = contract.anchors[spelling];
    const shown = read(highlightCode(code, spelling).html);
    expect(shown.text).toBe(code);
    expect(pairs.map(([sub]) => [sub, classOf(shown, sub)])).toEqual(pairs);
  });

  it('counts the limit in code points, as the page does', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(fitsDocCodeLimit('x'.repeat(DOC_CODE_MAX_CHARS))).toBe(true);
    expect(fitsDocCodeLimit('x'.repeat(DOC_CODE_MAX_CHARS + 1))).toBe(false);
    expect(fitsDocCodeLimit(emoji.repeat(DOC_CODE_MAX_CHARS))).toBe(true);
  });
});
