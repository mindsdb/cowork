import { describe, it, expect } from 'vitest';

// This decides which account's data root a session gets, so a token it cannot
// read must resolve to "no account" rather than to something partial — the
// caller treats null as "cannot name the account" and fails closed on it.
import { accountIdFromToken, decodeJwtPayload } from './jwt';

const tokenFor = (payload: unknown) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('decodeJwtPayload', () => {
  it('reads a base64url payload, including one needing padding', () => {
    // base64url with '-' and '_' and a length that is not a multiple of four is
    // the normal shape of a real Keycloak token, not an edge case.
    const payload = { sub: 'abc', name: 'Ada ✓', nested: { a: 1 } };
    expect(decodeJwtPayload(tokenFor(payload))).toEqual(payload);
  });

  it('returns null rather than throwing on anything unreadable', () => {
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('header.@@@not-base64@@@.sig')).toBeNull();
    expect(decodeJwtPayload(`header.${Buffer.from('{broken').toString('base64url')}.sig`)).toBeNull();
  });
});

describe('accountIdFromToken', () => {
  it('returns the subject', () => {
    expect(accountIdFromToken(tokenFor({ sub: '11111111-1111-4111-8111-111111111111' })))
      .toBe('11111111-1111-4111-8111-111111111111');
  });

  it('trims surrounding whitespace, which would otherwise reach a path', () => {
    expect(accountIdFromToken(tokenFor({ sub: '  abc  ' }))).toBe('abc');
  });

  it('is null for no token, no subject, or a subject that is not a string', () => {
    expect(accountIdFromToken(null)).toBeNull();
    expect(accountIdFromToken(tokenFor({}))).toBeNull();
    expect(accountIdFromToken(tokenFor({ sub: '   ' }))).toBeNull();
    expect(accountIdFromToken(tokenFor({ sub: 42 }))).toBeNull();
    expect(accountIdFromToken('not-a-jwt')).toBeNull();
  });
});
