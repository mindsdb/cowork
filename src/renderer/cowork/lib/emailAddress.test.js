import { describe, expect, it } from 'vitest';
import { isEmailShaped } from './emailAddress';

describe('isEmailShaped', () => {
  it.each([
    'ben@example.com',
    '  ben@example.com  ',
    'b.en+x@sub.example.co',
    "o'brien@acme.io",
    'ana_lopez-ruiz@mail.acme-corp.com',
    `${'a'.repeat(64)}@${'b'.repeat(63)}.com`,
  ])('accepts %j', (value) => {
    expect(isEmailShaped(value)).toBe(true);
  });

  it.each(['', 'ben', 'ben@', 'ben@example', '@example.com', 'ben @example.com', 'a@b@c.com', null, undefined])('refuses %j', (value) => {
    expect(isEmailShaped(value)).toBe(false);
  });

  /* What MindsHub's people lookup refuses with a 400: an address this
     passed would strand a whole lookup batch. */
  it.each([
    ['a one-letter top-level domain', 'jo@acme.c'],
    ['a top-level domain with a digit', 'jo@acme.c0m'],
    ['doubled dots in the local part', 'bob..smith@acme.com'],
    ['a leading dot', '.bob@acme.com'],
    ['a trailing dot before the @', 'bob.@acme.com'],
    ['an empty domain label', 'bob@acme..com'],
    ['a label starting with a hyphen', 'bob@-acme.com'],
    ['a label ending with a hyphen', 'bob@acme-.com'],
    ['a trailing dot after the domain', 'bob@acme.com.'],
    ['a quote in the local part', 'bo"b@acme.com'],
    ['a domain label over 63 characters', `bob@${'b'.repeat(64)}.com`],
    ['more than 320 characters', `${'a'.repeat(300)}@${'b'.repeat(20)}.com`],
  ])('refuses %s', (_, value) => {
    expect(isEmailShaped(value)).toBe(false);
  });

  /* What MindsHub's people lookup takes: refused here, the address could
     never be shared with at all. */
  it.each([
    ['a host name with letters past ASCII', 'ana@münchen.de'],
    ['an accented label', 'ana@ácme.com'],
    ['a top-level domain in another script', 'ana@пример.рф'],
    ['a punycode top-level domain', 'ana@example.xn--p1ai'],
    ['a punycode host name', 'ana@xn--mnchen-3ya.de'],
    ['an inner hyphen in the top-level domain', 'ana@acme.a-b'],
    ['a host name of digits', 'ana@123.com'],
  ])('accepts %s', (_, value) => {
    expect(isEmailShaped(value)).toBe(true);
  });

  /* Django's validate_email takes these too; the rule here keeps to a
     dot-atom local part and a top-level domain, as the sharing contract
     says. */
  it.each([
    ['a quoted local part', '"bob"@acme.com'],
    ['a bracketed IP address', 'ana@[1.2.3.4]'],
    ['a host with no top-level domain', 'ana@localhost'],
    ['letters past ASCII in the local part', 'ñandu@acme.com'],
    ['a top-level domain that ends with a hyphen', 'ana@acme.co-'],
    ['a top-level domain that starts with a digit', 'ana@acme.1a'],
  ])('refuses %s', (_, value) => {
    expect(isEmailShaped(value)).toBe(false);
  });
});
