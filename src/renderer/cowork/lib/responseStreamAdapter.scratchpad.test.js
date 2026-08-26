import { describe, it, expect } from 'vitest';
import { findOpenScratchpadTabId } from './responseStreamAdapter';

// The live-stream orchestration reads this after each reduceStream so Stop can
// cancel anton's current cell. Extracted from the four hand-rolled onEvent
// handlers in App.jsx (ENG-1917) so the one rule lives in one tested place.
describe('findOpenScratchpadTabId', () => {
  it('returns the tab id of the in-progress scratchpad cell', () => {
    const steps = [
      { status: 'completed', _isScratchpad: true, _scratchpadTabId: 'cell-1' },
      { status: 'in_progress', _isScratchpad: true, _scratchpadTabId: 'cell-2' },
    ];
    expect(findOpenScratchpadTabId(steps)).toBe('cell-2');
  });

  it('returns null when no scratchpad step is in progress', () => {
    const steps = [
      { status: 'completed', _isScratchpad: true, _scratchpadTabId: 'cell-1' },
      { status: 'in_progress', _isScratchpad: false, _scratchpadTabId: null },
    ];
    expect(findOpenScratchpadTabId(steps)).toBe(null);
  });

  it('returns null when the open scratchpad has no tab id yet', () => {
    const steps = [{ status: 'in_progress', _isScratchpad: true, _scratchpadTabId: null }];
    expect(findOpenScratchpadTabId(steps)).toBe(null);
  });

  it('ignores an in-progress step that is not a scratchpad', () => {
    const steps = [{ status: 'in_progress', _isScratchpad: false, _scratchpadTabId: 'x' }];
    expect(findOpenScratchpadTabId(steps)).toBe(null);
  });

  it('picks the first open scratchpad when several are in progress', () => {
    const steps = [
      { status: 'in_progress', _isScratchpad: true, _scratchpadTabId: 'first' },
      { status: 'in_progress', _isScratchpad: true, _scratchpadTabId: 'second' },
    ];
    expect(findOpenScratchpadTabId(steps)).toBe('first');
  });

  it('is safe on empty or missing step lists', () => {
    expect(findOpenScratchpadTabId([])).toBe(null);
    expect(findOpenScratchpadTabId(undefined)).toBe(null);
  });
});
