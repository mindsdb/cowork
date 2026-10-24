import { describe, expect, it } from 'vitest';
import { isEmailShaped } from './emailAddress';

describe('isEmailShaped', () => {
  it.each(['ben@example.com', '  ben@example.com  ', 'b.en+x@sub.example.co'])('accepts %j', (value) => {
    expect(isEmailShaped(value)).toBe(true);
  });

  it.each(['', 'ben', 'ben@', 'ben@example', '@example.com', 'ben @example.com', 'a@b@c.com', null, undefined])('refuses %j', (value) => {
    expect(isEmailShaped(value)).toBe(false);
  });
});
