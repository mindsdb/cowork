import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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

/* A figure's web source follows the answer's own link rules, whose loopback
   check depends on the surface, so the surface flips per test. */
const hostState = vi.hoisted(() => ({ isWeb: false }));
vi.mock('../../../platform/host', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    host: { ...mod.host, openExternal: vi.fn(), get isWeb() { return hostState.isWeb; } },
  };
});
vi.mock('../../lib/clipboard', () => ({ copyText: vi.fn(async () => true) }));

import { MarkdownContent } from './MarkdownContent';
import { NO_SOURCE_TEXT } from '../../lib/figureSources';
import { copyText } from '../../lib/clipboard';
import { host } from '../../../platform/host';

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

/* Sources the way linkFigureSteps hands them over: each joined to its step,
   with the figure's page and the turn step it opens. */
const source = (tool_use_id, kind, label, extra = {}) => ({
  tool_use_id, kind, label, path: null, url: null, queries: [], requests: [], page: null, stepId: null, ...extra,
});
const STOCK = source('toolu_01', 'file', 'stock.csv', { path: 'data/stock.csv', stepId: 'step-1' });
const RATES = source('toolu_02', 'file', 'rates.pdf', { path: 'rates.pdf', page: 1 });
const SQL = "SELECT qty FROM stock WHERE site = 'S1'";
const QUERY = source('toolu_03', 'query', 'Query stock for site S1', { queries: [SQL], stepId: 'step-3' });
const API = source('toolu_04', 'query', 'Read inventory from the ERP API', { requests: ['GET {DS_ERP_URL}/inventory'] });
const WEB = source('toolu_05', 'web', 'example.com/rates', { url: 'https://example.com/rates' });
const MEMORY = source('toolu_06', 'memory', 'memory');

/* A figure the way the server sends it: offsets into the answer's markdown
   source. `from` picks a later occurrence. */
const figure = (text, answer, origin = 'step', sources = [STOCK], from = 0) => {
  const start = answer.indexOf(text, from);
  return { start, end: start + text.length, text, origin, sources };
};

const ANSWER = "You have **250** units in stock at $42 each, which covers the 7 you asked about. Last quarter's price was $30.";
const ANSWER_FIGURES = [
  figure('250', ANSWER, 'step', [STOCK, QUERY, WEB]),
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
  it('marks a sourced figure with a button named by its first source', () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: '250, From stock.csv and 2 more' });
    expect(mark).toHaveTextContent('250');
    expect(mark).toHaveClass('anton-figure');
    expect(mark).not.toHaveClass('anton-figure--unsourced');
    // Still inside the bold run it was written in.
    expect(mark.closest('strong')).not.toBeNull();
    expect(screen.getByRole('button', { name: '$42, From rates.pdf, page 1' })).toHaveTextContent('$42');
  });

  it.each([
    ['query', QUERY, 'From a query: Query stock for site S1'],
    ['web', WEB, 'From the web: example.com/rates'],
    ['memory', MEMORY, 'From memory'],
    ['step', source('toolu_07', 'step', 'read_file'), 'From a step: read_file'],
  ])('keeps the tooltip to one line for a %s source', async (_kind, s, text) => {
    const answer = 'There are 250 units.';
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('250', answer, 'step', [s])]} />);
    const mark = screen.getByRole('button', { name: `250, ${text}` });
    await userEvent.hover(mark);
    expect(await screen.findByText(text)).toBeVisible();
  });

  it('marks a figure no step returned as "No source", by name and in the tooltip', async () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: `$30, ${NO_SOURCE_TEXT}` });
    expect(mark).toHaveClass('anton-figure', 'anton-figure--unsourced');
    await userEvent.hover(mark);
    expect(await screen.findByText(NO_SOURCE_TEXT)).toBeVisible();
  });

  it('leaves a figure from the question unmarked', () => {
    const { container } = render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    expect(marks(container).map((b) => b.textContent)).toEqual(['250', '$42', '$30']);
    expect(container.textContent).toContain('covers the 7 you asked about');
  });

  it('ignores figures in inline code, fenced code, a link URL and math', () => {
    const at = (text, after) => figure(text, RICH, 'none', [], RICH.indexOf(after));
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
    const figureSources = [figure('250', text), figure('250', text, 'step', [STOCK], text.indexOf('export'))];
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

describe('MarkdownContent figure source popover', () => {
  afterEach(() => {
    hostState.isWeb = false;
    vi.mocked(host.openExternal).mockClear();
    vi.mocked(copyText).mockClear();
  });

  const renderAnswer = (props = {}) => render(
    <MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} {...props} />,
  );
  const openPopover = async (name) => {
    await userEvent.click(screen.getByRole('button', { name }));
    return screen.findByRole('dialog');
  };

  it('opens on click and lists every source, with what each one can be checked against', async () => {
    renderAnswer({ onOpenFigureStep: vi.fn(), onViewFigureFile: vi.fn() });
    const popup = await openPopover(/^250,/);
    expect(popup).toHaveAccessibleName('Where 250 came from');
    const [file, query, web] = within(popup).getAllByRole('listitem');
    // Every source, not the tooltip's "and 2 more".
    expect(within(popup).getAllByRole('listitem')).toHaveLength(3);
    expect(popup).not.toHaveTextContent('more');

    expect(file).toHaveTextContent('File');
    expect(file).toHaveTextContent('stock.csv');
    expect(within(file).getByRole('button', { name: /View file/ })).toBeInTheDocument();
    expect(within(file).getByRole('button', { name: 'Open step' })).toBeInTheDocument();

    expect(query).toHaveTextContent('Query stock for site S1');
    expect(query).toHaveTextContent(SQL);
    expect(within(query).getByRole('button', { name: 'Copy SQL' })).toBeInTheDocument();
    expect(within(query).getByRole('button', { name: 'Open step' })).toBeInTheDocument();
    expect(within(query).queryByRole('button', { name: /View file/ })).toBeNull();

    expect(within(web).getByRole('link', { name: /https:\/\/example\.com\/rates/ })).toHaveAttribute('href', 'https://example.com/rates');
    // No step of this turn carries its tool_use_id, so there is nothing to open.
    expect(within(web).queryByRole('button', { name: 'Open step' })).toBeNull();
  });

  it('opens on Enter and gives focus back to the figure on Escape', async () => {
    renderAnswer();
    const mark = screen.getByRole('button', { name: /^250,/ });
    mark.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Where 250 came from');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mark).toHaveFocus();
  });

  it('closes on a press outside it, including one over an artifact preview', async () => {
    renderAnswer();
    await openPopover(/^250,/);
    fireEvent.mouseDown(screen.getByTestId('figure-sources-outside-dismiss'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands "View file" the project-relative path and closes', async () => {
    const onViewFile = vi.fn();
    renderAnswer({ onViewFigureFile: onViewFile });
    const popup = await openPopover(/^250,/);
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    expect(onViewFile).toHaveBeenCalledExactlyOnceWith('data/stock.csv');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands "Open step" the step id and closes', async () => {
    const onOpenStep = vi.fn();
    renderAnswer({ onOpenFigureStep: onOpenStep });
    const popup = await openPopover(/^250,/);
    const [, query] = within(popup).getAllByRole('listitem');
    await userEvent.click(within(query).getByRole('button', { name: 'Open step' }));
    expect(onOpenStep).toHaveBeenCalledExactlyOnceWith('step-3');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers neither "View file" nor "Open step" without their openers', async () => {
    renderAnswer();
    const popup = await openPopover(/^250,/);
    expect(within(popup).queryByRole('button', { name: /View file/ })).toBeNull();
    expect(within(popup).queryByRole('button', { name: 'Open step' })).toBeNull();
  });

  it('copies a query with its own button', async () => {
    renderAnswer();
    const popup = await openPopover(/^250,/);
    await userEvent.click(within(popup).getByRole('button', { name: 'Copy SQL' }));
    expect(copyText).toHaveBeenCalledExactlyOnceWith(SQL);
    expect(await within(popup).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows an HTTP request as plain text, with its own copy button', async () => {
    const answer = 'The ERP reports 250 units.';
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('250', answer, 'step', [API])]} />);
    const popup = await openPopover(/^250,/);
    expect(popup).toHaveTextContent('GET {DS_ERP_URL}/inventory');
    await userEvent.click(within(popup).getByRole('button', { name: 'Copy request' }));
    expect(copyText).toHaveBeenCalledExactlyOnceWith('GET {DS_ERP_URL}/inventory');
  });

  it("opens a web source through the host's external opener", async () => {
    renderAnswer();
    const popup = await openPopover(/^250,/);
    await userEvent.click(within(popup).getByRole('link', { name: /example\.com\/rates/ }));
    expect(host.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/rates');
  });

  it('keeps a loopback web source as text on web, where it names the agent\'s machine', async () => {
    hostState.isWeb = true;
    const answer = 'The dashboard shows 250 units.';
    const loopback = source('toolu_08', 'web', '127.0.0.1:8000/dash', { url: 'http://127.0.0.1:8000/dash' });
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('250', answer, 'step', [loopback])]} />);
    const popup = await openPopover(/^250,/);
    expect(within(popup).queryByRole('link')).toBeNull();
    expect(popup).toHaveTextContent('http://127.0.0.1:8000/dash');
  });

  it('shows the No source text for a figure no step returned', async () => {
    renderAnswer();
    const popup = await openPopover(/^\$30,/);
    expect(popup).toHaveAccessibleName('Where $30 came from');
    expect(popup).toHaveTextContent(NO_SOURCE_TEXT);
    expect(within(popup).queryByRole('listitem')).toBeNull();
  });

  it('names a memory source once, by its kind', async () => {
    const answer = 'You prefer 250 units.';
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('250', answer, 'step', [MEMORY])]} />);
    const popup = await openPopover(/^250,/);
    expect(within(popup).getByRole('listitem').textContent).toBe('Memory');
  });
});
