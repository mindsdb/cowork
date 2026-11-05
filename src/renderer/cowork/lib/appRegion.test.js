import { describe, expect, it } from 'vitest';
import { overlayAppRegion } from './appRegion';

describe('overlayAppRegion', () => {
  it('opts an open overlay out of the drag region so it takes clicks', () => {
    expect(overlayAppRegion(true)).toBe('no-drag');
  });

  it('claims nothing while closed, so the titlebar keeps its buttons and its drag', () => {
    expect(overlayAppRegion(false)).toBeUndefined();
  });
});
