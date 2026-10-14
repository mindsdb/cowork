import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* Same stubs as MarkdownContent.test.jsx: the marks are text-level, so the
   code/table renderers and the skills store only need to stay out of the way. */
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

import { MarkdownContent } from './MarkdownContent';
import { NO_SOURCE_TEXT } from '../../lib/figureSources';

const RICH = [
  '## Stock check',
  '',
  'You have **250** units in stock at $42 each, see [the report](https://example.com/r/250).',
  '',
  '- Last quarter: $30',
  '- Query: `SELECT 250 FROM stock`',
  '',
  '| Item | Units |',
  '| --- | --- |',
  '| Mug | 250 |',
  '',
  'The growth rate is \\(r = 0.25\\).',
  '',
  '```sql',
  'SELECT 250;',
  '```',
].join('\n');

describe('MarkdownContent without figure sources', () => {
  it('renders an answer exactly as it did before figure sources existed', () => {
    const { container } = render(<MarkdownContent text={RICH} isAssistant />);
    expect(container.innerHTML).toMatchInlineSnapshot(`
      "<div class="markdown-content space-y-3 break-words text-body text-ink-2"><h2 class="s-h3 text-ink mt-5 mb-2">Stock check</h2>
      <p class="font-body text-body text-ink-2 my-0 first:mt-0 last:mb-0">You have <strong class="font-semibold text-ink" node="[object Object]">250</strong> units in stock at $42 each, see <a class="text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm" href="https://example.com/r/250" target="_blank" rel="noopener noreferrer">the report<span class="sr-only"> (opens in new window)</span></a>.</p>
      <ul class="list-disc pl-5 my-3 text-body text-ink-2 space-y-1" node="[object Object]">
      <li class="text-ink-2 marker:text-ink-4">Last quarter: $30</li>
      <li class="text-ink-2 marker:text-ink-4">Query: <code>SELECT 250 FROM stock</code></li>
      </ul>
      <table node="[object Object]"><thead node="[object Object]"><tr node="[object Object]"><th node="[object Object]">Item</th><th node="[object Object]">Units</th></tr></thead><tbody node="[object Object]"><tr node="[object Object]"><td node="[object Object]">Mug</td><td node="[object Object]">250</td></tr></tbody></table>
      <p class="font-body text-body text-ink-2 my-0 first:mt-0 last:mb-0">The growth rate is <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>r</mi><mo>=</mo><mn>0.25</mn></mrow><annotation encoding="application/x-tex">r = 0.25</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height: 0.4306em;"></span><span class="mord mathnormal" style="margin-right: 0.0278em;">r</span><span class="mspace" style="margin-right: 0.2778em;"></span><span class="mrel">=</span><span class="mspace" style="margin-right: 0.2778em;"></span></span><span class="base"><span class="strut" style="height: 0.6444em;"></span><span class="mord">0.25</span></span></span></span>.</p>
      <code>SELECT 250;
      </code></div>"
    `);
  });
});

const STOCK = { tool_use_id: 'toolu_01', kind: 'file', label: 'stock.csv', page: null };
const RATES = { tool_use_id: 'toolu_02', kind: 'file', label: 'rates.pdf', page: 1 };

/* A figure the way the server sends it: offsets into the answer's markdown
   source. `from` picks a later occurrence. */
const figure = (text, answer, origin = 'step', sources = [STOCK], extra = {}, from = 0) => {
  const start = answer.indexOf(text, from);
  return { start, end: start + text.length, text, origin, sources, stepId: null, ...extra };
};

const ANSWER = "You have **250** units in stock at $42 each, which covers the 7 you asked about. Last quarter's price was $30.";
const ANSWER_FIGURES = [
  figure('250', ANSWER, 'step', [STOCK], { stepId: 'step-1' }),
  figure('$42', ANSWER, 'step', [RATES]),
  figure('7', ANSWER, 'question', []),
  figure('$30', ANSWER, 'none', []),
];

const marks = (container) => [...container.querySelectorAll('button.anton-figure')];

describe('MarkdownContent without figure marks to make', () => {
  it.each([
    ['null', null],
    ['an empty list', []],
    ['only figures from the question', [figure('250', RICH, 'question', [])]],
  ])('renders %s exactly as no figure data', (_label, figureSources) => {
    const plain = render(<MarkdownContent text={RICH} isAssistant />).container.innerHTML;
    const { container } = render(<MarkdownContent text={RICH} isAssistant figureSources={figureSources} />);
    expect(container.innerHTML).toBe(plain);
  });
});

describe('MarkdownContent figure marks', () => {
  it('marks a sourced figure with a button named by its source', () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: '250, From stock.csv' });
    expect(mark).toHaveTextContent('250');
    expect(mark).toHaveClass('anton-figure');
    expect(mark).not.toHaveClass('anton-figure--unsourced');
    // Still inside the bold run it was written in.
    expect(mark.closest('strong')).not.toBeNull();
    expect(screen.getByRole('button', { name: '$42, From rates.pdf, page 1' })).toHaveTextContent('$42');
  });

  it('marks a figure no step returned as "No source", by name and in the tooltip', async () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: `$30, ${NO_SOURCE_TEXT}` });
    expect(mark).toHaveClass('anton-figure', 'anton-figure--unsourced');
    await userEvent.hover(mark);
    expect(await screen.findByText(NO_SOURCE_TEXT)).toBeVisible();
  });

  it('keeps the tooltip open when a mark with nothing to open is clicked', async () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} onOpenFigureStep={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^\$30/ }));
    expect(await screen.findByText(NO_SOURCE_TEXT)).toBeVisible();
  });

  it('leaves a figure from the question unmarked', () => {
    const { container } = render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    expect(marks(container).map((b) => b.textContent)).toEqual(['250', '$42', '$30']);
    expect(container.textContent).toContain('covers the 7 you asked about');
  });

  it('opens the step a figure came from on click and on Enter', async () => {
    const onOpen = vi.fn();
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} onOpenFigureStep={onOpen} />);
    const mark = screen.getByRole('button', { name: '250, From stock.csv' });
    await userEvent.click(mark);
    expect(onOpen).toHaveBeenLastCalledWith('step-1');
    mark.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
    // A source with no step of this turn shows only its tooltip.
    await userEvent.click(screen.getByRole('button', { name: /^\$42/ }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('opens nothing without an opener, even for a figure with a step', async () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: '250, From stock.csv' });
    expect(mark).not.toHaveClass('anton-figure--opens-step');
    await userEvent.click(mark);
  });

  it('ignores figures in inline code, fenced code, a link URL and math', () => {
    const at = (text, after) => figure(text, RICH, 'none', [], {}, RICH.indexOf(after));
    const figureSources = [
      at('250', 'SELECT 250 FROM'),
      at('250', 'SELECT 250;'),
      at('250', 'https://example.com/r/250'),
      at('0.25', 'r = 0.25'),
      // The prose ones around them are still marked.
      at('250', '**250**'),
      at('250', '| 250 |'),
    ];
    const { container } = render(<MarkdownContent text={RICH} isAssistant figureSources={figureSources} />);
    const marked = marks(container);
    expect(marked).toHaveLength(2);
    expect(marked[0].closest('strong')).not.toBeNull();
    expect(marked[1].closest('td')).not.toBeNull();
    expect(container.querySelector('a').getAttribute('href')).toBe('https://example.com/r/250');
    expect(container.querySelector('code button, .katex button')).toBeNull();
  });

  it('leaves a figure in a link\'s text unmarked, so no button sits inside the link', () => {
    const text = 'See [250 units](https://example.com/stock) in the export, 250 in all.';
    const figureSources = [figure('250', text), figure('250', text, 'step', [STOCK], {}, text.indexOf('export'))];
    const { container } = render(<MarkdownContent text={text} isAssistant figureSources={figureSources} />);
    expect(marks(container)).toHaveLength(1);
    expect(container.querySelector('a button')).toBeNull();
  });

  it('finds a figure whose offsets the math rewrite shifted', () => {
    const text = 'Let $x$ be the count: 250 units, not 2500.';
    // `$x$` is rewritten to `$$x$$` before parsing, two characters longer.
    const { container } = render(
      <MarkdownContent text={text} isAssistant figureSources={[figure('250', text, 'none', [])]} />,
    );
    expect(marks(container).map((b) => b.textContent)).toEqual(['250']);
    expect(container.textContent).toContain('not 2500.');
  });

  it('marks a figure written with an escaped dollar', () => {
    const text = 'It costs \\$42 today.';
    const { container } = render(
      <MarkdownContent text={text} isAssistant figureSources={[figure('$42', text, 'step', [RATES])]} />,
    );
    expect(marks(container).map((b) => b.textContent)).toEqual(['$42']);
    expect(container.textContent).toBe('It costs $42 today.');
  });

  it('falls back to the nearest occurrence when the offsets do not hold the text', () => {
    const stale = { ...figure('$30', ANSWER, 'none', []), start: 3, end: 6 };
    const { container } = render(<MarkdownContent text={ANSWER} isAssistant figureSources={[stale]} />);
    expect(marks(container).map((b) => b.textContent)).toEqual(['$30']);
  });

  it('skips a figure whose text is not in the answer', () => {
    const missing = { start: 0, end: 4, text: '9999', origin: 'none', sources: [] };
    const plain = render(<MarkdownContent text={ANSWER} isAssistant />).container.innerHTML;
    const { container } = render(<MarkdownContent text={ANSWER} isAssistant figureSources={[missing]} />);
    expect(container.innerHTML).toBe(plain);
  });
});
