import { describe, it, expect } from 'vitest';
import {
  NO_SOURCE_TEXT,
  REPEATED_TEXT,
  carryFigure,
  figureSourceText,
  hasFigureMarks,
  linkFigureSteps,
  locateFigure,
  parseFigureSources,
  placeFigures,
  rebaseFigureSources,
} from './figureSources';

/* A source the way linkFigureSteps hands it to the marks: the step it names
   and the figure's page in it. */
const source = (kind, label, extra = {}) => ({
  tool_use_id: 'toolu_01', kind, label, path: null, attachment_id: null, url: null, queries: [], requests: [],
  page: null, stepId: null, project_id: null, ...extra,
});
const fig = (text, start, origin = 'step', sources = [source('file', 'stock.csv')]) => (
  { start, end: start + text.length, text, origin, sources }
);

/* The event as cowork-server sends it. */
const STEPS = [
  { tool_use_id: 'toolu_01', kind: 'file', label: 'stock.csv', path: 'stock.csv', attachment_id: null, url: null, queries: [], requests: [] },
  { tool_use_id: 'toolu_02', kind: 'query', label: 'Query stock for site S1', path: null, attachment_id: null, url: null, queries: ["SELECT qty FROM stock WHERE site = 'S1'"], requests: [] },
  { tool_use_id: 'toolu_03', kind: 'query', label: 'Read inventory from the ERP API', path: null, attachment_id: null, url: null, queries: [], requests: ['GET {DS_ERP_URL}/inventory'] },
  { tool_use_id: 'toolu_04', kind: 'web', label: 'example.com/rates', path: null, attachment_id: null, url: 'https://example.com/rates', queries: [], requests: [] },
  { tool_use_id: 'toolu_05', kind: 'file', label: 'invoice.pdf', path: null, attachment_id: 'file-7f3a', url: null, queries: [], requests: [] },
];
const EVENT = {
  type: 'response.figure_sources',
  sequence_number: 57,
  item_id: 'msg-ab12cd34ef56',
  project_id: 'proj-1',
  steps: STEPS,
  figures: [
    { start: 14, end: 17, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_01', page: null }] },
    { start: 40, end: 43, text: '$30', origin: 'none', sources: [] },
    { start: 50, end: 51, text: '7', origin: 'question', sources: [] },
  ],
};
const step = (extra) => ({ ...STEPS[0], ...extra });
const parsedStep = (extra) => parseFigureSources({ steps: [step(extra)], figures: [] }).steps[0];

describe('parseFigureSources', () => {
  it('is null when the event carries no figure list', () => {
    expect(parseFigureSources(undefined)).toBeNull();
    expect(parseFigureSources({ steps: STEPS })).toBeNull();
    // The list alone, without its event around it, is not the event.
    expect(parseFigureSources(EVENT.figures)).toBeNull();
  });

  it('keeps a well-formed event as sent, without its envelope', () => {
    expect(parseFigureSources(EVENT)).toEqual({ project_id: 'proj-1', steps: STEPS, figures: EVENT.figures });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['a number', 7],
    ['an object', { id: 'proj-1' }],
  ])('reads a project_id that is %s as null and keeps the rest of the event', (_label, project_id) => {
    const out = parseFigureSources({ ...EVENT, project_id });
    expect(out.project_id).toBeNull();
    expect(out.steps).toEqual(STEPS);
    expect(out.figures).toEqual(EVENT.figures);
  });

  it("keeps a step's attachment_id", () => {
    expect(parsedStep({ path: null, attachment_id: 'file-7f3a' }).attachment_id).toBe('file-7f3a');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a number', 7],
    ['a path', 'files/7f3a'],
    ['a backslash path', 'files\\7f3a'],
    ['a parent segment', '..'],
    ['a dot segment', '.'],
  ])('reads an attachment_id that is %s as null and keeps the step', (_label, attachment_id) => {
    const out = parsedStep({ attachment_id });
    expect(out.attachment_id).toBeNull();
    expect(out.tool_use_id).toBe('toolu_01');
  });

  it('keeps a figure an earlier answer gave', () => {
    const figure = { start: 0, end: 5, text: '4,600', origin: 'earlier_answer', sources: [] };
    expect(parseFigureSources({ steps: [], figures: [figure] }).figures).toEqual([figure]);
  });

  it('drops a figure it cannot place or explain', () => {
    const out = parseFigureSources({ steps: [], figures: [
      null,
      { start: 0, end: 3, text: '', origin: 'step', sources: [] },
      { start: '0', end: 3, text: '250', origin: 'step', sources: [] },
      { start: 0, end: 3, text: '250', origin: 'computed', sources: [] },
      { start: 0, end: 3, text: '250', origin: 'none' },
    ] });
    expect(out.figures).toEqual([{ start: 0, end: 3, text: '250', origin: 'none', sources: [] }]);
  });

  it('drops a figure source naming no step, and a step with no tool_use_id', () => {
    const out = parseFigureSources({
      steps: [STEPS[0], { ...STEPS[1], tool_use_id: '' }, { kind: 'file', label: 'x.csv' }],
      figures: [{ start: 0, end: 3, text: '250', origin: 'step', sources: [
        { tool_use_id: 'toolu_01', page: 2 },
        { tool_use_id: 'toolu_02', page: null },
        { tool_use_id: 'toolu_99', page: null },
      ] }],
    });
    expect(out.steps.map((s) => s.tool_use_id)).toEqual(['toolu_01']);
    expect(out.figures[0].sources).toEqual([{ tool_use_id: 'toolu_01', page: 2 }]);
  });

  it('keeps the first of two steps with the same tool_use_id', () => {
    const out = parseFigureSources({ steps: [STEPS[0], { ...STEPS[0], label: 'again' }], figures: [] });
    expect(out.steps).toEqual([STEPS[0]]);
  });

  it('reads an unknown kind as a step and a page that is not a whole number as null', () => {
    const out = parseFigureSources({
      steps: [step({ kind: 'spreadsheet' })],
      figures: [{ start: 0, end: 3, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_01', page: '2' }] }],
    });
    expect(out.steps[0].kind).toBe('step');
    expect(out.figures[0].sources[0].page).toBeNull();
  });

  it.each([
    ['a parent segment', '../secrets.txt'],
    ['a parent segment in the middle', 'data/../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows drive path', 'C:/Users/me/stock.csv'],
    ['a backslash path', 'data\\stock.csv'],
    ['an empty path', ''],
    ['a path that is not a string', 7],
  ])('drops %s', (_label, path) => {
    expect(parsedStep({ path }).path).toBeNull();
  });

  it('keeps a project-relative path, nested or not', () => {
    expect(parsedStep({ path: 'data/2026/stock.csv' }).path).toBe('data/2026/stock.csv');
    expect(parsedStep({ path: 'stock..csv' }).path).toBe('stock..csv');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<b>x</b>'],
    ['file:', 'file:///etc/passwd'],
    ['a relative URL', '/rates'],
    ['credentials', 'https://user:pass@example.com/rates'],
    ['not a URL', 'example.com/rates'],
  ])('drops a URL with %s', (_label, url) => {
    expect(parsedStep({ kind: 'web', url }).url).toBeNull();
  });

  it('keeps an http(s) URL', () => {
    expect(parsedStep({ kind: 'web', url: 'https://example.com/rates' }).url).toBe('https://example.com/rates');
    expect(parsedStep({ kind: 'web', url: 'http://example.com/a' }).url).toBe('http://example.com/a');
  });

  it('keeps only the strings of queries and requests', () => {
    const out = parsedStep({ queries: ['SELECT 1', 2, null, ''], requests: 'GET /x' });
    expect(out.queries).toEqual(['SELECT 1']);
    expect(out.requests).toEqual([]);
  });
});

describe('figureSourceText', () => {
  it.each([
    [source('file', 'stock.csv'), 'From stock.csv'],
    [source('file', 'rates.pdf', { page: 1 }), 'From rates.pdf, page 1'],
    [source('query', 'monthly_sales'), 'From a query: monthly_sales'],
    [source('web', 'https://example.com/prices'), 'From the web: https://example.com/prices'],
    [source('step', 'Compute totals'), 'From a step: Compute totals'],
    [source('step', ''), 'From a step'],
  ])('names a %o source', (s, text) => {
    expect(figureSourceText(fig('250', 0, 'step', [s]))).toBe(text);
  });

  it('names the first source and counts the rest', () => {
    const f = fig('250', 0, 'step', [source('query', 'q'), source('file', 'a.csv'), source('web', '')]);
    expect(figureSourceText(f)).toBe('From a query: q and 2 more');
  });

  it('says "No source" for a figure no step returned', () => {
    expect(figureSourceText(fig('$30', 0, 'none', []))).toBe(NO_SOURCE_TEXT);
    expect(NO_SOURCE_TEXT.startsWith('No source')).toBe(true);
  });

  it('says "Repeated from an earlier answer" for a figure an earlier answer gave', () => {
    expect(figureSourceText(fig('4,600', 0, 'earlier_answer', []))).toBe(REPEATED_TEXT);
    expect(REPEATED_TEXT).toBe('Repeated from an earlier answer');
  });
});

describe('hasFigureMarks', () => {
  it('is false with nothing to mark', () => {
    expect(hasFigureMarks(null)).toBe(false);
    expect(hasFigureMarks([])).toBe(false);
    expect(hasFigureMarks([fig('7', 0, 'question', [])])).toBe(false);
    // A sourced figure with no source to name is not marked either.
    expect(hasFigureMarks([fig('7', 0, 'step', [])])).toBe(false);
  });

  it('is true for a sourced, an unsourced or a repeated figure', () => {
    expect(hasFigureMarks([fig('250', 0)])).toBe(true);
    expect(hasFigureMarks([fig('$30', 0, 'none', [])])).toBe(true);
    expect(hasFigureMarks([fig('4,600', 0, 'earlier_answer', [])])).toBe(true);
  });
});

describe('locateFigure', () => {
  it('trusts offsets that still hold the text', () => {
    expect(locateFigure('You have 250 units', fig('250', 9))).toEqual({ start: 9, end: 12 });
  });

  it('falls back to the nearest occurrence when the offsets drifted', () => {
    const text = 'Let $$x$$ be 250, not 250';
    // The server counted offsets on "Let $x$ be 250, …": two characters back.
    expect(locateFigure(text, fig('250', 11))).toEqual({ start: 13, end: 16 });
  });

  it('skips an occurrence that is part of a longer number', () => {
    expect(locateFigure('2,250 and 1.25 and 25', fig('25', 0))).toEqual({ start: 19, end: 21 });
  });

  it('is null when the text is nowhere', () => {
    expect(locateFigure('no numbers here', fig('250', 3))).toBeNull();
  });

  /* The same rule the server picks figures with: a number glued to a letter,
     digit or underscore, after a dot, or after a dash that follows a letter
     or digit is part of an identifier, a version or a code. */
  it.each([
    ['a letter before it', 'Site S1: 1 pallet', '1', 9],
    ['letters before it', 'P100 holds 100', '100', 11],
    ['an underscore before it', 'row_7 has 7', '7', 10],
    ['a dash after a letter', 'Q-03 was 03', '03', 9],
    ['a dot before it', 'v1.2.3 and 2', '2', 11],
    ['a letter after it', '32GB or 32', '32', 8],
    ['an underscore after it', '5_a or 5', '5', 7],
  ])('skips an occurrence with %s', (_label, text, figureText, start) => {
    expect(locateFigure(text, fig(figureText, 0))).toEqual({ start, end: start + figureText.length });
  });

  it('keeps a number after a dash that follows a space, as in a range or a minus', () => {
    expect(locateFigure('from 2 - 5 units', fig('5', 0))).toEqual({ start: 9, end: 10 });
  });

  /* The server keeps a range's second end when the number before the dash is
     itself a figure, so "150-200" sends 200 and the answer must mark it. */
  it.each([
    ['a plain range', 'about 150-200 units', '200', 10],
    ['a currency range', 'costs $10-$20 an hour', '$20', 10],
    ['a scaled range', 'between 5k-10k units', '10k', 11],
  ])('keeps the second end of %s', (_label, text, figureText, start) => {
    expect(locateFigure(text, fig(figureText, start))).toEqual({ start, end: start + figureText.length });
  });

  it.each([
    ['a code after a letter', 'PO-2024-0012 has 0012', '0012', 17],
    ['a code after letters and digits', 'A2210-30 or 30', '30', 12],
    // The server keeps a range's second end only right after the dash.
    ['a range whose second end opens with an underscore', '150-_200_ or 200', '200', 13],
  ])('still skips a number after a dash in %s', (_label, text, figureText, start) => {
    expect(locateFigure(text, fig(figureText, 0))).toEqual({ start, end: start + figureText.length });
  });

  it('places both ends of a range', () => {
    const text = 'My best estimate is 150-200 units.';
    const figures = [fig('150', 20), fig('200', 24)];
    expect(placeFigures(text, figures).map((p) => p && text.slice(p.start, p.end))).toEqual(['150', '200']);
  });

  /* The server reads underscores around a number as emphasis (_250_), and
     reads "250,90" as two numbers. It also skips a time, a date and a month
     with its year, which this client does not know to skip, so a figure that
     left the server's offsets would land on the copy the server skipped. */
  it.each([
    ['inside emphasis, beside a time', 'Allow _30_ minutes; we start at 2:30 pm.', '30', 7],
    ['inside emphasis, beside a month and year', 'Plan for _2026_ units by October 2026.', '2026', 10],
    ['inside emphasis, beside a date', 'Site S1 holds _250_ units; see the 4/12/250 log.', '250', 15],
    ['with a currency sign inside emphasis', 'Overtime costs _$30_ an hour.', '$30', 16],
    ['before a comma and a digit', 'S1 and S2 hold 250,90 units; logged 4/12/250.', '250', 15],
    ['after a digit and a comma', 'S1 and S2 hold 250,90 units; logged 4/12/250.', '90', 19],
  ])('keeps the place the server sent for a figure %s', (_label, text, figureText, start) => {
    expect(placeFigures(text, [fig(figureText, start)])).toEqual([{ index: 0, start, end: start + figureText.length }]);
  });

  it('finds a figure inside emphasis when its offsets drifted', () => {
    expect(locateFigure('Allow _30_ minutes', fig('30', 0))).toEqual({ start: 7, end: 9 });
  });

  it('never moves a drifted figure into a list of numbers, where it may be part of a longer one', () => {
    expect(locateFigure('hold 250,90 and 250', fig('250', 0))).toEqual({ start: 16, end: 19 });
  });

  it('does not trust offsets that land inside an identifier', () => {
    // The offsets drifted onto the 1 of S1; the figure is the 1 after it.
    expect(locateFigure('Site S1: 1 pallet', fig('1', 6))).toEqual({ start: 9, end: 10 });
  });

  it('never picks a place that is not free, even at its own offsets', () => {
    const pastCode = (start) => start >= 5;
    expect(locateFigure('`250` and 250', fig('250', 1), pastCode)).toEqual({ start: 10, end: 13 });
    expect(locateFigure('`250` only', fig('250', 1), pastCode)).toBeNull();
  });
});

describe('carryFigure', () => {
  it('finds the figure at the same count in a rewrite that moved it', () => {
    const from = 'Let $x$ be 250, not 250.';
    const to = 'Let $$x$$ be 250, not 250.';
    expect(carryFigure(from, to, fig('250', from.lastIndexOf('250')))).toEqual({ start: 22, end: 25 });
    expect(carryFigure(from, to, fig('250', from.indexOf('250')))).toEqual({ start: 13, end: 16 });
  });

  it('counts only the places the text stands alone', () => {
    const from = 'S250 has 250.';
    const to = '> S250 has 250.';
    expect(carryFigure(from, to, fig('250', 9))).toEqual({ start: 11, end: 14 });
  });

  it('counts the places the server could send the text at, inside emphasis or between commas', () => {
    const from = 'Hold _250_ and 250,90.';
    const to = '> Hold _250_ and 250,90.';
    expect(carryFigure(from, to, fig('250', from.lastIndexOf('250')))).toEqual({ start: 17, end: 20 });
  });

  it('is null when the offsets do not hold the figure in the text they index', () => {
    expect(carryFigure('You have 250.', 'You have 250.', fig('250', 3))).toBeNull();
    expect(carryFigure('S250 here', 'S250 here', fig('250', 1))).toBeNull();
  });

  it('is null when the rewrite changed how many times the text stands alone', () => {
    const from = 'Was 250 <!-- 250 --> and 250.';
    const to = 'Was 250  and 250.';
    expect(carryFigure(from, to, fig('250', from.lastIndexOf('250')))).toBeNull();
  });
});

describe('placeFigures', () => {
  it('places marked figures in source order and leaves question figures out', () => {
    const text = '$42 for the 7 you asked about, was 250, up from 180';
    const figures = [fig('250', 35), fig('7', 12, 'question', []), fig('$42', 0, 'none', []), fig('180', 48, 'earlier_answer', [])];
    expect(placeFigures(text, figures)).toEqual([
      { index: 2, start: 0, end: 3 },
      { index: 0, start: 35, end: 38 },
      { index: 3, start: 48, end: 51 },
    ]);
  });

  it('drops a figure overlapping one placed before it', () => {
    const text = 'about 1,284 units';
    expect(placeFigures(text, [fig('1,284', 6), fig('284', 8)])).toEqual([{ index: 0, start: 6, end: 11 }]);
  });

  it('gives each occurrence to one figure when two drifted onto the same one', () => {
    // Both offsets are four characters short of their cells.
    const text = 'Site | 120 | 120 |';
    expect(placeFigures(text, [fig('120', 3), fig('120', 9)])).toEqual([
      { index: 0, start: 7, end: 10 },
      { index: 1, start: 13, end: 16 },
    ]);
  });

  it('lets a figure whose offsets hold keep its place before a drifted one picks', () => {
    const text = '120 and 120';
    expect(placeFigures(text, [fig('120', 6), fig('120', 8)])).toEqual([
      { index: 0, start: 0, end: 3 },
      { index: 1, start: 8, end: 11 },
    ]);
  });

  it('places nothing inside a skipped range and finds the prose occurrence instead', () => {
    // Inline math the rewrite lengthened: the offsets now point into it.
    const text = 'With $$a$$, $$b$$ and $$c$$: $$n = 198$$ vs 198 rows.';
    const math = text.indexOf('$$n = 198$$');
    const skipped = [[5, 10], [12, 17], [22, 27], [math, math + 11]];
    expect(placeFigures(text, [fig('198', text.indexOf('198 rows') - 8, 'none', [])], { skipped })).toEqual([
      { index: 0, start: text.indexOf('198 rows'), end: text.indexOf('198 rows') + 3 },
    ]);
  });

  it('carries each figure from the answer as written onto its rewrite', () => {
    const original = 'With $a$ and $b$: 120 | 120';
    const source = 'With $$a$$ and $$b$$: 120 | 120';
    const figures = [fig('120', original.indexOf('120')), fig('120', original.lastIndexOf('120'), 'none', [])];
    expect(placeFigures(source, figures, { original })).toEqual([
      { index: 0, start: 22, end: 25 },
      { index: 1, start: 28, end: 31 },
    ]);
  });

  it('gives a figure carried into a skipped range no place, rather than another occurrence', () => {
    // The 198 inside the math is a figure too; the prose one came from the question.
    const original = 'With $a$: $n = 198$ vs 198 rows.';
    const source = 'With $$a$$: $$n = 198$$ vs 198 rows.';
    const figures = [
      fig('198', original.indexOf('198'), 'none', []),
      fig('198', original.lastIndexOf('198'), 'question', []),
    ];
    const math = source.indexOf('$$n = 198$$');
    expect(placeFigures(source, figures, { original, skipped: [[5, 10], [math, math + 11]] })).toEqual([]);
  });
});

describe('rebaseFigureSources', () => {
  const NARRATION = 'Let me read stock.csv for the 2 sites.';
  const ANSWER = '\n\nSite S1 holds 250 units.';
  const sources = (figures) => ({ project_id: 'proj-1', steps: STEPS, figures });
  const map = (whole, ranges = [[0, whole.length]]) => ({ sourceLength: whole.length, ranges });
  const at = (text, whole, from = 0) => {
    const start = whole.indexOf(text, from);
    return { start, end: start + text.length, text, origin: 'step', sources: [{ tool_use_id: 'toolu_01', page: null }] };
  };

  it('moves every figure back by the narration the live message dropped, and leaves out the ones in it', () => {
    const whole = NARRATION + ANSWER;
    const out = rebaseFigureSources(sources([at('2', whole), at('250', whole)]), whole, ANSWER, map(whole, [[NARRATION.length, whole.length]]));
    expect(out.figures).toEqual([at('250', ANSWER)]);
    expect(out.steps).toBe(STEPS);
    expect(out.project_id).toBe('proj-1');
    expect(ANSWER.slice(out.figures[0].start, out.figures[0].end)).toBe('250');
  });

  it('keeps the figures as they are when the live message is the whole answer', () => {
    const figureSources = sources([at('250', ANSWER)]);
    expect(rebaseFigureSources(figureSources, ANSWER, ANSWER, map(ANSWER))).toBe(figureSources);
  });

  it('maps each retained segment without moving removed repeated figures onto visible ones', () => {
    const whole = '250, 250, 250';
    const figureSources = sources([
      at('250', whole),
      { ...at('250', whole, 4), origin: 'none', sources: [] },
      { ...at('250', whole, 9), origin: 'none', sources: [] },
    ]);
    const out = rebaseFigureSources(figureSources, whole, '250250', map(whole, [[0, 3], [10, 13]]));
    expect(out.figures).toEqual([
      at('250', '250250'),
      { ...at('250', '250250', 3), origin: 'none', sources: [] },
    ]);
    expect(figureSources.figures[2].start).toBe(10);
  });

  it('omits a figure that crosses a removed gap', () => {
    const out = rebaseFigureSources(sources([at('250', '250')]), '250', '20', map('250', [[0, 1], [2, 3]]));
    expect(out.figures).toEqual([]);
  });

  it('keeps no figures when retained text differs from the answer the server traced', () => {
    expect(rebaseFigureSources(sources([at('250', ANSWER)]), ANSWER, 'Site S1 holds 250 units, restored.', map(ANSWER))).toBeNull();
  });

  it('keeps no figures when the completed source length differs from the streamed source', () => {
    // Matching retained text alone does not prove the stream is complete.
    const whole = ANSWER + NARRATION;
    expect(rebaseFigureSources(sources([at('250', whole)]), whole, ANSWER, map(ANSWER))).toBeNull();
  });

  it('keeps no figures without the answer the server traced', () => {
    expect(rebaseFigureSources(sources([at('250', ANSWER)]), null, ANSWER, map(ANSWER))).toBeNull();
  });

  it('is null without figure sources', () => {
    expect(rebaseFigureSources(null, ANSWER, ANSWER, map(ANSWER))).toBeNull();
  });
});

describe('linkFigureSteps', () => {
  const turnSteps = [
    { id: 'step-1', _isScratchpad: true, _toolUseId: 'toolu_01' },
    { id: 'step-2', _isToolCall: true, _toolUseId: 'toolu_02' },
    // A progress row names its tool by tab id, not tool_use_id: never a target.
    { id: 'step-3', badge: 'ToolProgress', _scratchpadTabId: 'toolu_03' },
  ];
  const figureSources = parseFigureSources({
    steps: STEPS,
    figures: [
      { start: 0, end: 3, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_03', page: null }, { tool_use_id: 'toolu_01', page: 4 }] },
      { start: 10, end: 13, text: '$30', origin: 'none', sources: [] },
    ],
  });

  it('is null without figure sources', () => {
    expect(linkFigureSteps(null, turnSteps)).toBeNull();
  });

  it('joins each source to its step, with its page and the turn step it opens', () => {
    const [sourced, unsourced] = linkFigureSteps(figureSources, turnSteps);
    expect(sourced.sources).toEqual([
      { ...STEPS[2], page: null, stepId: null, project_id: null },
      { ...STEPS[0], page: 4, stepId: 'step-1', project_id: null },
    ]);
    expect(unsourced.sources).toEqual([]);
    expect(sourced.text).toBe('250');
  });

  it('links nothing when the turn has no steps', () => {
    expect(linkFigureSteps(figureSources, null)[0].sources.map((s) => s.stepId)).toEqual([null, null]);
  });

  it("gives each source the event's project and its step's attachment", () => {
    const linked = linkFigureSteps(parseFigureSources({
      project_id: 'proj-1',
      steps: STEPS,
      figures: [{ start: 0, end: 3, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_05', page: 2 }] }],
    }), turnSteps);
    expect(linked[0].sources).toEqual([{ ...STEPS[4], page: 2, stepId: null, project_id: 'proj-1' }]);
    expect(linked[0].sources[0]).toMatchObject({ path: null, attachment_id: 'file-7f3a' });
  });
});
