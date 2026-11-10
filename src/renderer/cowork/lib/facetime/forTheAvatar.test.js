import { describe, expect, it } from 'vitest';
import { forTheAvatar, MAX_RESULT_CHARS, PHONE_PLACEHOLDER, withoutPhoneNumbers } from './forTheAvatar';

describe('phone numbers never reach the avatar', () => {
  it.each([
    '+1 (415) 555-0134',
    '415-555-0134',
    '415.555.0134',
    '(415) 555 0134',
    '+44 20 7946 0958',
    '+4915123456789',
    '4155550134',
  ])('replaces %s', (phone) => {
    expect(withoutPhoneNumbers(`Call the hotel at ${phone} to confirm.`)).toBe(`Call the hotel at ${PHONE_PLACEHOLDER} to confirm.`);
  });

  it.each([
    'Revenue grew 12.5% to $1,234,567 in 2026.',
    'The meeting is on 2026-11-09 at 10:30.',
    'Dial 911 or 988 in an emergency.',
    'Order 4821 shipped; 3 of 12 items left.',
    'Pi is 3.14159265.',
  ])('keeps %s', (text) => {
    expect(withoutPhoneNumbers(text)).toBe(text);
  });
});

describe('forTheAvatar', () => {
  it('leaves code blocks on screen and keeps it short', () => {
    const answer = `Done.\n\`\`\`sql\nselect 1\n\`\`\`\n${'x'.repeat(MAX_RESULT_CHARS + 100)}`;
    const out = forTheAvatar(answer);
    expect(out).toContain('[a block shown in the task]');
    expect(out).not.toContain('select 1');
    expect(out).toMatch(/the rest is in the task on screen\)$/);
  });

  it('says so when Anton wrote nothing', () => {
    expect(forTheAvatar('  ')).toMatch(/without a written answer/);
  });
});
