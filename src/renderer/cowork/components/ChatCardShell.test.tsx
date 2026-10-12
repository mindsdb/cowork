import { describe, it, expect } from 'vitest';
import { cardActions } from './ChatCardShell';

describe('cardActions', () => {
  it('gives no bar for no buttons', () => {
    expect(cardActions([])).toBeNull();
  });

  it('puts the marked button first in rank, the next beside it, the rest in overflow', () => {
    const a = { label: 'A' };
    const b = { label: 'B', primary: true };
    const c = { label: 'C' };
    const bar = cardActions([a, b, c]);
    expect(bar?.primary).toBe(b);
    expect(bar?.secondary).toBe(a);
    expect(bar?.overflow).toEqual([{ label: 'C', onClick: undefined, disabled: undefined }]);
  });

  it('makes a lone unmarked button the primary rather than a borderless secondary', () => {
    // UsageAlertCard's only action, "View usage", is not marked primary.
    const only = { label: 'View usage' };
    const bar = cardActions([only]);
    expect(bar?.primary).toBe(only);
    expect(bar?.secondary).toBeNull();
  });
});
