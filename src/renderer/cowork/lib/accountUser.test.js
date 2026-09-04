import { describe, expect, it } from 'vitest';
import { accountInitials, accountUserFromToken } from './accountUser';

// Encodes the payload the way a real issuer does: JSON → UTF-8 bytes →
// base64url. Building the fixture with `btoa(JSON.stringify(...))` instead
// would throw on any non-ASCII character, which is the same Latin-1 assumption
// the bug was made of — so the helper has to go through TextEncoder for these
// tests to mean anything.
function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(claims) {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson(claims)}.signature`;
}

// ENG-2138. `atob` yields one JS character per byte, so the old
// `JSON.parse(atob(payload))` decoded a UTF-8 payload as Latin-1 and every
// non-ASCII character came apart into its bytes. Each case below is a
// different UTF-8 sequence length, because they fail differently: a 2-byte
// character produced two visible characters, a 3-byte one produced three, and
// an astral character came through as four.
describe('accountUserFromToken — non-ASCII claims (ENG-2138)', () => {
  it('keeps an accented name intact — the reported case', () => {
    const user = accountUserFromToken(token({ name: 'Genesis Solórzano', sub: 'u1' }));
    expect(user.name).toBe('Genesis Solórzano');
    // The exact string the account row rendered before the fix; asserted by
    // value so a future regression names itself instead of failing on a diff.
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
  // The subtler half of ENG-2138: initials take the first character of each
  // word, so a name *beginning* with a non-ASCII letter put the first byte of
  // that letter in the avatar circle — 'Ã' for 'Á'. 'Solórzano' hid this,
  // because its accent is not the first character.
  it('uses the real first letter of an accented name', () => {
    expect(accountInitials({ name: 'Ángel Muñoz' })).toBe('ÁM');
  });

  // Through the decode, not a hand-built object — this is the assertion that
  // actually guards the avatar against ENG-2138. The one above only checks the
  // initials logic, and passes even with the Latin-1 decode restored.
  it('uses the real first letter for an accented name read from a token', () => {
    const user = accountUserFromToken(token({ given_name: 'Ángel', family_name: 'Muñoz' }));
    expect(accountInitials(user)).toBe('ÁM');
  });

  // String indexing returns a UTF-16 code unit, so an astral first character
  // used to put a lone high surrogate (U+D83D) in the circle — tofu, not a
  // letter. BMP accents never showed this, which is why it survived the first
  // pass of ENG-2138.
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
    // Previously this built a user of all-nulls, which renders as a signed-in
    // account naming nobody. A payload that is not an object is a token we
    // cannot read, and ENG-761's rule is that those show the sign-in card.
    expect(accountUserFromToken(`${base64UrlJson({ alg: 'none' })}.${base64UrlJson([1, 2])}.sig`))
      .toBeNull();
  });
});
