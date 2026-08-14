import { describe, it, expect } from 'vitest';
import { providerStatusBadge } from './SettingsView';
import { accountUserFromToken, accountInitials } from '../../lib/accountUser';

const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

describe('accountUserFromToken', () => {
  it('maps identity claims from a decodable token', () => {
    const user = accountUserFromToken(jwt({
      name: 'Hazem Ahmed',
      email: 'hazem@example.com',
      preferred_username: 'hazem',
      sub: 'user-1',
      active_organization: { displayName: 'MindsDB' },
    }));
    expect(user).toEqual({
      name: 'Hazem Ahmed',
      email: 'hazem@example.com',
      username: 'hazem',
      sub: 'user-1',
      org: 'MindsDB',
      picture: null,
    });
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
