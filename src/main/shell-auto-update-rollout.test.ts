import { describe, expect, it } from 'vitest';
import { shellAutoUpdateEnabledFor } from './shell-auto-update-rollout';

describe('shellAutoUpdateEnabledFor', () => {
  it('enables stable by default while prod remains held back', () => {
    expect(shellAutoUpdateEnabledFor('stable', undefined)).toBe(true);
    expect(shellAutoUpdateEnabledFor('prod', undefined)).toBe(false);
  });

  it('supports an emergency stable kill switch and explicit prod QA opt-in', () => {
    expect(shellAutoUpdateEnabledFor('stable', 'false')).toBe(false);
    expect(shellAutoUpdateEnabledFor('stable', '0')).toBe(false);
    expect(shellAutoUpdateEnabledFor('prod', 'true')).toBe(true);
    expect(shellAutoUpdateEnabledFor('prod', '1')).toBe(true);
  });

  it('fails closed for unsupported builds and misspelled overrides', () => {
    expect(shellAutoUpdateEnabledFor('preview', 'true')).toBe(false);
    expect(shellAutoUpdateEnabledFor(null, 'true')).toBe(false);
    expect(shellAutoUpdateEnabledFor('stable', 'ture')).toBe(false);
  });
});
