// Scoped highlight.js setup — only the languages we want to support
// in chat code blocks are registered. Keeping the list curated holds
// bundle size down (each language module is 1–5 KB gzipped; the full
// pack is ~250 KB). Unknown languages fall back to plaintext.
// The same table decides what a doc's code block highlights.
//
// Token classes emitted by hljs (`.hljs-keyword`, `.hljs-string`, …)
// are styled in cowork/styles/globals.css under a `.anton-code-block
// code.hljs` scope so they can't leak into other surfaces.

import hljs from 'highlight.js/lib/core';

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

const MODULES = {
  bash, css, diff, dockerfile, go, javascript, json, markdown, python, rust, shell, sql, typescript, xml, yaml,
};

// Each spelling registered here, as [hljs module, a doc's canonical name]. A
// doc's code block highlights only these: cowork-server colours the same ones
// with Pygments (cowork/docs/highlight.py), and
// __fixtures__/docs-code-highlight/contract.json pins both.
export const DOC_CODE_SPELLINGS = Object.freeze({
  bash: ['bash', 'bash'], sh: ['bash', 'bash'],
  shell: ['shell', 'shell'], zsh: ['shell', 'shell'],
  css: ['css', 'css'],
  diff: ['diff', 'diff'], patch: ['diff', 'diff'],
  dockerfile: ['dockerfile', 'dockerfile'], docker: ['dockerfile', 'dockerfile'],
  go: ['go', 'go'], golang: ['go', 'go'],
  javascript: ['javascript', 'javascript'], js: ['javascript', 'javascript'], jsx: ['javascript', 'javascript'],
  json: ['json', 'json'],
  markdown: ['markdown', 'markdown'], md: ['markdown', 'markdown'],
  python: ['python', 'python'], py: ['python', 'python'],
  rust: ['rust', 'rust'], rs: ['rust', 'rust'],
  sql: ['sql', 'sql'],
  typescript: ['typescript', 'typescript'], ts: ['typescript', 'typescript'], tsx: ['typescript', 'typescript'],
  xml: ['xml', 'xml'], html: ['xml', 'html'],
  yaml: ['yaml', 'yaml'], yml: ['yaml', 'yaml'],
});

for (const [spelling, [module]] of Object.entries(DOC_CODE_SPELLINGS)) {
  hljs.registerLanguage(spelling, MODULES[module]);
}

/** The names a doc's language box suggests. */
export const CODE_LANGUAGES = [...new Set(Object.values(DOC_CODE_SPELLINGS).map(([, name]) => name))];

/** Over this many code points a doc's code block is plain text, on its page too. */
export const DOC_CODE_MAX_CHARS = 10000;

/**
 * Whether a doc's code block highlights `lang`. hljs also knows its modules'
 * own aliases (svg, mjs…), which the page cannot colour.
 */
export function isDocCodeLanguage(lang) {
  return Object.hasOwn(DOC_CODE_SPELLINGS, String(lang ?? '').trim().toLowerCase());
}

/** Whether `code` is within DOC_CODE_MAX_CHARS code points (the page counts them, not UTF-16 units). */
export function fitsDocCodeLimit(code) {
  return code.length <= DOC_CODE_MAX_CHARS || [...code].length <= DOC_CODE_MAX_CHARS;
}

// Lower-case the lang tag once so callers don't have to. Returns the
// canonical hljs language name (after alias resolution) for the
// header label.
function resolveLanguage(lang) {
  if (!lang) return null;
  const lower = String(lang).trim().toLowerCase();
  if (!lower) return null;
  const language = hljs.getLanguage(lower);
  return language ? lower : null;
}

// Minimal HTML escape for the plaintext fallback. We don't route through
// `hljs.highlight(..., { language: 'plaintext' })` because the core build
// doesn't ship a plaintext language module — registering one just to
// escape three characters isn't worth the extra weight.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Highlight `source` for `lang`. If `lang` isn't registered (or is
 * empty), returns plaintext-escaped HTML so callers can render the
 * raw source safely without branching at the call site. Never throws.
 */
export function highlightCode(source, lang) {
  const resolved = resolveLanguage(lang);
  if (!resolved) {
    return { html: escapeHtml(source), language: 'plaintext' };
  }
  try {
    return {
      html: hljs.highlight(source ?? '', { language: resolved, ignoreIllegals: true }).value,
      language: resolved,
    };
  } catch {
    return { html: escapeHtml(source), language: 'plaintext' };
  }
}
