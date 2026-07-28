import { describe, it, expect } from 'vitest';
import { isThinkingActive } from './thinkingActive';

describe('isThinkingActive', () => {
  it('stays active while thinking (no steps/body text yet)', () => {
    expect(isThinkingActive('thinking')).toBe(true);
  });

  it('stays active while streaming body text — the agent may still resume tool calls (ENG-1107)', () => {
    expect(isThinkingActive('streaming')).toBe(true);
  });

  it('collapses once the turn is actually done', () => {
    expect(isThinkingActive('done')).toBe(false);
  });

  it('collapses on a terminal error', () => {
    expect(isThinkingActive('error')).toBe(false);
  });
});
