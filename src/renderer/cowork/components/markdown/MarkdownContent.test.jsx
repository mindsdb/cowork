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

// Flippable surface: the plugin passes `host.isWeb` into isArtifactLocalPath,
// and the two ENG-2421 end-to-end cases below need to prove BOTH sides of that
// gate — with a hard-coded value, dropping the flag pass would stay green.
const hostState = vi.hoisted(() => ({ isWeb: false }));
vi.mock('../../../platform/host', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, host: { ...mod.host, get isWeb() { return hostState.isWeb; } } };
});

import { MarkdownContent, _normalizeMathDelimiters, isArtifactLocalPath } from './MarkdownContent';

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

// ENG-1636: anton sometimes emits a finished file's local path (or a
// fabricated sandbox: URL) as a "download" link. It never resolves in chat, so
// the renderer neutralizes it and points the user at the Live Artifacts panel
// instead of leaving a dead link.
describe('isArtifactLocalPath', () => {
  it('detects Windows drive paths (forward or back slash)', () => {
    expect(isArtifactLocalPath('C:\\Users\\roland\\.anton\\artifacts\\x\\f.xlsx')).toBe(true);
    expect(isArtifactLocalPath('C:/Users/roland/f.xlsx')).toBe(true);
    expect(isArtifactLocalPath('d:\\data\\out.csv')).toBe(true);
  });

  it('detects file: and fabricated sandbox: URLs', () => {
    expect(isArtifactLocalPath('file:///Users/me/f.xlsx')).toBe(true);
    expect(isArtifactLocalPath('sandbox:/mnt/data/f.xlsx')).toBe(true);
    expect(isArtifactLocalPath('SANDBOX:/mnt/data/f.xlsx')).toBe(true);
  });

  it('detects POSIX artifact / .cowork paths that would sneak past the scheme check', () => {
    expect(isArtifactLocalPath('/Users/tzuchunlin/.cowork/projects/general/.anton/artifacts/x/f.xlsx')).toBe(true);
    expect(isArtifactLocalPath('/home/me/.anton/artifacts/x/f.xlsx')).toBe(true);
  });

  it('leaves legitimate links and non-string input alone', () => {
    expect(isArtifactLocalPath('https://example.com/report.xlsx')).toBe(false);
    expect(isArtifactLocalPath('/settings')).toBe(false); // web-mode route
    expect(isArtifactLocalPath('mailto:a@b.com')).toBe(false);
    expect(isArtifactLocalPath('')).toBe(false);
    expect(isArtifactLocalPath(null)).toBe(false);
    expect(isArtifactLocalPath(undefined)).toBe(false);
  });

  it('does NOT swallow a real web link whose path merely contains the marker', () => {
    // A published/served URL can legitimately contain these segments; it must
    // stay clickable, not get neutralized by the substring test.
    expect(isArtifactLocalPath('https://cdn.example.com/.cowork/asset.png')).toBe(false);
    expect(isArtifactLocalPath('https://pub.example.com/.anton/artifacts/x/index.html')).toBe(false);
    expect(isArtifactLocalPath('http://127.0.0.1:26866/api/v1/artifacts/x/budget.xlsx')).toBe(false);
  });

  it('catches a bare relative artifact path (no scheme)', () => {
    expect(isArtifactLocalPath('.anton/artifacts/x/budget.xlsx')).toBe(true);
  });
});

describe('isArtifactLocalPath — dead-by-construction pod shapes (ENG-2421)', () => {
  /*
   * The scratchpad pod hands the agent loopback URLs and /mnt/… paths that are
   * real INSIDE the pod and dead from the user's browser. Four users hit these
   * as live links in one week — two shapes slipped the neutraliser: loopback
   * escaped through the https? early-return, and bare /mnt/ missed both
   * POSIX markers.
   */
  it('neutralises loopback http(s) on web, where it points at the user\'s own machine', () => {
    expect(isArtifactLocalPath('http://127.0.0.1:8000/dashboard.html', { web: true })).toBe(true);
    expect(isArtifactLocalPath('http://localhost:3000/', { web: true })).toBe(true);
    expect(isArtifactLocalPath('HTTP://LOCALHOST:3000/', { web: true })).toBe(true);
    expect(isArtifactLocalPath('https://127.0.0.5/report.zip', { web: true })).toBe(true); // whole 127/8 range
    // URL normalisation makes shorthand loopback spellings the same dotted quad.
    expect(isArtifactLocalPath('http://127.1:8000/x', { web: true })).toBe(true);
    expect(isArtifactLocalPath('http://2130706433/x', { web: true })).toBe(true); // decimal 127.0.0.1
    expect(isArtifactLocalPath('http://0.0.0.0:8000/a', { web: true })).toBe(true);
    expect(isArtifactLocalPath('http://[::1]:8000/a', { web: true })).toBe(true);
  });

  it('keeps loopback clickable on desktop, where the sidecar and app dev servers are real', () => {
    expect(isArtifactLocalPath('http://127.0.0.1:26866/api/v1/artifacts/x/budget.xlsx', { web: false })).toBe(false);
    expect(isArtifactLocalPath('http://localhost:3000/', { web: false })).toBe(false);
    // The bare call IS the desktop behaviour — the default must never widen.
    expect(isArtifactLocalPath('http://localhost:3000/')).toBe(false);
  });

  it('does not swallow real remote links on web — the https bail still guards', () => {
    expect(isArtifactLocalPath('https://example.com/report.xlsx', { web: true })).toBe(false);
    expect(isArtifactLocalPath('https://view.mindshub.ai/r/abc', { web: true })).toBe(false);
    expect(isArtifactLocalPath('https://pub.example.com/.anton/artifacts/x/index.html', { web: true })).toBe(false);
    // A REGISTERED domain that merely starts with "127." — the loopback test
    // must match the full dotted quad, not the string prefix (review finding).
    expect(isArtifactLocalPath('https://127.net/logo.png', { web: true })).toBe(false);
    expect(isArtifactLocalPath('http://127.0.0.1.evil.example/x', { web: true })).toBe(false);
  });

  it('catches a bare /mnt pod path on every surface', () => {
    expect(isArtifactLocalPath('/mnt/cowork-shared/projects/acme/dashboard.html')).toBe(true);
    expect(isArtifactLocalPath('/mnt/data/out/report.zip', { web: true })).toBe(true);
  });

  it('leaves ordinary absolute routes and near-misses alone', () => {
    expect(isArtifactLocalPath('/settings', { web: true })).toBe(false);
    expect(isArtifactLocalPath('/mnt-docs/file', { web: true })).toBe(false); // anchor is the /mnt/ segment
    expect(isArtifactLocalPath('docs/mnt/file', { web: true })).toBe(false);
  });

  it('covers all four shapes users were handed (regression set, ENG-2421)', () => {
    expect(isArtifactLocalPath('sandbox:/mnt/cowork-shared/x/f.xlsx', { web: true })).toBe(true);
    expect(isArtifactLocalPath('file:///mnt/cowork-shared/x/f.xlsx', { web: true })).toBe(true);
    expect(isArtifactLocalPath('http://127.0.0.1:8000/f.xlsx', { web: true })).toBe(true);
    expect(isArtifactLocalPath('/mnt/cowork-shared/x/f.xlsx', { web: true })).toBe(true);
  });
});

describe('MarkdownContent artifact-local-path backstop (end-to-end)', () => {
  const PANEL_HINT = 'Live Artifacts panel';

  it('renders a POSIX artifact path as inert text pointing at the panel, not a link', () => {
    const path = '/Users/me/.cowork/projects/general/.anton/artifacts/x/Scorecard.xlsx';
    const { container } = render(
      <MarkdownContent text={`[Download Scorecard.xlsx](${path})`} complete />,
    );
    const span = container.querySelector(`span[title*="${PANEL_HINT}"]`);
    expect(container.querySelector('a')).toBeNull(); // no clickable/dead link
    expect(container.textContent).toContain('Download Scorecard.xlsx'); // text kept
    expect(span).not.toBeNull();
    expect(span.getAttribute('href')).toBeNull(); // wrapper can never navigate
  });

  it('renders a pod loopback link as inert panel text on web (ENG-2421)', () => {
    hostState.isWeb = true;
    try {
      const { container } = render(
        <MarkdownContent text={'[Download it here](http://127.0.0.1:8000/dashboard.html)'} complete />,
      );
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector(`span[title*="${PANEL_HINT}"]`)).not.toBeNull();
      expect(container.textContent).toContain('Download it here');
    } finally {
      hostState.isWeb = false;
    }
  });

  it('keeps the same loopback link clickable on desktop, where it can be real', () => {
    // hostState.isWeb is false here — the sidecar and a fullstack app's dev
    // server genuinely answer on loopback on desktop, so the net must not fire.
    const { container } = render(
      <MarkdownContent text={'[open the app](http://localhost:3000/)'} complete />,
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe('http://localhost:3000/');
  });

  it('renders a bare /mnt pod path as inert panel text (ENG-2421)', () => {
    const { container } = render(
      <MarkdownContent text={'[report.zip](/mnt/cowork-shared/projects/acme/report.zip)'} complete />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector(`span[title*="${PANEL_HINT}"]`)).not.toBeNull();
    expect(container.textContent).toContain('report.zip');
  });

  it('renders a Windows drive-path link (the majority case) as inert panel text', () => {
    // Windows `C:\…` hrefs get their scheme stripped by rehype-sanitize, so
    // catching them requires the pre-sanitize remark pass — guard that here.
    const path = 'C:\\Users\\roland\\.anton\\artifacts\\x\\report.xlsx';
    const { container } = render(
      <MarkdownContent text={`[Download report.xlsx](${path})`} complete />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector(`span[title*="${PANEL_HINT}"]`)).not.toBeNull();
  });

  it('renders a fabricated sandbox: link as inert text pointing at the panel', () => {
    const { container } = render(
      <MarkdownContent text={'[Get the file](sandbox:/mnt/data/report.xlsx)'} complete />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector(`span[title*="${PANEL_HINT}"]`)).not.toBeNull();
  });

  it('does NOT swallow a real external link', () => {
    const { container } = render(
      <MarkdownContent text={'[docs](https://example.com/report.xlsx)'} complete />,
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe('https://example.com/report.xlsx');
    expect(container.querySelector(`span[title*="${PANEL_HINT}"]`)).toBeNull();
  });

  it('does NOT swallow a real https link whose path contains the artifact marker', () => {
    const url = 'https://pub.example.com/.cowork/dashboards/index.html';
    const { container } = render(
      <MarkdownContent text={`[open dashboard](${url})`} complete />,
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe(url);
    expect(container.querySelector(`span[title*="${PANEL_HINT}"]`)).toBeNull();
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

describe('MarkdownContent streaming performance', () => {
  it('can render an incomplete coding-agent message without per-word DOM wrappers', () => {
    const { container } = render(
      <MarkdownContent
        text="The agent is still working on this change."
        complete={false}
        animateStreamingWords={false}
      />,
    );

    expect(container.querySelector('.stream-word')).toBeNull();
    expect(container.querySelector('.is-streaming')).toBeNull();
    expect(container).toHaveTextContent('The agent is still working on this change.');
  });
});
