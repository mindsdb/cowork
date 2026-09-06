import { describe, expect, it } from 'vitest';
import { accountInitials, accountUserFromToken } from './accountUser';

// Encode fixtures as UTF-8 before base64url so non-ASCII tests reproduce real JWTs instead of
// repeating the Latin-1 bug.
function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(claims) {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson(claims)}.signature`;
}

// Cover two-, three- and four-byte UTF-8 characters; direct JSON.parse(atob()) corrupts each
// differently.
describe('accountUserFromToken — non-ASCII claims (ENG-2138)', () => {
  it('keeps an accented name intact — the reported case', () => {
    const user = accountUserFromToken(token({ name: 'Genesis Solórzano', sub: 'u1' }));
    expect(user.name).toBe('Genesis Solórzano');
    // Assert the known mojibake string is absent to expose decoding regressions.
    expect(user.name).not.toBe('Genesis SolÃ³rzano');
  });

  it('keeps a 3-byte character intact', () => {
    const user = accountUserFromToken(token({ name: '林 芳', sub: 'u2' }));
    expect(user.name).toBe('林 芳');
  });

  it('keeps an astral character intact', () => {
    const user = accountUserFromToken(token({ name: 'Ada 🛰 Byron', sub: 'u3' }));
    expect(user.name).toBe('Ada 🛰 Byron');
  });

  it('keeps accents in the given/family fallback, not just the name claim', () => {
    const user = accountUserFromToken(
      token({ given_name: 'Ángel', family_name: 'Muñoz', sub: 'u4' }),
    );
    expect(user.name).toBe('Ángel Muñoz');
  });

  it('keeps accents in the organization label', () => {
    const user = accountUserFromToken(token({
      sub: 'u5',
      activate_organization: { id: 'org-1', name: 'acme', displayName: 'Açaí Ltda' },
    }));
    expect(user.org).toBe('Açaí Ltda');
  });

  it('keeps a non-ASCII email intact', () => {
    const user = accountUserFromToken(token({ email: 'jose@peña.example', sub: 'u6' }));
    expect(user.email).toBe('jose@peña.example');
  });
});

describe('accountInitials', () => {
  // Put an accent at the beginning of a name to exercise initials, not only full-name display.
  it('uses the real first letter of an accented name', () => {
    expect(accountInitials({ name: 'Ángel Muñoz' })).toBe('ÁM');
  });

  // Decode a real token before checking initials; hand-built user objects bypass the broken decode
  // path.
  it('uses the real first letter for an accented name read from a token', () => {
    const user = accountUserFromToken(token({ given_name: 'Ángel', family_name: 'Muñoz' }));
    expect(accountInitials(user)).toBe('ÁM');
  });

  // An astral initial requires a code point, not a lone UTF-16 surrogate; BMP accents cannot expose
  // this.
  it('uses a whole code point when the name starts with an astral character', () => {
    const initials = accountInitials({ name: '🛰 Byron' });
    expect(initials).toBe('🛰B');
    expect([...initials].some((c) => {
      const point = c.codePointAt(0);
      return point >= 0xd800 && point <= 0xdfff;
    })).toBe(false);
  });

  it('falls back to the email initial when there is no name', () => {
    expect(accountInitials({ email: 'someone@example.com' })).toBe('S');
  });

  it('falls back to ? when the account names nothing', () => {
    expect(accountInitials({})).toBe('?');
  });
});

describe('accountUserFromToken — unreadable tokens stay unreadable (ENG-761)', () => {
  it('returns null without a token', () => {
    expect(accountUserFromToken(null)).toBeNull();
    expect(accountUserFromToken('')).toBeNull();
  });

  it('returns null for a token that is not a JWT', () => {
    expect(accountUserFromToken('not-a-jwt')).toBeNull();
  });

  it('returns null when the payload segment is not decodable', () => {
    expect(accountUserFromToken('header.!!!not-base64!!!.signature')).toBeNull();
  });

  it('returns null when the payload decodes to something other than an object', () => {
    // Non-object payloads must be unreadable rather than produce a signed-in account with no
    // identity.
    expect(accountUserFromToken(`${base64UrlJson({ alg: 'none' })}.${base64UrlJson([1, 2])}.sig`))
      .toBeNull();
  });
});
