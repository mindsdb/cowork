import { describe, it, expect, vi } from 'vitest';

// token-refresh.ts pulls in keychain-service.ts, which imports the native
// `keytar` module at load time — fine on macOS (Keychain Services), but it
// requires libsecret on Linux, which CI's runner doesn't have. This test
// only exercises the pure parseAppIdFromClientId function, so the real
// keychain module is never needed; mocking it here avoids paying that
// native-dependency cost just to import the file at all.
vi.mock('./keychain-service', () => ({
  getRefreshToken: vi.fn(),
  setRefreshToken: vi.fn(),
}));

import { parseAppIdFromClientId } from './token-refresh';

describe('parseAppIdFromClientId', () => {
  it('extracts the leading project number from a standard client id', () => {
    expect(parseAppIdFromClientId('123456789012-abc123def456.apps.googleusercontent.com')).toBe(
      '123456789012',
    );
  });

  it('returns empty string for a client id with no leading digits', () => {
    expect(parseAppIdFromClientId('abc123def456.apps.googleusercontent.com')).toBe('');
  });

  it('returns empty string for an empty client id', () => {
    expect(parseAppIdFromClientId('')).toBe('');
  });

  it('does not match digits that are not at the very start', () => {
    expect(parseAppIdFromClientId('abc-123456789012-def.apps.googleusercontent.com')).toBe('');
  });

  it('only takes the digits immediately before the first hyphen', () => {
    expect(parseAppIdFromClientId('123-456-abc.apps.googleusercontent.com')).toBe('123');
  });
});
