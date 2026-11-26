import { describe, it, expect } from 'vitest';
import { docGridColumns, docShare, docShareAt, docShareForKey } from './docLayout';

describe('the doc column', () => {
  it('is a share of the chat area, so a window resize cannot push it off screen', () => {
    expect(docGridColumns(0.58)).toBe('minmax(min(320px, 40%), 1fr) minmax(min(400px, 60%), 58%)');
    expect(docGridColumns(0.99)).toContain('78%');
    expect(docGridColumns(0.1)).toContain('32%');
    expect(docGridColumns(0.5, true)).toBe('0px minmax(0,1fr)');
  });

  it('opens at its default share until the person drags it', () => {
    expect(docGridColumns(null)).toBe(docGridColumns(0.58));
  });

  it('turns a drag into a share of the area', () => {
    const box = { left: 200, right: 1200, width: 1000 };
    expect(docShareAt(box, 700)).toBeCloseTo(0.5);
    expect(docShareAt(box, 1190)).toBeCloseTo(0.32);
    expect(docShareAt(box, 210)).toBeCloseTo(0.78);
    expect(docShareAt({ width: 0 }, 500)).toBeCloseTo(0.58);
  });

  it('moves with the keys on its divider, within its bounds', () => {
    expect(docShare(null)).toBeCloseTo(0.58);
    expect(docShareForKey(null, 'ArrowLeft')).toBeCloseTo(0.60);
    expect(docShareForKey(0.5, 'ArrowRight')).toBeCloseTo(0.48);
    expect(docShareForKey(0.77, 'ArrowLeft')).toBeCloseTo(0.78);
    expect(docShareForKey(0.33, 'ArrowRight')).toBeCloseTo(0.32);
    expect(docShareForKey(0.5, 'Home')).toBeCloseTo(0.32);
    expect(docShareForKey(0.5, 'End')).toBeCloseTo(0.78);
    expect(docShareForKey(0.5, 'Enter')).toBeNull();
  });
});
