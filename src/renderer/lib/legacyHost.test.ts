import { describe, it, expect } from 'vitest';
import { isLegacyTenantHost } from './legacyHost';

describe('isLegacyTenantHost', () => {
  // Legacy per-user hosts skip the SPA Keycloak login (gated upstream).
  it('is true for a legacy cw-<id> staging host', () => {
    expect(isLegacyTenantHost('cw-e075837b.staging.mindshub.ai')).toBe(true);
  });

  it('is true for a legacy cw-<id> prod host', () => {
    expect(isLegacyTenantHost('cw-e075837b.mindshub.ai')).toBe(true);
  });

  // Canonical / dev hosts must still require a Keycloak login.
  it('is false for the canonical cowork.<env> host', () => {
    expect(isLegacyTenantHost('cowork.staging.mindshub.ai')).toBe(false);
    expect(isLegacyTenantHost('cowork.mindshub.ai')).toBe(false);
  });

  it('is false for a PR cowork-<pr> host (not a cw- prefix)', () => {
    expect(isLegacyTenantHost('cowork-pr123.dev.mindshub.ai')).toBe(false);
  });

  it('is false for localhost dev', () => {
    expect(isLegacyTenantHost('localhost')).toBe(false);
  });
});
