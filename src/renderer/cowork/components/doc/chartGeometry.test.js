import { describe, expect, it } from 'vitest';
import { barPath, clip, donutArcs, formatter, niceScale, stackTotals, unitParts } from './chartGeometry';

describe('unitParts', () => {
  it('puts a currency before values and a word after them', () => {
    expect(unitParts(' $ ')).toEqual({ prefix: '$', word: null });
    expect(unitParts('€')).toEqual({ prefix: '€', word: null });
    expect(unitParts('hours')).toEqual({ prefix: '', word: 'hours' });
    expect(unitParts('')).toEqual({ prefix: '', word: null });
    expect(unitParts(undefined)).toEqual({ prefix: '', word: null });
  });
});

describe('formatter', () => {
  it('writes values in full under 10,000 and compact from there', () => {
    expect(formatter([12, 1500.256], '')(1500.256)).toBe('1,500.26');
    expect(formatter([12, 15500], '')(15500)).toBe('15.5K');
    expect(formatter([-20000, 3], '')(3)).toBe('3');
  });

  it('prefixes a currency and signs a negative with a real minus', () => {
    expect(formatter([5], '$')(-5)).toBe('−$5');
    expect(formatter([5], 'hours')(5)).toBe('5');
  });

  it('shows a dash for a missing value', () => {
    expect(formatter([null, 1], '')(null)).toBe('—');
    expect(formatter([], '')(0)).toBe('0');
  });
});

describe('niceScale', () => {
  it('runs from zero to a round top', () => {
    expect(niceScale([12, 18, 15, 24])).toEqual({ lo: 0, hi: 30, ticks: [0, 10, 20, 30] });
  });

  it('goes below zero for negative values', () => {
    expect(niceScale([-3, 7])).toEqual({ lo: -5, hi: 10, ticks: [-5, 0, 5, 10] });
  });

  it('still has a span with nothing, or only zeros, to show', () => {
    expect(niceScale([])).toEqual({ lo: 0, hi: 1, ticks: [0, 0.5, 1] });
    expect(niceScale([0, null, Number.NaN])).toEqual({ lo: 0, hi: 1, ticks: [0, 0.5, 1] });
  });

  it('steps small spans finely and large ones coarsely', () => {
    expect(niceScale([0.3]).ticks).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceScale([980]).ticks).toEqual([0, 500, 1000]);
    expect(niceScale([45], 2).ticks).toEqual([0, 50]);
    expect(niceScale([6]).ticks).toEqual([0, 2, 4, 6]);
  });
});

describe('stackTotals', () => {
  it('sums each label\'s negatives and positives apart', () => {
    expect(stackTotals(['a', 'b'], [{ values: [3, -1] }, { values: [-2, null] }, { values: [4, 5] }]))
      .toEqual([[-2, 7], [-1, 5]]);
  });
});

describe('barPath', () => {
  it('rounds only the data end', () => {
    expect(barPath(0, 0, 10, 20, 4, 'up')).toBe('M0,20V4Q0,0 4,0H6Q10,0 10,4V20Z');
    expect(barPath(0, 0, 10, 20, 4, 'down')).toBe('M0,0V16Q0,20 4,20H6Q10,20 10,16V0Z');
    expect(barPath(0, 0, 20, 10, 4, 'right')).toBe('M0,0H16Q20,0 20,4V6Q20,10 16,10H0Z');
    expect(barPath(0, 0, 20, 10, 4, 'left')).toBe('M20,0H4Q0,0 0,4V6Q0,10 4,10H20Z');
  });

  it('keeps the rounding inside a thin bar, and draws nothing for an empty one', () => {
    expect(barPath(0, 0, 4, 20, 4, 'up')).toBe('M0,20V2Q0,0 2,0H2Q4,0 4,2V20Z');
    expect(barPath(0, 0, 0, 20, 4, 'up')).toBe('');
    expect(barPath(0, 0, 10, -1, 4, 'up')).toBe('');
  });
});

describe('donutArcs', () => {
  it('splits the ring by share, starting at the top', () => {
    const arcs = donutArcs([1, 1], 10, 5);
    expect(arcs.map((a) => [a.i, a.v])).toEqual([[0, 1], [1, 1]]);
    expect(arcs[0].d.startsWith('M10,0A10,10 0 0 1 10,20')).toBe(true);
    expect(arcs[1].d.startsWith('M10,20A10,10 0 0 1 ')).toBe(true);
  });

  it('flags a slice over half the ring as the large arc', () => {
    expect(donutArcs([3, 1], 10, 5)[0].d).toContain('A10,10 0 1 1');
  });

  it('draws a single value as a whole ring, and nothing as empty slices', () => {
    expect(donutArcs([5], 10, 5)[0].d).toBe('M10,0A10,10 0 1 1 9.99,0Z M10,5A5,5 0 1 0 10.01,5Z');
    expect(donutArcs([0, 0], 10, 5).every((a) => a.d.includes('0 0 1'))).toBe(true);
  });
});

describe('clip', () => {
  it('cuts long labels with an ellipsis', () => {
    expect(clip('Quarterly', 5)).toBe('Quar…');
    expect(clip('Q1', 5)).toBe('Q1');
    expect(clip(2026, 3)).toBe('20…');
  });
});
