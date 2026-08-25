import { describe, expect, it } from 'vitest';
import { shellAutoUpdateEnabledFor } from './shell-auto-update-rollout';

describe('shellAutoUpdateEnabledFor', () => {
  it('enables both stable and prod by default', () => {
    expect(shellAutoUpdateEnabledFor('stable', undefined)).toBe(true);
    expect(shellAutoUpdateEnabledFor('prod', undefined)).toBe(true);
  });

  it('supports an emergency kill switch on either ring', () => {
    expect(shellAutoUpdateEnabledFor('stable', 'false')).toBe(false);
    expect(shellAutoUpdateEnabledFor('stable', '0')).toBe(false);
    expect(shellAutoUpdateEnabledFor('prod', 'false')).toBe(false);
    expect(shellAutoUpdateEnabledFor('prod', '0')).toBe(false);
  });

  it('still honors an explicit true opt-in', () => {
    expect(shellAutoUpdateEnabledFor('prod', 'true')).toBe(true);
    expect(shellAutoUpdateEnabledFor('prod', '1')).toBe(true);
    expect(shellAutoUpdateEnabledFor('stable', 'true')).toBe(true);
  });

  it('fails closed for unsupported builds and misspelled overrides', () => {
    expect(shellAutoUpdateEnabledFor('preview', 'true')).toBe(false);
    expect(shellAutoUpdateEnabledFor(null, 'true')).toBe(false);
    expect(shellAutoUpdateEnabledFor('stable', 'ture')).toBe(false);
  });
});
