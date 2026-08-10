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

  // The shape production actually serves. Hosted instances are provisioned by
  // mindshub_services onto the `4nton.ai` zone (host_prefix `cw-`), NOT onto
  // `*.mindshub.ai` — so a predicate narrowed to the mindshub.ai suffix would
  // pass every other test here and still leave prod dead-ended on Keycloak's
  // "Invalid parameter: redirect_uri". Observed live 2026-08-10 (ENG-1281).
  it('is true for a legacy cw-<id> host on the 4nton.ai zone (prod)', () => {
    expect(isLegacyTenantHost('cw-9a9e789c.4nton.ai')).toBe(true);
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
