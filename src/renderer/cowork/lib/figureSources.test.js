import { describe, it, expect } from 'vitest';
import {
  NO_SOURCE_TEXT,
  figureSourceText,
  hasFigureMarks,
  linkFigureSteps,
  locateFigure,
  parseFigureSources,
  placeFigures,
} from './figureSources';

/* A source the way linkFigureSteps hands it to the marks: the step it names
   and the figure's page in it. */
const source = (kind, label, extra = {}) => ({
  tool_use_id: 'toolu_01', kind, label, path: null, url: null, queries: [], requests: [], page: null, stepId: null, ...extra,
});
const fig = (text, start, origin = 'step', sources = [source('file', 'stock.csv')]) => (
  { start, end: start + text.length, text, origin, sources }
);

/* The event as cowork-server sends it. */
const STEPS = [
  { tool_use_id: 'toolu_01', kind: 'file', label: 'stock.csv', path: 'stock.csv', url: null, queries: [], requests: [] },
  { tool_use_id: 'toolu_02', kind: 'query', label: 'Query stock for site S1', path: null, url: null, queries: ["SELECT qty FROM stock WHERE site = 'S1'"], requests: [] },
  { tool_use_id: 'toolu_03', kind: 'query', label: 'Read inventory from the ERP API', path: null, url: null, queries: [], requests: ['GET {DS_ERP_URL}/inventory'] },
  { tool_use_id: 'toolu_04', kind: 'web', label: 'example.com/rates', path: null, url: 'https://example.com/rates', queries: [], requests: [] },
];
const EVENT = {
  type: 'response.figure_sources',
  sequence_number: 57,
  item_id: 'msg-ab12cd34ef56',
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
    expect(parseFigureSources(EVENT)).toEqual({ steps: STEPS, figures: EVENT.figures });
  });

  it('reads its own output the same way, so a saved copy parses again', () => {
    const once = parseFigureSources(EVENT);
    expect(parseFigureSources(once)).toEqual(once);
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
    [source('memory', 'pricing note'), 'From memory'],
    [source('step', 'Compute totals'), 'From a step: Compute totals'],
    [source('step', ''), 'From a step'],
  ])('names a %o source', (s, text) => {
    expect(figureSourceText(fig('250', 0, 'step', [s]))).toBe(text);
  });

  it('names the first source and counts the rest', () => {
    const f = fig('250', 0, 'step', [source('query', 'q'), source('file', 'a.csv'), source('memory', '')]);
    expect(figureSourceText(f)).toBe('From a query: q and 2 more');
  });

  it('says "No source" for a figure no step returned', () => {
    expect(figureSourceText(fig('$30', 0, 'none', []))).toBe(NO_SOURCE_TEXT);
    expect(NO_SOURCE_TEXT.startsWith('No source')).toBe(true);
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

  it('is true for a sourced or an unsourced figure', () => {
    expect(hasFigureMarks([fig('250', 0)])).toBe(true);
    expect(hasFigureMarks([fig('$30', 0, 'none', [])])).toBe(true);
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
});

describe('placeFigures', () => {
  it('places marked figures in source order and leaves question figures out', () => {
    const text = '$42 for the 7 you asked about, was 250';
    const figures = [fig('250', 35), fig('7', 12, 'question', []), fig('$42', 0, 'none', [])];
    expect(placeFigures(text, figures)).toEqual([
      { index: 2, start: 0, end: 3 },
      { index: 0, start: 35, end: 38 },
    ]);
  });

  it('drops a figure overlapping one placed before it', () => {
    const text = 'about 1,284 units';
    expect(placeFigures(text, [fig('1,284', 6), fig('284', 8)])).toEqual([{ index: 0, start: 6, end: 11 }]);
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
      { ...STEPS[2], page: null, stepId: null },
      { ...STEPS[0], page: 4, stepId: 'step-1' },
    ]);
    expect(unsourced.sources).toEqual([]);
    expect(sourced.text).toBe('250');
  });

  it('links nothing when the turn has no steps', () => {
    expect(linkFigureSteps(figureSources, null)[0].sources.map((s) => s.stepId)).toEqual([null, null]);
  });
});
