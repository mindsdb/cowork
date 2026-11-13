/* Pseudo-localization for the dev-only en-XA locale: every letter accented,
   the text padded about 35% and bracketed. Text that went through t() looks
   like "[Ŝḗŧŧīƞɠş ~~~]"; anything still plain English skipped t(). The
   padding approximates Spanish / Portuguese length, so truncation and
   wrapping bugs show up before a real translation lands. */

const ACCENTED: Record<string, string> = {
  a: 'ȧ', b: 'ƀ', c: 'ƈ', d: 'ḓ', e: 'ḗ', f: 'ƒ', g: 'ɠ', h: 'ħ', i: 'ī', j: 'ĵ',
  k: 'ķ', l: 'ŀ', m: 'ḿ', n: 'ƞ', o: 'ǿ', p: 'ƥ', q: 'ɋ', r: 'ř', s: 'ş', t: 'ŧ',
  u: 'ŭ', v: 'ṽ', w: 'ẇ', x: 'ẋ', y: 'ẏ', z: 'ẑ',
  A: 'Ȧ', B: 'Ɓ', C: 'Ƈ', D: 'Ḓ', E: 'Ḗ', F: 'Ƒ', G: 'Ɠ', H: 'Ħ', I: 'Ī', J: 'Ĵ',
  K: 'Ķ', L: 'Ŀ', M: 'Ḿ', N: 'Ƞ', O: 'Ǿ', P: 'Ƥ', Q: 'Ɋ', R: 'Ř', S: 'Ş', T: 'Ŧ',
  U: 'Ŭ', V: 'Ṽ', W: 'Ẇ', X: 'Ẋ', Y: 'Ẏ', Z: 'Ẑ',
};

export function pseudoLocalize(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  const accented = text.replace(/[A-Za-z]/g, (ch) => ACCENTED[ch] ?? ch);
  const padding = '~'.repeat(Math.max(1, Math.round(text.length * 0.35)));
  return `[${accented} ${padding}]`;
}
