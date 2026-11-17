import { describe, expect, it } from 'vitest';
import { compareSourceLines } from './sourceComparison';

describe('compareSourceLines', () => {
  it('splits separate edits into separate changes', () => {
    const result = compareSourceLines('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE');
    expect(result.hunks).toEqual([
      { beforeStart: 1, beforeEnd: 1, afterStart: 1, afterEnd: 1 },
      { beforeStart: 4, beforeEnd: 4, afterStart: 4, afterEnd: 4 },
    ]);
    expect(result.count).toBe(2);
  });

  it('marks an addition with an empty range on the side that lacks it', () => {
    const result = compareSourceLines('a\nc', 'a\nb\nc');
    expect(result.hunks).toEqual([{ beforeStart: 1, beforeEnd: 0, afterStart: 1, afterEnd: 1 }]);
    expect(result.count).toBe(1);
  });

  it('reports no changes for identical content', () => {
    expect(compareSourceLines('same\ntext', 'same\ntext')).toMatchObject({ hunks: [], count: 0 });
  });

  it('treats a very large changed middle as one change', () => {
    const before = Array.from({ length: 2500 }, (_, i) => `before ${i}`).join('\n');
    const after = Array.from({ length: 2500 }, (_, i) => (i % 2 ? `before ${i}` : `after ${i}`)).join('\n');
    expect(compareSourceLines(before, after).hunks).toHaveLength(1);
  });
});
