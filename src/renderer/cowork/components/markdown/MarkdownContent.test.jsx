import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// MarkdownContent pulls in the platform host bridge, the skills store, and
// the code/table renderers. None are relevant to math rendering, so stub
// them to keep the test focused on the remark-math + rehype-katex pipeline.
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));
vi.mock('../../lib/skillsStore', () => ({ useSkillNames: () => new Set() }));
vi.mock('./MarkdownCode', () => ({
  MarkdownCode: (props) => <code>{props.children}</code>,
}));
vi.mock('./MarkdownTable', () => ({
  MarkdownTable: (p) => <table {...p} />,
  TableHead: (p) => <th {...p} />,
  TableCell: (p) => <td {...p} />,
  TableRow: (p) => <tr {...p} />,
  TableHeader: (p) => <thead {...p} />,
  TableBody: (p) => <tbody {...p} />,
}));

import { MarkdownContent, _normalizeMathDelimiters } from './MarkdownContent';

describe('_normalizeMathDelimiters', () => {
  it('rewrites inline \\(…\\) to single-line $$…$$', () => {
    expect(_normalizeMathDelimiters('where \\(a\\) is real')).toBe('where $$a$$ is real');
  });

  it('rewrites display \\[…\\] to a fenced $$ block', () => {
    expect(_normalizeMathDelimiters('\\[ x=1 \\]')).toBe('\n\n$$\nx=1\n$$\n\n');
  });

  it('handles several inline formulas on one line', () => {
    expect(_normalizeMathDelimiters('\\(a\\) and \\(b\\)')).toBe('$$a$$ and $$b$$');
  });

  it('rewrites pandoc-valid single-$ inline math to $$…$$', () => {
    expect(_normalizeMathDelimiters('plane $s = \\sigma + it$.')).toBe('plane $$s = \\sigma + it$$.');
    expect(_normalizeMathDelimiters('to $\\zeta(s) = 0$ (x)')).toBe('to $$\\zeta(s) = 0$$ (x)');
    expect(_normalizeMathDelimiters('$a$ and $b$')).toBe('$$a$$ and $$b$$');
    // Leading-digit single-$ is currency-ambiguous → left literal…
    expect(_normalizeMathDelimiters('the $2\\pi r$ term')).toBe('the $2\\pi r$ term');
    // …but the unambiguous \(…\) form always converts, digit or not.
    expect(_normalizeMathDelimiters('the \\(2\\pi r\\) term')).toBe('the $$2\\pi r$$ term');
  });

  it('leaves currency ($ followed by digit) as literal text', () => {
    // Single $, no closing → untouched.
    expect(_normalizeMathDelimiters('a $1 million prize')).toBe('a $1 million prize');
    // Paired, but the middle $ is followed by a digit → not a valid close.
    expect(_normalizeMathDelimiters('from $5 to $10 total')).toBe('from $5 to $10 total');
    expect(_normalizeMathDelimiters('costs $20,000 and $30,000')).toBe('costs $20,000 and $30,000');
  });

  it('does not disturb existing $$…$$ display pairs', () => {
    expect(_normalizeMathDelimiters('block $$x = 1$$ here')).toBe('block $$x = 1$$ here');
  });

  it('trims whitespace inside the delimiters', () => {
    expect(_normalizeMathDelimiters('\\(  x = 1  \\)')).toBe('$$x = 1$$');
  });

  it('leaves fenced code blocks untouched', () => {
    const src = 'before \\(a\\)\n```\nregex: \\(group\\)\n```\nafter \\[b\\]';
    const out = _normalizeMathDelimiters(src);
    expect(out).toContain('```\nregex: \\(group\\)\n```'); // code preserved verbatim
    expect(out.startsWith('before $$a$$')).toBe(true); // prose still converted
    expect(out).toContain('after $$b$$'); // in-line \[b\] → inline (not block)
  });

  // ── Review regression tests (PR #486) ──────────────────────────────────
  // Finding 1: code constructs must survive, not just triple-backtick fences.
  it('does not rewrite delimiters inside inline code spans or tilde fences', () => {
    expect(_normalizeMathDelimiters('write `$x$` or `\\(y\\)` for math'))
      .toBe('write `$x$` or `\\(y\\)` for math');
    expect(_normalizeMathDelimiters('~~~\n$x$ and \\[y\\]\n~~~'))
      .toBe('~~~\n$x$ and \\[y\\]\n~~~');
  });

  // Finding 2: display math must not break out of its Markdown container.
  it('keeps display math inside blockquotes / list items (inline fallback)', () => {
    expect(_normalizeMathDelimiters('> \\[x\\]')).toBe('> $$x$$');
    expect(_normalizeMathDelimiters('- item \\[x\\]')).toBe('- item $$x$$');
    // Standalone display still becomes a block (→ centered display math).
    expect(_normalizeMathDelimiters('p\n\n\\[ x=1 \\]\n\np')).toContain('$$\nx=1\n$$');
  });

  // Finding 2 follow-up: stashing code must not lose the line's real context.
  // A code span before display math on a container line must not fool the
  // "own line" test into promoting the formula to a block outside the quote.
  it('preserves line context across stashed code spans', () => {
    expect(_normalizeMathDelimiters('> `x` \\[x^2\\]')).toBe('> `x` $$x^2$$');
    expect(_normalizeMathDelimiters('- `y` \\[z\\]')).toBe('- `y` $$z$$');
  });

  // Finding 3: a currency $ must never be reused as a math opener.
  it('does not pair a currency $ with a later math opener', () => {
    // $5 cannot open (followed by a digit); $x$ still renders on its own.
    expect(_normalizeMathDelimiters('It costs $5;($x$ is the variable).'))
      .toBe('It costs $5;($$x$$ is the variable).');
  });

  it('is a no-op (fast path) when no math delimiters are present', () => {
    const src = 'plain text with no math at all';
    expect(_normalizeMathDelimiters(src)).toBe(src);
  });

  it('tolerates empty / non-string input', () => {
    expect(_normalizeMathDelimiters('')).toBe('');
    expect(_normalizeMathDelimiters(null)).toBe(null);
    expect(_normalizeMathDelimiters(undefined)).toBe(undefined);
  });
});

describe('MarkdownContent math rendering (end-to-end pipeline)', () => {
  it('renders inline \\(…\\) as KaTeX', () => {
    const { container } = render(
      <MarkdownContent text={'where \\(i=\\sqrt{-1}\\) holds'} complete />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull(); // inline, not display
  });

  it('renders display \\[…\\] as KaTeX display math', () => {
    const { container } = render(
      <MarkdownContent text={'\\[ \\operatorname{Re}(s)=\\frac12 \\]'} complete />,
    );
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('renders pandoc-valid single-$ inline math as KaTeX', () => {
    const { container } = render(
      <MarkdownContent text={'the complex plane $s = \\sigma + it$.'} complete />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull(); // inline
    expect(container.textContent).not.toContain('$'); // $ delimiters consumed
  });

  it('does NOT treat plain-prose currency as math', () => {
    const { container } = render(
      <MarkdownContent text={'It costs $5 and then $10 total.'} complete />,
    );
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toContain('$5 and then $10');
  });

  it('keeps KaTeX HTML extensions disabled for untrusted chat text', () => {
    const { container } = render(
      <MarkdownContent text={'\\(\\htmlClass{injected}{x}\\)'} complete />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.injected')).toBeNull();
  });

  it('caps user-controlled KaTeX dimensions', () => {
    const { container } = render(
      <MarkdownContent text={'\\(\\rule{500em}{500em}\\)'} complete />,
    );
    const styles = [...container.querySelectorAll('[style]')]
      .map((node) => node.getAttribute('style'))
      .join(' ');
    expect(styles).not.toContain('500em');
    expect(styles).toContain('50em');
    expect(container.querySelector('mspace')?.getAttribute('width')).toBe('50em');
    expect(container.querySelector('mspace')?.getAttribute('height')).toBe('50em');
  });

  it('recolors broken/unparseable TeX to the danger token, not KaTeX #cc0000', () => {
    // Unbalanced braces are a hard KaTeX parse error → rehype-katex emits a
    // `.katex-error` span. KaTeX writes the colour as an INLINE style (and the
    // span is not nested under `.katex`), so the only way to override its harsh
    // #cc0000 default is the `errorColor` option — a CSS rule cannot reach it.
    // Guard that here since nothing else pins the colour. (happy-dom drops the
    // comma-fallback `var(x, y)` form, which is why errorColor is plain
    // `var(--danger)`.)
    const { container } = render(
      <MarkdownContent text={'\\(\\frac{1}{\\)'} complete />,
    );
    const err = container.querySelector('.katex-error');
    expect(err).not.toBeNull();
    const style = err.getAttribute('style') || '';
    expect(style).toContain('var(--danger)');
    expect(style).not.toContain('cc0000');
  });
});
