import { describe, it, expect } from 'vitest';
import { displayName } from './senderName';

describe('displayName', () => {
  it.each([
    ['plain name', 'Mom', 'Mom'],
    ['right-to-left override', 'Mom‮txt.exe', 'Momtxt.exe'],
    ['isolates and marks', '⁦M‎o‏m⁩', 'Mom'],
    ['zero-width space and joiner', 'M​o‍m', 'Mom'],
    ['arabic letter mark', 'Mo؜m', 'Mom'],
    ['tag characters', 'Mom\u{E0041}\u{E0042}', 'Mom'],
    ['interlinear annotation', '￹Mom￻', 'Mom'],
    ['line and paragraph separators', 'Mo m ', 'Mom'],
    ['control characters', 'M\u0000o\u001Bm\u0085', 'Mom'],
    ['letters that draw nothing', 'M\u3164o\u115F\u1160m\uFFA0\u2800', 'Mom'],
  ])('removes %s', (_name, raw, expected) => {
    expect(displayName(raw, 'id')).toBe(expected);
  });

  it('keeps visible look-alike letters, which is why the id is shown beside it', () => {
    expect(displayName('Мom', 'id')).toBe('Мom');
  });

  it.each([null, undefined, '', '   ', '\u202E\u200B', '\u3164', '\u2800\u2800'])('falls back when nothing visible is left (%j)', (raw) => {
    expect(displayName(raw, '4242')).toBe('4242');
  });
});
