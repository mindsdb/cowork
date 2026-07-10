import { describe, it, expect } from 'vitest';
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
