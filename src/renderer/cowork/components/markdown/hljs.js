// Scoped highlight.js setup — only the languages we want to support
// in chat code blocks are registered. Keeping the list curated holds
// bundle size down (each language module is 1–5 KB gzipped; the full
// pack is ~250 KB). Unknown languages fall back to plaintext.
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

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('zsh', shell);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('patch', diff);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('docker', dockerfile);
hljs.registerLanguage('go', go);
hljs.registerLanguage('golang', go);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

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

/**
 * Highlight `source` for `lang`. If `lang` isn't registered (or is
 * empty), returns plaintext-escaped HTML so callers can render the
 * raw source safely without branching at the call site. Never throws.
 */
export function highlightCode(source, lang) {
  const resolved = resolveLanguage(lang);
  if (!resolved) {
    return {
      html: hljs.highlight(source ?? '', { language: 'plaintext', ignoreIllegals: true }).value,
      language: 'plaintext',
    };
  }
  try {
    return {
      html: hljs.highlight(source ?? '', { language: resolved, ignoreIllegals: true }).value,
      language: resolved,
    };
  } catch {
    return {
      html: hljs.highlight(source ?? '', { language: 'plaintext', ignoreIllegals: true }).value,
      language: 'plaintext',
    };
  }
}
