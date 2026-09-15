import { describe, it, expect } from 'vitest';
import { getAgentLabel, harnessLabel } from './agentLabel';

describe('agentLabel', () => {
  it('defaults to Anton', () => {
    expect(getAgentLabel({})).toBe('Anton');
    expect(getAgentLabel({ harness: 'anton' })).toBe('Anton');
  });

  it('capitalizes a stored harness tag, so old messages keep a label', () => {
    // Old conversations keep their harness tag; the label must not go blank.
    expect(harnessLabel('hermes')).toBe('Hermes');
    expect(harnessLabel(null)).toBeNull();
  });
});
