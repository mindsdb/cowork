import { describe, it, expect } from 'vitest';
import { hasRequiredTokens } from './oauth-connect-result';

describe('hasRequiredTokens', () => {
  const accessOnly = { ok: true, access_token: 'at' };

  it('accepts an exchange with no refresh_token when the spec marks it optional', () => {
    expect(hasRequiredTokens(accessOnly, { refresh_token_optional: true })).toBe(true);
  });

  it('still rejects a refreshing connector that returns no refresh_token', () => {
    expect(hasRequiredTokens(accessOnly, {})).toBe(false);
    expect(hasRequiredTokens(accessOnly, { supports_refresh: true })).toBe(false);
  });

  it('accepts no refresh_token for a connector that never refreshes', () => {
    expect(hasRequiredTokens(accessOnly, { supports_refresh: false })).toBe(true);
  });

  it('rejects a failed exchange or one without an access token, even when refresh is optional', () => {
    expect(hasRequiredTokens({ ok: false }, { refresh_token_optional: true })).toBe(false);
    expect(hasRequiredTokens({ ok: true, refresh_token: 'rt' }, { refresh_token_optional: true })).toBe(false);
  });
});
