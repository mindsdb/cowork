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
import { NO_SOURCE_TEXT, REPEATED_TEXT, linkFigureSteps, rebaseFigureSources } from '../../lib/figureSources';
import { initialStreamState, reduceStream } from '../../lib/responseStreamAdapter';
import { hydrateMessagesFromServerEvents } from '../../lib/conversationHistory';
import { restoredFigureEvents, RESTORED_LIVE_TEXT, RESTORED_SAVED_TEXT } from '../../../visual-fixtures/restored-figure-sources';
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

/* The rendered text with each mark written as [text], or [text?] for a
   "No source" one. */
const markedText = (element) => {
  const copy = element.cloneNode(true);
  for (const mark of copy.querySelectorAll('button.anton-figure')) {
    mark.replaceWith(`[${mark.textContent}${mark.classList.contains('anton-figure--unsourced') ? '?' : ''}]`);
  }
  return copy.textContent;
};

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
  it('marks a sourced figure with a button named by its first source\'s kind and described by its sources', () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: '250, from a file' });
    expect(mark).toHaveAccessibleDescription('From stock.csv and 2 more');
    expect(mark).toHaveTextContent('250');
    expect(mark).toHaveClass('anton-figure');
    expect(mark).not.toHaveClass('anton-figure--unsourced');
    // Still inside the bold run it was written in.
    expect(mark.closest('strong')).not.toBeNull();
    expect(screen.getByRole('button', { name: '$42, from a file' })).toHaveAccessibleDescription('From rates.pdf, page 1');
  });

  it.each([
    ['query', QUERY, 'from a query', 'From a query: Query stock for site S1'],
    ['web', WEB, 'from the web', 'From the web: example.com/rates'],
    ['step', source('toolu_07', 'step', 'read_file'), 'from a step', 'From a step: read_file'],
  ])('keeps the tooltip to one line for a %s source', async (_kind, s, state, text) => {
    const answer = 'There are 250 units.';
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('250', answer, 'step', [s])]} />);
    const mark = screen.getByRole('button', { name: `250, ${state}` });
    expect(mark).toHaveAccessibleDescription(text);
    await userEvent.hover(mark);
    expect(await screen.findByText(text)).toBeVisible();
  });

  it('marks a figure no step returned as "No source", by name and in the tooltip', async () => {
    render(<MarkdownContent text={ANSWER} isAssistant figureSources={ANSWER_FIGURES} />);
    const mark = screen.getByRole('button', { name: '$30, no source' });
    expect(mark).toHaveAccessibleDescription(NO_SOURCE_TEXT);
    expect(mark).toHaveClass('anton-figure', 'anton-figure--unsourced');
    await userEvent.hover(mark);
    expect(await screen.findByText(NO_SOURCE_TEXT)).toBeVisible();
  });

  it('marks a figure an earlier answer gave as repeated, with the grey underline', async () => {
    const answer = '5,200 in 2024, up from 4,600.';
    const { container } = render(
      <MarkdownContent text={answer} isAssistant figureSources={[figure('5,200', answer, 'step', [QUERY]), figure('4,600', answer, 'earlier_answer', [])]} />,
    );
    const mark = screen.getByRole('button', { name: '4,600, repeated from an earlier answer' });
    expect(mark).toHaveAccessibleDescription(REPEATED_TEXT);
    expect(mark).toHaveClass('anton-figure');
    expect(mark).not.toHaveClass('anton-figure--unsourced');
    expect(marks(container).map((b) => b.textContent)).toEqual(['5,200', '4,600']);
    await userEvent.hover(mark);
    expect(await screen.findByText(REPEATED_TEXT)).toBeVisible();
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

  it('does not mark the 1 of S1 when the math rewrite shifted the offsets onto it', () => {
    const text = 'Let $n$ be the count. Site S1: 1 pallet.';
    const { container } = render(
      <MarkdownContent text={text} isAssistant figureSources={[figure('1', text, 'none', [], text.indexOf(': 1'))]} />,
    );
    expect(markedText(container)).toContain('Site S1: [1?] pallet.');
  });

  it('marks the figure a blockquote line holds, not the digit of a site code after it', () => {
    const text = [
      '> Stock is low at both sites.',
      '> Site S1 has none left.',
      '> Site S2 has few left.',
      '> Order 2 at S2 today.',
    ].join('\n');
    const { container } = render(
      <MarkdownContent text={text} isAssistant figureSources={[figure('2', text, 'none', [], text.indexOf('Order'))]} />,
    );
    expect(markedText(container)).toContain('Order [2?] at S2 today.');
  });

  /* The server reads underscores as emphasis and "250,90" as two numbers,
     and skips the time, date or month and year beside each figure here; the
     mark must land where the server sent it, not on the copy it skipped. */
  it.each([
    ['Allow _30_ minutes; we start at 2:30 pm.', '30', 'none', 'Allow [30?] minutes; we start at 2:30 pm.'],
    ['Plan for _2026_ units by October 2026.', '2026', 'none', 'Plan for [2026?] units by October 2026.'],
    ['Site S1 holds _250_ units; see the 4/12/250 log.', '250', 'step', 'Site S1 holds [250] units; see the 4/12/250 log.'],
    ['Overtime costs _$30_ an hour.', '$30', 'none', 'Overtime costs [$30?] an hour.'],
  ])('marks the figure the server sent in %j', (text, figureText, origin, marked) => {
    const sources = origin === 'step' ? [STOCK] : [];
    const { container } = render(
      <MarkdownContent text={text} isAssistant figureSources={[figure(figureText, text, origin, sources)]} />,
    );
    expect(markedText(container)).toBe(marked);
    expect(marks(container)[0].closest('em')).not.toBeNull();
  });

  it('marks both numbers the server read in "250,90", and not the date after them', () => {
    const text = 'S1 and S2 hold 250,90 units; logged 4/12/250.';
    const { container } = render(
      <MarkdownContent text={text} isAssistant figureSources={[figure('250', text), figure('90', text)]} />,
    );
    expect(markedText(container)).toBe('S1 and S2 hold [250],[90] units; logged 4/12/250.');
  });

  it('marks a prose figure after inline math, and leaves the same number inside the math alone', () => {
    const text = 'With $a$, $b$ and $c$: $n = 198$ vs 198 rows.';
    const figureSources = [
      figure('198', text, 'none', []),
      figure('198', text, 'step', [STOCK], text.indexOf('vs')),
    ];
    const { container } = render(<MarkdownContent text={text} isAssistant figureSources={figureSources} />);
    expect(marks(container)).toHaveLength(1);
    expect(markedText(container)).toContain('vs [198] rows.');
    expect(container.querySelector('.katex button')).toBeNull();
  });

  it('keeps the answer mounted when a refetch hands over equal figure data', () => {
    const text = `${ANSWER}\n\n\`\`\`sql\nSELECT 1;\n\`\`\``;
    const { container, rerender } = render(<MarkdownContent text={text} isAssistant figureSources={ANSWER_FIGURES} />);
    const paragraph = container.querySelector('p');
    const mark = marks(container)[0];
    const refetched = ANSWER_FIGURES.map((f) => ({ ...f, sources: f.sources.map((s) => ({ ...s })) }));
    rerender(<MarkdownContent text={text} isAssistant figureSources={refetched} />);
    expect(container.querySelector('p')).toBe(paragraph);
    expect(marks(container)[0]).toBe(mark);
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

  it('hands "View file" the source and closes', async () => {
    const onViewFile = vi.fn();
    renderAnswer({ onViewFigureFile: onViewFile });
    const popup = await openPopover(/^250,/);
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    expect(onViewFile).toHaveBeenCalledExactlyOnceWith(STOCK);
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

  it('shows the repeated text and no source for a figure an earlier answer gave', async () => {
    const answer = 'Up from 4,600.';
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('4,600', answer, 'earlier_answer', [])]} />);
    const popup = await openPopover(/^4,600,/);
    expect(popup).toHaveAccessibleName('Where 4,600 came from');
    expect(popup).toHaveTextContent(REPEATED_TEXT);
    expect(within(popup).queryByRole('listitem')).toBeNull();
  });

  it('names a source whose label only repeats its kind once, by its kind', async () => {
    const answer = 'There are 250 units.';
    render(<MarkdownContent text={answer} isAssistant figureSources={[figure('250', answer, 'step', [source('toolu_06', 'web', 'web page')])]} />);
    const popup = await openPopover(/^250,/);
    expect(within(popup).getByRole('listitem').firstChild.textContent).toBe('Web page');
  });
});

/* A turn that narrates, runs a tool, then answers. The live message moves the
   narration into a thought at the tool call, while the saved answer a reload
   shows keeps it, and the server's offsets index the saved answer. */
describe('MarkdownContent marks on a live answer after narration and a tool call', () => {
  const NARRATION = 'Let me read stock.csv for the 2 sites.';
  const REPLY = '\n\nSite S1 holds 250 units and site S2 holds 250 too.';
  const SAVED = NARRATION + REPLY;
  const traced = (text, origin, sources, from = 0) => {
    const start = SAVED.indexOf(text, from);
    return { start, end: start + text.length, text, origin, sources };
  };
  const EVENTS = [
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.output_text.delta', delta: NARRATION },
    { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'toolu_01' },
    { type: 'response.output_text.delta', delta: REPLY },
    {
      type: 'response.figure_sources',
      project_id: 'proj-1',
      steps: [{ tool_use_id: 'toolu_01', kind: 'file', label: 'stock.csv', path: 'stock.csv', attachment_id: null, url: null, queries: [], requests: [] }],
      figures: [
        traced('2', 'none', []),
        traced('250', 'step', [{ tool_use_id: 'toolu_01', page: null }]),
        traced('250', 'none', [], SAVED.indexOf('S2')),
      ],
    },
    {
      type: 'response.completed',
      assistant_message_id: 'a1',
      response: { id: 'r1', status: 'completed', output: [{ id: 'msg-1', status: 'completed', content: [{ type: 'output_text', text: SAVED }] }] },
    },
  ];
  const lastParagraph = (container) => [...container.querySelectorAll('p')].at(-1);

  it('puts the same marks on the same figures as the reloaded answer', () => {
    const state = EVENTS.reduce((s, e) => reduceStream(s, e, () => 5000), initialStreamState());
    expect(state.bodyText).toBe(REPLY);
    const live = render(
      <MarkdownContent
        text={state.bodyText}
        isAssistant
        figureSources={linkFigureSteps(rebaseFigureSources(state.figureSources, state.answerText, state.bodyText, state.bodyTextMap), state.steps)}
      />,
    ).container;
    const reload = render(
      <MarkdownContent text={SAVED} isAssistant figureSources={linkFigureSteps(state.figureSources, state.steps)} />,
    ).container;
    expect(markedText(lastParagraph(reload))).toBe('Site S1 holds [250] units and site S2 holds [250?] too.');
    expect(markedText(lastParagraph(live))).toBe(markedText(lastParagraph(reload)));
    // The narration figure is in the reloaded answer only.
    expect(markedText(reload.querySelector('p'))).toBe('Let me read stock.csv for the [2?] sites.');
    expect(marks(live)).toHaveLength(2);
  });
});

describe('MarkdownContent marks on a restored answer after a continuation tool call', () => {
  it('keeps sourced and unsourced restored and diagnosis figures identical to reload', () => {
    const events = restoredFigureEvents();
    const state = events.reduce((s, e) => reduceStream(s, e, () => 5000), initialStreamState());
    const [hydrated] = hydrateMessagesFromServerEvents([{
      id: 'a1', role: 'assistant', content: RESTORED_SAVED_TEXT, events,
    }]);
    expect(state.bodyText).toBe(RESTORED_LIVE_TEXT);
    const live = render(
      <MarkdownContent
        text={state.bodyText}
        isAssistant
        figureSources={linkFigureSteps(rebaseFigureSources(state.figureSources, state.answerText, state.bodyText, state.bodyTextMap), state.steps)}
      />,
    ).container;
    const reload = render(
      <MarkdownContent text={hydrated.content} isAssistant figureSources={linkFigureSteps(hydrated.figureSources, hydrated.steps)} />,
    ).container;
    const liveParagraphs = [...live.querySelectorAll('p')].map(markedText);
    const reloadParagraphs = [...reload.querySelectorAll('p')].map(markedText);
    expect(liveParagraphs).toEqual([
      '📦 Site S1 holds [250] units; site S2 may need [99?] units.',
      'The [250]-unit count stands, up from [240]; I cannot confirm the [12?]-unit adjustment.',
    ]);
    expect(reloadParagraphs).toEqual([
      liveParagraphs[0],
      'I will recheck [250] units and [99?] requested units.',
      liveParagraphs[1],
    ]);
    expect(marks(live)).toHaveLength(5);
    expect(marks(reload)).toHaveLength(7);
    for (const container of [live, reload]) {
      expect(within(container).getByRole('button', { name: '240, repeated from an earlier answer' })).toBeInTheDocument();
    }
    // Live projection never mutates the event offsets needed by hydration.
    expect(hydrated.figureSources).toEqual(state.figureSources);
  });
});
