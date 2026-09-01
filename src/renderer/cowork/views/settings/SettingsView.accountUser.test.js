import { describe, it, expect } from 'vitest';
import { providerStatusBadge } from './SettingsView';
import { accountUserFromToken, accountInitials, skillScopeKey } from '../../lib/accountUser';
import { PERSONAL_ORG_LABEL } from '../../../../shared/minds-orgs';

const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

describe('accountUserFromToken', () => {
  it('maps identity claims from a decodable token', () => {
    const user = accountUserFromToken(jwt({
      name: 'Hazem Ahmed',
      email: 'hazem@example.com',
      preferred_username: 'hazem',
      sub: 'user-1',
      activate_organization: { id: 'org-1', name: 'MindsDB' },
    }));
    expect(user).toEqual({
      name: 'Hazem Ahmed',
      email: 'hazem@example.com',
      username: 'hazem',
      sub: 'user-1',
      org: 'MindsDB',
      orgId: 'org-1',
      picture: null,
    });
  });

  // The realm issues `activate_organization`. This read named
  // `active_organization` for its whole life, so the org line in the account
  // menu and the Organization row in Settings rendered nothing at all —
  // silently, because both are conditional on the value being there.
  it('reads the organization claim the realm actually issues', () => {
    const user = accountUserFromToken(jwt({
      sub: 'user-1',
      activate_organization: { id: 'org-acme', name: 'acme.example' },
    }));
    expect(user.org).toBe('acme.example');
    expect(user.orgId).toBe('org-acme');
  });

  /*
   * A personal organization's claim name is the raw `personal_<userId>` and the
   * claim carries no display name for it. Printing that is worse than a generic
   * label, and rebuilding auth's `<email>'s organization` here would be a third
   * copy of that rule. The listing supplies the real label; this is the floor
   * under it, because `activeOrgName` also gates the `Manage organization` row,
   * so returning nothing drops a navigation affordance too, on every first
   * paint and whenever that async read fails.
   */
  it('never offers the raw personal-organization name as a label', () => {
    const user = accountUserFromToken(jwt({
      sub: 'user-1',
      activate_organization: { id: 'org-personal', name: 'personal_user-1' },
    }));
    expect(user.org).toBe(PERSONAL_ORG_LABEL);
    expect(user.org).not.toContain('personal_');
    expect(user.orgId).toBe('org-personal');
  });

  it('leaves the label null when the claim names no organization at all', () => {
    expect(accountUserFromToken(jwt({ sub: 'user-1' })).org).toBeNull();
  });

  it('uses a display name on the claim when one is there', () => {
    const user = accountUserFromToken(jwt({
      sub: 'user-1',
      activate_organization: { id: 'org-personal', name: 'personal_user-1', displayName: "hazem@example.com's organization" },
    }));
    expect(user.org).toBe("hazem@example.com's organization");
  });

  it('still reads the older claim spellings', () => {
    expect(accountUserFromToken(jwt({ active_organization: { name: 'acme' } })).org).toBe('acme');
    expect(accountUserFromToken(jwt({ organization: { name: 'acme' } })).org).toBe('acme');
  });

  it('carries the picture claim through for the avatar (ENG-1408)', () => {
    const user = accountUserFromToken(jwt({ picture: 'https://cdn.example.com/a.png' }));
    expect(user.picture).toBe('https://cdn.example.com/a.png');
  });

  it('builds a name from given/family name when no display name claim exists', () => {
    const user = accountUserFromToken(jwt({ given_name: 'Hazem', family_name: 'Ahmed' }));
    expect(user.name).toBe('Hazem Ahmed');
  });

  it('parses an org claim delivered as a JSON string', () => {
    const user = accountUserFromToken(jwt({ organization: JSON.stringify({ name: 'acme' }) }));
    expect(user.org).toBe('acme');
  });

  it('returns null for a missing token (sign-in card shows)', () => {
    expect(accountUserFromToken(null)).toBeNull();
    expect(accountUserFromToken('')).toBeNull();
  });

  // ENG-761 regression: an undecodable token must clear the card, not
  // leave a previously decoded identity rendering over a dead session.
  it('returns null for an undecodable token', () => {
    expect(accountUserFromToken('not-a-jwt')).toBeNull();
    expect(accountUserFromToken('a.%%%not-base64%%%.b')).toBeNull();
  });
});

describe('accountInitials', () => {
  it.each([
    [{ name: 'Hazem Ahmed' }, 'HA'],
    [{ name: 'Hazem' }, 'H'],
    [{ email: 'hazem@example.com' }, 'H'],
    [{}, '?'],
    [null, '?'],
  ])('maps %o to %s', (user, expected) => {
    expect(accountInitials(user)).toBe(expected);
  });
});

describe('providerStatusBadge', () => {
  it.each([
    ['ok', true, { label: 'connected', variant: 'success' }],
    ['fail', true, { label: 'unable to connect', variant: 'danger' }],
    ['testing', true, { label: 'testing…', variant: 'warning' }],
    [null, true, { label: 'not tested', variant: 'muted' }],
    [null, false, null],
  ])('maps %s (configured: %s) to %o', (status, configured, expected) => {
    expect(providerStatusBadge(status, configured)).toEqual(expected);
  });
});

describe('skillScopeKey', () => {
  // Every personal organization prints as PERSONAL_ORG_LABEL, so a key built
  // from the label handed one person's cached skills to the next.
  it('separates two organizations that share a label', () => {
    const base = { sub: 'user-1', email: 'hazem@example.com' };
    const keyA = skillScopeKey({ ...base, org: PERSONAL_ORG_LABEL, orgId: 'org-a' });
    const keyB = skillScopeKey({ ...base, org: PERSONAL_ORG_LABEL, orgId: 'org-b' });
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain('org-a');
    expect(keyA).not.toContain(PERSONAL_ORG_LABEL);
  });

  it('falls back to the label only when the claim carries no id', () => {
    const user = { sub: 'user-1', email: 'hazem@example.com', org: 'acme.example', orgId: null };
    expect(skillScopeKey(user)).toBe('user-1:hazem@example.com:acme.example');
  });

  it('keys a signed-out session as such', () => {
    expect(skillScopeKey(null)).toBe('signed-out');
  });
});
