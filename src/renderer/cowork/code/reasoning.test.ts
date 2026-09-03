import { describe, expect, it } from 'vitest';

import { DEFAULT_EFFORT_VALUE, REASONING_EFFORTS, isReasoningEffort, reasoningEffortLabel, reasoningEffortOptions } from './reasoning';


describe('reasoning effort options', () => {
  it('lists the five efforts in increasing order behind a Default entry', () => {
    expect(REASONING_EFFORTS.map((item) => item.value)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
    const options = reasoningEffortOptions();
    expect(options[0]).toMatchObject({ value: DEFAULT_EFFORT_VALUE, label: 'Default' });
    expect(options).toHaveLength(6);
  });

  it('labels efforts for display and recognises picker values', () => {
    expect(reasoningEffortLabel('xhigh')).toBe('Extra high');
    expect(reasoningEffortLabel(null)).toBe('Default');
    expect(isReasoningEffort('high')).toBe(true);
    expect(isReasoningEffort(DEFAULT_EFFORT_VALUE)).toBe(false);
  });
});
