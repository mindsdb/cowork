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

const source = (kind, label, extra = {}) => ({ tool_use_id: 'toolu_01', kind, label, page: null, ...extra });
const fig = (text, start, origin = 'step', sources = [source('file', 'stock.csv')]) => (
  { start, end: start + text.length, text, origin, sources }
);

describe('parseFigureSources', () => {
  it('is null when the event carries no list', () => {
    expect(parseFigureSources(undefined)).toBeNull();
    expect(parseFigureSources({ start: 0 })).toBeNull();
  });

  it('keeps a well-formed figure as sent', () => {
    const raw = [{ start: 4, end: 7, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_01', kind: 'file', label: 'rates.pdf', page: 1 }] }];
    expect(parseFigureSources(raw)).toEqual(raw);
  });

  it('drops a figure it cannot place or explain', () => {
    const out = parseFigureSources([
      null,
      { start: 0, end: 3, text: '', origin: 'step', sources: [] },
      { start: '0', end: 3, text: '250', origin: 'step', sources: [] },
      { start: 0, end: 3, text: '250', origin: 'computed', sources: [] },
      { start: 0, end: 3, text: '250', origin: 'none' },
    ]);
    expect(out).toEqual([{ start: 0, end: 3, text: '250', origin: 'none', sources: [] }]);
  });

  it('reads an unknown source kind as a step and a missing page as null', () => {
    const [f] = parseFigureSources([
      { start: 0, end: 3, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_01', kind: 'spreadsheet', label: 'x', page: '2' }] },
    ]);
    expect(f.sources).toEqual([{ tool_use_id: 'toolu_01', kind: 'step', label: 'x', page: null }]);
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
  const steps = [
    { id: 'step-1', _isScratchpad: true, _toolUseId: 'toolu_01' },
    { id: 'step-2', _isToolCall: true, _toolUseId: 'toolu_02' },
    // A progress row names its tool by tab id, not tool_use_id: never a target.
    { id: 'step-3', badge: 'ToolProgress', _scratchpadTabId: 'toolu_03' },
  ];

  it('is null without figures', () => {
    expect(linkFigureSteps(null, steps)).toBeNull();
  });

  it("links each figure to the step its first openable source names", () => {
    const figures = [
      fig('250', 0, 'step', [source('web', 'u', { tool_use_id: 'toolu_03' }), source('file', 'a', { tool_use_id: 'toolu_02' })]),
      fig('42', 10, 'step', [source('file', 'b')]),
      fig('18', 20, 'step', [source('web', 'u', { tool_use_id: 'toolu_99' })]),
      fig('$30', 30, 'none', []),
    ];
    expect(linkFigureSteps(figures, steps).map((f) => f.stepId)).toEqual(['step-2', 'step-1', null, null]);
  });

  it('links nothing when the turn has no steps', () => {
    expect(linkFigureSteps([fig('250', 0)], null)[0].stepId).toBeNull();
  });
});
