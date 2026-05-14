// Drop-in replacement for our old TextBlock in chat turns.
//
// Wires react-markdown + remark-gfm + rehype-sanitize with our own
// component overrides for code (charts!), tables, and basic block tags.
// Scoped Tailwind classes pick up our token colours so it follows the
// active theme automatically.

import { useEffect, useMemo, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import { MarkdownCode } from './MarkdownCode';
import {
  MarkdownTable,
  TableHead,
  TableCell,
  TableRow,
  TableHeader,
  TableBody,
} from './MarkdownTable';

// Allow the extra attributes our chart blocks need on <code>, and
// permit the `engram:` URL scheme on links so the engram-comment
// pre-processor (see `_renderEngramComments`) can route metadata
// through the `a` component override into a styled chip.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
  },
  protocols: {
    ...(defaultSchema.protocols || {}),
    href: [...(defaultSchema.protocols?.href || []), 'engram'],
  },
};

// Make sure ```data-vault-form fences always start on their own line.
// LLMs frequently glue the opening fence to the end of a sentence
// ("…fill in the form.```data-vault-form\n…"), which collapses the
// block into inline code and skips our renderer entirely. We hunt
// for the pattern wherever it appears and inject the missing
// newlines around it so the markdown parser treats it as a real
// fenced code block.
function _normalizeFormFences(text) {
  if (!text || typeof text !== 'string') return text;
  // Catches both `data-vault-form` (full spec) and
  // `data-vault-form-patch` (partial update) — the regex's lang
  // pattern is broad enough to cover any future `data-vault-form*`
  // variant we add without further changes.
  return text.replace(
    /([^\n])?(```data-vault-form[a-z\-]*\b[^\n]*\n[\s\S]*?\n[ \t]*```)([^\n])?/g,
    (_match, before, block, after) => {
      const prefix = before ? `${before}\n\n` : '';
      const suffix = after ? `\n\n${after}` : '';
      return `${prefix}${block}${suffix}`;
    },
  );
}

// Engram metadata in lessons.md / rules.md / profile.md is encoded
// as inline HTML comments at the end of each bullet, e.g.
//   `- CoinGecko rate-limits at 50 req/min <!-- topic:api ts:2026-02-27 -->`.
// react-markdown drops HTML by default, so the comment normally
// disappears entirely, taking the engram's provenance with it. We
// transform each comment into a sequence of markdown links with a
// special `engram:` URL scheme — those survive sanitization, and the
// `a` component override below picks the scheme up and renders each
// pair as a small chip.
//
// The scanner below is intentionally narrow: it only rewrites comment
// bodies that look like one or more `key:value` pairs (e.g. `topic:foo`,
// `ts:2026-02-27`, `source:consolidation`). Plain authorship comments
// like `<!-- TODO -->` or `<!-- not sure -->` are stripped.
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
      // The link text is what the user sees; the href carries the
      // engram scheme so the renderer can distinguish it from real
      // links. Encode the value so spaces / special chars don't
      // break the URL portion.
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

// Density-scoped class strings. `dense` halves the rhythm and shaves
// a step off every body-text role; used by memory previews where the
// reading column is narrower and we want more lessons on screen.
const _SIZES = {
  default: {
    root: 'markdown-content space-y-2 break-words text-body text-ink-2',
    p: 'font-body text-body text-ink-2 my-0 first:mt-0 last:mb-0',
    h1: 'font-display text-[20px] font-semibold text-ink mt-4 mb-2',
    h2: 'font-display text-[17px] font-semibold text-ink mt-4 mb-2',
    h3: 'font-display text-[14px] font-semibold uppercase tracking-wider text-ink-3 mt-3 mb-1',
    ul: 'list-disc pl-5 my-2 text-body text-ink-2 space-y-1',
    ol: 'list-decimal pl-5 my-2 text-body text-ink-2 space-y-1',
    blockquote: 'border-l-2 border-line pl-3 italic text-ink-3 my-2',
  },
  // `dense` is the memory-preview density. Trimmed one notch off
  // chat defaults (and a comfortable line-height) for an elegant
  // reading column without sacrificing readability.
  dense: {
    root: 'markdown-content space-y-2 break-words text-[12.5px] leading-[1.65] text-ink-2',
    p: 'font-body text-[12.5px] leading-[1.65] text-ink-2 my-0 first:mt-0 last:mb-0',
    h1: 'font-display text-[16px] font-semibold text-ink mt-3.5 mb-1.5 tracking-[-0.005em]',
    h2: 'font-display text-[14px] font-semibold text-ink mt-3 mb-1.5 tracking-[-0.005em]',
    h3: 'font-display text-[12px] font-semibold uppercase tracking-wider text-ink-3 mt-2.5 mb-1',
    ul: 'list-disc pl-5 my-1.5 text-[12.5px] leading-[1.65] text-ink-2 space-y-1',
    ol: 'list-decimal pl-5 my-1.5 text-[12.5px] leading-[1.65] text-ink-2 space-y-1',
    blockquote: 'border-l-2 border-line pl-3 italic text-ink-3 my-2 text-[12.5px]',
  },
};

export function MarkdownContent({ text, id, complete = true, conversationId = null, dense = false }) {
  const rootRef = useRef(null);
  const normalized = useMemo(
    () => _renderEngramComments(_normalizeFormFences(text)),
    [text],
  );
  const sz = dense ? _SIZES.dense : _SIZES.default;

  // Delegated click listener — every anton-code-block ships a [data-copy-code]
  // button rendered by MarkdownCode. A single listener at this root survives
  // streaming re-renders (blocks come and go as chunks arrive) without
  // attaching/detaching per-block handlers.
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
      const clip = navigator.clipboard;
      if (clip && typeof clip.writeText === 'function') {
        clip.writeText(source).then(finish).catch(() => {});
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, []);

  const components = useMemo(() => ({
    code: (props) => <MarkdownCode id={id} complete={complete} conversationId={conversationId} {...props} />,
    table: (props) => <MarkdownTable {...props} />,
    thead: TableHeader,
    tbody: TableBody,
    tr: TableRow,
    th: TableHead,
    td: TableCell,
    // Inline body styling — keep paragraphs compact and consistent
    // with the rest of the chat column.
    p: (props) => <p className={sz.p} {...props} />,
    h1: (props) => <h1 className={sz.h1} {...props} />,
    h2: (props) => <h2 className={sz.h2} {...props} />,
    h3: (props) => <h3 className={sz.h3} {...props} />,
    ul: (props) => <ul className={sz.ul} {...props} />,
    ol: (props) => <ol className={sz.ol} {...props} />,
    li: (props) => <li className="text-ink-2 marker:text-ink-4" {...props} />,
    a: (props) => {
      const href = props.href || '';
      // Engram metadata chip — see _renderEngramComments above. We
      // intercept the synthetic `engram:` href and render a small
      // pill instead of a link. Keying off the URL scheme keeps real
      // links untouched.
      if (href.startsWith('engram:')) {
        return (
          <span
            className="inline-flex items-baseline gap-1 align-middle ml-1 mr-0.5 rounded-md border border-line bg-surface-2 px-1.5 py-[1px] text-[10.5px] font-mono text-ink-3 leading-[1.4] no-underline"
            // Strip the children's <a> wrapper styling — react-markdown
            // hands us the linkified text as plain text children, so
            // we render straight into the chip.
          >
            {props.children}
          </span>
        );
      }
      return (
        <a
          className="text-accent underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
          {...props}
        />
      );
    },
    blockquote: (props) => <blockquote className={sz.blockquote} {...props} />,
    strong: (props) => <strong className="font-semibold text-ink" {...props} />,
    em: (props) => <em className="italic text-ink-2" {...props} />,
    hr: () => <hr className="my-3 border-t border-line" />,
    pre: (props) => {
      // Fenced code blocks (className starts with `language-`) are handed
      // off to MarkdownCode, which renders its own anton-code-block
      // wrapper. We drop the outer <pre> in that case so block-level
      // markup isn't nested inside a <pre>. Indented blocks (no
      // className) keep the original styled <pre>.
      const child = Array.isArray(props.children) ? props.children[0] : props.children;
      const childClass = child?.props?.className || '';
      if (typeof childClass === 'string' && childClass.startsWith('language-')) {
        return props.children;
      }
      return <pre className="my-2 overflow-x-auto" {...props} />;
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [id, complete, conversationId, dense]);

  return (
    <div ref={rootRef} className={sz.root}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {normalized || ''}
      </Markdown>
    </div>
  );
}
