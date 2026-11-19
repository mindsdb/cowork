import { describe, expect, it } from 'vitest';
import { platformUiEnabled } from './ui-capabilities';

describe('platformUiEnabled', () => {
  it.each([undefined, '', 'false', '0', 'TRUE'])('requires an explicit web capability: %s', (value) => {
    expect(platformUiEnabled('web', value)).toBe(false);
  });

  it('enables the web capability when requested', () => {
    expect(platformUiEnabled('web', 'true')).toBe(true);
  });

  it.each([undefined, 'electron'])('retains desktop capabilities: %s', (target) => {
    expect(platformUiEnabled(target, undefined)).toBe(true);
    expect(platformUiEnabled(target, 'false')).toBe(true);
  });
});
