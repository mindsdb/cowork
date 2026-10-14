import { describe, it, expect } from 'vitest';

// This decides which account's data root a session gets, so a token it cannot
// read must resolve to "no account" rather than to something partial — the
// caller treats null as "cannot name the account" and fails closed on it.
import { accountIdFromToken, activeOrgIdFromToken, decodeJwtPayload, orgIdFromClaim } from './jwt';

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

// The organization claim decides which store root a session reads, and the same
// reader feeds the organization list, so a shape it mis-parses would put the
// two out of step about which organization the session is in.
describe('reading the active organization from a token', () => {
  it('reads the claim under each name the issuer uses', () => {
    for (const name of ['active_organization', 'activate_organization', 'organization']) {
      expect(activeOrgIdFromToken(tokenFor({ [name]: { id: 'org-a' } }))).toBe('org-a');
    }
  });

  it('prefers the more specific claim when more than one is present', () => {
    expect(activeOrgIdFromToken(tokenFor({
      active_organization: { id: 'org-a' },
      organization: { id: 'org-b' },
    }))).toBe('org-a');
  });

  it('reads a claim delivered as a JSON string', () => {
    expect(activeOrgIdFromToken(tokenFor({ active_organization: '{"id":"org-a"}' }))).toBe('org-a');
  });

  it('reads a claim delivered as a bare string', () => {
    expect(activeOrgIdFromToken(tokenFor({ active_organization: 'org-a' }))).toBe('org-a');
  });

  it('unwraps a nested organization object', () => {
    expect(orgIdFromClaim({ organization: { id: 'org-a' } })).toBe('org-a');
  });

  it('falls through the id aliases', () => {
    expect(orgIdFromClaim({ keycloak_id: 'org-a' })).toBe('org-a');
    expect(orgIdFromClaim({ organization_id: 'org-a' })).toBe('org-a');
    expect(orgIdFromClaim({ org_id: 'org-a' })).toBe('org-a');
    expect(orgIdFromClaim({ name: 'org-a' })).toBe('org-a');
  });

  it('returns null rather than something partial when it cannot read one', () => {
    expect(activeOrgIdFromToken(null)).toBeNull();
    expect(activeOrgIdFromToken(tokenFor({ sub: 'acct-1' }))).toBeNull();
    expect(activeOrgIdFromToken('not-a-jwt')).toBeNull();
    expect(orgIdFromClaim({ id: '' })).toBeNull();
    expect(orgIdFromClaim('   ')).toBeNull();
  });
});
