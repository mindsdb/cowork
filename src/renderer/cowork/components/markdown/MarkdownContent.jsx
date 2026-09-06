import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';

import { MarkdownCode } from './MarkdownCode';
import {
  MarkdownTable,
  TableHead,
  TableCell,
  TableRow,
  TableHeader,
  TableBody,
} from './MarkdownTable';
import { host } from '../../../platform/host';
import { useSkillNames } from '../../lib/skillsStore';

// Highlight only known skill mentions at word boundaries so paths and and/or remain ordinary text.
// The mdast span/class survives the existing sanitize allowlist.
function remarkSkillMentions(names) {
  const set = names instanceof Set ? names : new Set(names || []);
  const splitText = (value) => {
    const re = /(^|\s)\/([\w-]+)/g;
    let m;
    let last = 0;
    let out = null;
    while ((m = re.exec(value)) !== null) {
      if (!set.has(m[2])) continue;
      out = out || [];
      const tokenStart = m.index + m[1].length; // index of "/"
      if (tokenStart > last) out.push({ type: 'text', value: value.slice(last, tokenStart) });
      out.push({
        type: 'skillMention',
        data: { hName: 'span', hProperties: { className: ['anton-skill-mention'] } },
        children: [{ type: 'text', value: `/${m[2]}` }],
      });
      last = tokenStart + m[2].length + 1;
    }
    if (out && last < value.length) out.push({ type: 'text', value: value.slice(last) });
    return out;
  };
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    const next = [];
    for (const child of node.children) {
      if (child.type === 'text') {
        const parts = splitText(child.value);
        if (parts) next.push(...parts);
        else next.push(child);
      } else {
        if (child.type !== 'code' && child.type !== 'inlineCode') walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree) => { if (set.size > 0) walk(tree); };
}

// Allow only HTTP(S) and OS-handled mailto links; other schemes could navigate Electron to
// privileged locations.
const _SAFE_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function isSafeExternalHref(href) {
  if (!href || typeof href !== 'string') return false;
  let url;
  try {
    url = new URL(href, 'http://_local');
  } catch {
    return false;
  }
  return _SAFE_HREF_SCHEMES.has(url.protocol);
}

// Neutralize local artifact links. Catch every Windows drive path but only artifact-shaped POSIX
// paths
// under .anton/artifacts or .cowork, preserving real web /route links. Other POSIX file paths
// remain a known gap.
export function isArtifactLocalPath(href) {
  if (!href || typeof href !== 'string') return false;
  const h = href.trim();
  if (/^[a-zA-Z]:[\\/]/.test(h)) return true; // C:\… or C:/… (Windows drive)
  if (/^(?:file|sandbox):/i.test(h)) return true; // Exclude real web/mail links before testing artifact markers; match markers only at path-segment
// boundaries.
  if (/^(?:https?|mailto):/i.test(h)) return false;
  return /(?:^|\/)\.anton\/artifacts\//.test(h) || /(?:^|\/)\.cowork\//.test(h);
}

const _ARTIFACT_LOCAL_LINK_TITLE =
  'This file is in the Live Artifacts panel — open or download it there';

// Replace local-file links before sanitization strips their hrefs, preserving text and an
// artifact-panel hint.
// The remaining href on the span is not allowlisted and is removed.
function remarkArtifactLocalLinks() {
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === 'link' && isArtifactLocalPath(child.url)) {
        child.data = {
          ...(child.data || {}),
          hName: 'span',
          hProperties: {
            ...((child.data && child.data.hProperties) || {}),
            className: ['artifact-local-link'],
            title: _ARTIFACT_LOCAL_LINK_TITLE,
          },
        };
      } else if (child.type !== 'code' && child.type !== 'inlineCode') {
        walk(child);
      }
    }
  };
  return (tree) => walk(tree);
}

function openMarkdownHref(href) {
  if (!isSafeExternalHref(href)) return;
  // Prefer the host bridge (Electron routes through shell.openExternal;
  // web falls back to window.open with noopener,noreferrer).
  if (host && typeof host.openExternal === 'function') {
    Promise.resolve(host.openExternal(href)).catch(() => {});
    return;
  }
  try { window.open(href, '_blank', 'noopener,noreferrer'); } catch {}
}

// Permit code classes for special renderers and engram: links for metadata chips.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    // Allow className explicitly; defaultSchema already preserves title globally for artifact-link
    // tooltips.
    span: [...(defaultSchema.attributes?.span || []), ['className']],
  },
  protocols: {
    ...(defaultSchema.protocols || {}),
    href: [...(defaultSchema.protocols?.href || []), 'engram'],
  },
};

// Remove indentation shared by all nonblank user lines so pasted prose is not mistaken for an
// indented
// code block. Preserve relative nesting and mixed-indentation content.
function _dedentUserText(text) {
  if (!text || typeof text !== 'string') return text;
  const lines = text.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.replace(/^[ \t]+/, '').length;
    if (indent < min) min = indent;
    if (min === 0) return text;
  }
  if (!Number.isFinite(min) || min === 0) return text;
  return lines.map((line) => (line.trim() ? line.slice(min) : line)).join('\n');
}

function _mergeInlineCodeLines(text) {
  if (!text || typeof text !== 'string') return text;
  // Allow trailing spaces/tabs/CR so inline-only code lines survive CRLF transport.
  const INLINE_ONLY = /^`([^`\n\r]+)`\s*$/;
  // Split on either LF or CRLF so lines don't carry a trailing \r that
  // breaks the $ anchor on the regex above.
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = INLINE_ONLY.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const run = [m[1]];
    let j = i + 1;
    while (j < lines.length) {
      const mj = INLINE_ONLY.exec(lines[j]);
      if (!mj) break;
      run.push(mj[1]);
      j += 1;
    }
    // Two consecutive inline-code lines is a plausible user pattern; require
    // at least three before auto-promoting to a fenced block.
    if (run.length >= 3) {
      out.push('```');
      out.push(...run);
      out.push('```');
      i = j;
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  return out.join('\n');
}

// Separate glued form fences from prose so markdown recognizes them as blocks and invokes the
// renderer.
function _normalizeFormFences(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(
    /([^\n])?(```data-vault-form[a-z\-]*\b[^\n]*\n[\s\S]*?\n[ \t]*```)([^\n])?/g,
    (_match, before, block, after) => {
      const prefix = before ? `${before}\n\n` : '';
      const suffix = after ? `\n\n${after}` : '';
      return `${prefix}${block}${suffix}`;
    },
  );
}

// Shield fenced/inline code from math rewriting while preserving line context. Known gaps are long
// backtick fences, multi-backtick spans, and unterminated streaming fences.
const _MD_CODE_REGION = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

const _isBlankRun = (s) => /^\s*$/.test(s);

// Disable unsafe KaTeX HTML and bound formula layout/macro work explicitly so dependency defaults
// cannot
// widen trust. Set errorColor here because KaTeX emits inline styles; use var(--danger) without a
// comma
// fallback because every theme defines it and happy-dom rejects the fallback form.
const _KATEX_OPTIONS = Object.freeze({
  trust: false,
  maxSize: 50,
  maxExpand: 1000,
  errorColor: 'var(--danger)',
});

// Normalize math before CommonMark consumes backslash delimiters. Convert \(…\) and \[…\] to double
// dollars; display delimiters become blocks only on their own line, preserving enclosing
// lists/quotes.
// Single-dollar math requires a non-digit/non-space opener, a closer not followed by a digit, and
// no $$ pair.
// This preserves currency; leading-digit math such as $2\pi$ stays literal and must use \(2\pi\).
export function _normalizeMathDelimiters(text) {
  if (!text || typeof text !== 'string') return text;
  if (
    text.indexOf('\\(') === -1 &&
    text.indexOf('\\[') === -1 &&
    text.indexOf('$') === -1
  ) {
    return text;
  }
  // Stash code with newline-free placeholders so normalization retains list/blockquote context,
  // then restore it verbatim.
  const code = [];
  const stashed = text.replace(_MD_CODE_REGION, (m) => {
    const token = `\u0000${code.length}\u0000`;
    code.push(m);
    return token;
  });
  const converted = _convertMathDelimiters(stashed);
  return converted.replace(/\u0000(\d+)\u0000/g, (_m, i) => code[Number(i)]);
}

function _convertMathDelimiters(text) {
  return text
    // Create display blocks only for delimiters on their own line; inserting blank lines elsewhere
    // would break enclosing lists/quotes.
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, body, offset, whole) => {
      const lineStart = whole.lastIndexOf('\n', offset - 1) + 1;
      const before = whole.slice(lineStart, offset);
      const after = whole.slice(offset + m.length).split('\n', 1)[0];
      const standalone = _isBlankRun(before) && _isBlankRun(after);
      return standalone ? `\n\n$$\n${body.trim()}\n$$\n\n` : `$$${body.trim()}$$`;
    })
    // Inline \( … \) → $$…$$ (single line → inline math).
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$$${body.trim()}$$`)
    // Native single-$ inline math, pandoc-guarded (see the block comment).
    // Lookarounds keep `$$` display pairs and currency dollars untouched.
    .replace(/(?<!\$)\$(?!\$)(?![\d\s])([^$\n]*?\S)\$(?!\$)(?!\d)/g, (_m, body) => `$$${body.trim()}$$`);
}

// Convert key:value metadata comments into sanitized engram: links for provenance chips;
// react-markdown
// otherwise drops them. Strip ordinary prose comments such as TODO rather than treating them as
// metadata.
const _ENGRAM_BODY_RE = /^\s*([a-z][a-z0-9_-]*:[^\s<>]+(?:\s+[a-z][a-z0-9_-]*:[^\s<>]+)*)\s*$/i;

function _engramCommentChips(body) {
  const match = _ENGRAM_BODY_RE.exec(body);
  if (!match) return '';

  const pairs = match[1].trim().split(/\s+/);
  return pairs
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx <= 0) return '';
      const key = pair.slice(0, idx);
      const val = pair.slice(idx + 1);
      // Encode metadata values in the synthetic URL; keep their readable text in the link label.
      return `[${key}: ${val}](engram:${encodeURIComponent(val)}?k=${encodeURIComponent(key)})`;
    })
    .filter(Boolean)
    .join(' ');
}

function _renderEngramComments(text) {
  if (!text || typeof text !== 'string') return text;

  let out = '';
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf('<!--', cursor);
    if (start === -1) {
      out += text.slice(cursor);
      break;
    }

    out += text.slice(cursor, start);
    const end = text.indexOf('-->', start + 4);
    if (end === -1) {
      break;
    }

    const chips = _engramCommentChips(text.slice(start + 4, end));
    if (chips) {
      // Leading space keeps the chip from glomming onto the preceding word.
      out += ` ${chips}`;
    }
    cursor = end + 3;
  }

  return out;
}

// Dense spacing is used by memory previews.
const _SIZES = {
  default: {
    root: 'markdown-content space-y-4 break-words text-body text-ink-2',
    p: 'font-body text-body text-ink-2 my-0 first:mt-0 last:mb-0',
    h1: 's-h2 text-ink mt-6 mb-3',
    h2: 's-h3 text-ink mt-5 mb-2',
    h3: 'font-display text-[14px] font-semibold uppercase tracking-wider text-ink-3 mt-4 mb-1.5',
    ul: 'list-disc pl-5 my-3 text-body text-ink-2 space-y-2.5',
    ol: 'list-decimal pl-5 my-3 text-body text-ink-2 space-y-2.5',
    blockquote: 'border-l-2 border-line pl-3 italic text-ink-3 my-3',
  },
  dense: {
    root: 'markdown-content space-y-2 break-words text-[12.5px] leading-[1.65] text-ink-2',
    p: 'font-body text-[12.5px] leading-[1.65] text-ink-2 my-0 first:mt-0 last:mb-0',
    h1: 's-h3 text-ink mt-3.5 mb-1.5',
    h2: 'font-display text-[14px] font-semibold text-ink mt-3 mb-1.5',
    h3: 'font-display text-[12px] font-semibold uppercase tracking-wider text-ink-3 mt-2.5 mb-1',
    ul: 'list-disc pl-5 my-1.5 text-[12.5px] leading-[1.65] text-ink-2 space-y-1',
    ol: 'list-decimal pl-5 my-1.5 text-[12.5px] leading-[1.65] text-ink-2 space-y-1',
    blockquote: 'border-l-2 border-line pl-3 italic text-ink-3 my-2 text-[12.5px]',
  },
};

export function MarkdownContent({
  text,
  id,
  complete = true,
  conversationId = null,
  dense = false,
  // User turns disable forms/charts so typed special fences cannot open side-effect renderers.
  variant = 'assistant',
  enableForms = true,
  enableCharts = true,
  // High-frequency coding-agent streams already arrive in visible chunks.
  // They can opt out of per-word DOM wrappers and animations so transcript
  // rendering never competes with typing in the composer.
  animateStreamingWords = true,
  // Merge inline-code runs only in assistant output; authored user/memory/artifact content must
  // preserve those choices.
  isAssistant = false,
}) {
  const rootRef = useRef(null);
  // Normalize form fences only when enabled, and merge inline-code runs only for assistant output.
  const normalized = useMemo(
    () => {
      // User turns are pasted/typed: strip a uniform copied-in indent so
      // CommonMark doesn't promote pasted prose to an indented code block.
      const source = variant === 'user' ? _dedentUserText(text) : text;
      const merged = isAssistant ? _mergeInlineCodeLines(source) : source;
      const formNormalized = enableForms ? _normalizeFormFences(merged) : merged;
      const withEngrams = _renderEngramComments(formNormalized);
      return _normalizeMathDelimiters(withEngrams);
    },
    [text, enableForms, isAssistant, variant],
  );
  const sz = dense ? _SIZES.dense : _SIZES.default;

  // Share the store’s stable skill-name set across markdown instances.
  const skillNames = useSkillNames();
  const remarkPlugins = useMemo(
    // Disable remark-math’s single-dollar parsing to preserve currency; the guarded normalizer
    // produces double-dollar math.
    () => [
      remarkGfm,
      [remarkMath, { singleDollarTextMath: false }],
      [remarkSkillMentions, skillNames],
      remarkArtifactLocalLinks,
    ],
    [skillNames],
  );

  // Delegate Copy clicks at the root so streaming block mounts need no individual listener
  // lifecycle.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (event) => {
      const btn = event.target?.closest?.('[data-copy-code]');
      if (!btn || !root.contains(btn)) return;
      const block = btn.closest('.anton-code-block');
      const codeEl = block?.querySelector('pre > code');
      if (!codeEl) return;
      // `data-source` carries the raw source captured at render time —
      // safer than reading the highlighted DOM's textContent.
      const source = codeEl.getAttribute('data-source') ?? codeEl.textContent ?? '';
      const finish = () => {
        const label = btn.querySelector('.anton-code-block-copy-label');
        btn.classList.add('is-copied');
        if (label) label.textContent = 'Copied';
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
          if (label) label.textContent = 'Copy';
          btn.classList.remove('is-copied');
        }, 1200);
      };
      // Clipboard APIs can be unavailable or reject in Electron; fall back to focused-document
      // textarea copying.
      const fallbackCopy = (text) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
        return ok;
      };
      const clip = navigator.clipboard;
      if (clip && typeof clip.writeText === 'function') {
        clip.writeText(source).then(finish, () => {
          if (fallbackCopy(source)) finish();
        });
      } else if (fallbackCopy(source)) {
        finish();
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, []);

  const streaming = !complete && animateStreamingWords;

  const components = useMemo(() => {
    // Keep renderer overrides stable so react-markdown does not remount nodes and restart every
    // word animation.
    // Index keys preserve existing streamed spans while new words append.
    const _animate = animateStreamingWords && !complete ? (children) => {
      let wordKey = 0;
      return Children.map(children, (child) => {
        if (typeof child !== 'string') return child;
        const words = child.match(/\s*\S+\s*/g);
        if (!words) return child;
        return words.map((word) => (
          <span key={wordKey++} className="stream-word">{word}</span>
        ));
      });
    } : null;

    return {
    code: (props) => (
      <MarkdownCode
        id={id}
        complete={complete}
        conversationId={conversationId}
        variant={variant}
        enableForms={enableForms}
        enableCharts={enableCharts}
        {...props}
      />
    ),
    table: (props) => <MarkdownTable {...props} />,
    thead: TableHeader,
    tbody: TableBody,
    tr: TableRow,
    th: TableHead,
    td: TableCell,
    p: ({ children, node, ...rest }) => (
      <p className={sz.p} {...rest}>{_animate ? _animate(children) : children}</p>
    ),
    h1: ({ children, node, ...rest }) => (
      <h1 className={sz.h1} {...rest}>{_animate ? _animate(children) : children}</h1>
    ),
    h2: ({ children, node, ...rest }) => (
      <h2 className={sz.h2} {...rest}>{_animate ? _animate(children) : children}</h2>
    ),
    h3: ({ children, node, ...rest }) => (
      <h3 className={sz.h3} {...rest}>{_animate ? _animate(children) : children}</h3>
    ),
    ul: (props) => <ul className={sz.ul} {...props} />,
    ol: (props) => <ol className={sz.ol} {...props} />,
    li: ({ children, node, ...rest }) => (
      <li className="text-ink-2 marker:text-ink-4" {...rest}>{_animate ? _animate(children) : children}</li>
    ),
    a: (props) => {
      const href = props.href || '';
      if (href.startsWith('engram:')) {
        return (
          <span
            className="inline-flex items-baseline gap-1 align-middle ml-1 mr-0.5 rounded-md border border-line bg-surface-2 px-1.5 py-[1px] text-[10.5px] font-mono text-ink-3 leading-[1.4] no-underline"
          >
            {props.children}
          </span>
        );
      }
      // Render unsupported schemes as inert text so links cannot navigate Electron to privileged
      // locations.
      if (!isSafeExternalHref(href)) {
        return (
          <span title="Link blocked: unsupported URL scheme">
            {props.children}
          </span>
        );
      }
      // Keep native accessible links but route clicks through host so Electron opens the OS browser
      // instead of
      // navigating its renderer. Provide visible keyboard focus and announce the new window.
      return (
        <a
          className="text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            openMarkdownHref(href);
          }}
        >
          {props.children}
          <span className="sr-only"> (opens in new window)</span>
        </a>
      );
    },
    blockquote: (props) => <blockquote className={sz.blockquote} {...props} />,
    strong: (props) => <strong className="font-semibold text-ink" {...props} />,
    em: (props) => <em className="italic text-ink-2" {...props} />,
    hr: () => <hr className="my-5 border-t border-line opacity-25" />,
    pre: (props) => {
      // Remove the outer pre when MarkdownCode renders its own block wrapper. Mark language-less
      // fenced code
      // as block too so it cannot fall through to inline styling.
      const child = Array.isArray(props.children) ? props.children[0] : props.children;
      const childClass = child?.props?.className || '';

      if (typeof childClass === 'string' && childClass.startsWith('language-')) {
        return props.children;
      }

      if (isValidElement(child)) {
        return cloneElement(child, { block: true });
      }

      return <pre className="my-2 overflow-x-auto" {...props} />;
    },
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, complete, conversationId, dense, variant, enableForms, enableCharts, animateStreamingWords]);

  return (
    <div ref={rootRef} className={`${sz.root}${streaming ? ' is-streaming' : ''}`}>
      <Markdown
        remarkPlugins={remarkPlugins}
        // Sanitize before KaTeX, retaining language-math wrappers. KaTeX then renders text-only TeX
        // using the
        // restricted options above; its generated markup is not sanitized again.
        rehypePlugins={[
          [rehypeSanitize, sanitizeSchema],
          [rehypeKatex, _KATEX_OPTIONS],
        ]}
        components={components}
      >
        {normalized || ''}
      </Markdown>
    </div>
  );
}
