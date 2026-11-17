import { describe, expect, it } from 'vitest';
import { formatDate, inlineToHtml, toneFor } from './docModel';

// inlineToHtml as it was when every mark was one alternative of one regex.
// Italic, links and chips are scanned now (their regexes are quadratic on
// marks that never close); the scans must read every text the same way.
const REGEX_SRC = [
  '\\\\([*`~\\[\\]{}_\\\\])',
  '`([^`]+)`',
  '\\*\\*(.+?)\\*\\*',
  '~~(.+?)~~',
  '\\[([^\\]]+)\\]\\(((?:https?:|mailto:)[^)\\s]+)\\)',
  '\\{\\{\\s*(date|status|user)\\s*:\\s*([^}]+?)\\s*\\}\\}',
  '(?<![*\\w])\\*(?!\\s)(.+?)(?<!\\s)\\*(?![*\\w])',
  '(?<![_\\w])_(?!\\s)(.+?)(?<!\\s)_(?![_\\w])',
].join('|');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function chip(kind, value) {
  const label = kind === 'date' ? formatDate(value) : kind === 'user' && value === 'me' ? 'You' : value;
  const tone = kind === 'status' ? ` doc-tone--${toneFor(value)}` : '';
  return `<span class="doc-chip doc-chip--${kind}${tone}" contenteditable="false" data-chip="${esc(`${kind}:${value}`)}">${esc(label)}</span>`;
}

function regexInlineToHtml(src) {
  const re = new RegExp(REGEX_SRC, 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)).replace(/\n/g, '<br>');
    if (m[1] !== undefined) out += esc(m[1]);
    else if (m[2] !== undefined) out += `<code>${esc(m[2])}</code>`;
    else if (m[3] !== undefined) out += `<strong>${regexInlineToHtml(m[3])}</strong>`;
    else if (m[4] !== undefined) out += `<s>${regexInlineToHtml(m[4])}</s>`;
    else if (m[5] !== undefined) out += `<a href="${esc(m[6])}" target="_blank" rel="noopener noreferrer">${regexInlineToHtml(m[5])}</a>`;
    else if (m[7] !== undefined) out += chip(m[7], m[8]);
    else out += `<em>${regexInlineToHtml(m[9] ?? m[10])}</em>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last)).replace(/\n/g, '<br>');
}

// Pieces that open, close or break marks, and the characters the regexes' \s, \w and . treat apart.
const ch = (code) => String.fromCharCode(code);
const PIECES = [
  '*', '**', '_', '__', '~', '~~', '`', '\\', '\\*', '\\_', '[', ']', '(', ')', '](', '](http://', '](https://', '](https:',
  '](mailto:', '{', '}', '{{', '}}', '{{date:', '{{status:', '{{ user :', ':', ' ', '  ', '\n', '\t', '\r', ch(0xa0),
  ch(0x2028), ch(0x2029), ch(0xfeff), ch(0x1c), 'a', 'b c', 'é', '1', '&', '<', '"', 'x.com/_p_', '2026-10-21', 'me',
];

describe('inline marks are scanned', () => {
  it('reads any text as the one regex did', () => {
    let seed = 3667;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    for (let k = 0; k < 5000; k++) {
      let text = '';
      for (let n = 1 + rand(14); n > 0; n--) text += PIECES[rand(PIECES.length)];
      expect(inlineToHtml(text), JSON.stringify(text)).toBe(regexInlineToHtml(text));
    }
  });

  it.each([
    ['**a *b* c**', '<strong>a <em>b</em> c</strong>'],
    ['~~a *b* c~~', '<s>a <em>b</em> c</s>'],
    ['*a *b**', '<em>a <em>b</em></em>'],
    ['*_a_*', '<em><em>a</em></em>'],
    ['*a* and _b_', '<em>a</em> and <em>b</em>'],
    ['*a* b* c*', '<em>a</em> b* c*'],
    ['_a _b_ c_', '<em>a _b</em> c_'],
    ['_a_b_', '<em>a_b</em>'],
    ['*a\nb*', '*a<br>b*'],
    ['*a\rb*', '*a\rb*'],
    ['a * b * c', 'a * b * c'],
    ['[[a](http://x.io)', '<a href="http://x.io" target="_blank" rel="noopener noreferrer">[a</a>'],
    ['[*a*](mailto:me@x.io)', '<a href="mailto:me@x.io" target="_blank" rel="noopener noreferrer"><em>a</em></a>'],
    ['[a](http://x y)', '[a](http://x y)'],
    ['[a]](http://x.io)', '[a]](http://x.io)'],
    ['[](http://x.io)', '[](http://x.io)'],
    ['{{ date : 2026-10-21 }}', '<span class="doc-chip doc-chip--date" contenteditable="false" data-chip="date:2026-10-21">Oct 21, 2026</span>'],
    ['{{status:   }}', '<span class="doc-chip doc-chip--status doc-tone--gray" contenteditable="false" data-chip="status: "> </span>'],
    ['{{user: {{status: done}}', '<span class="doc-chip doc-chip--user" contenteditable="false" data-chip="user:{{status: done">{{status: done</span>'],
    ['{{date:a}', '{{date:a}'],
  ])('renders %j as before', (text, html) => {
    expect(inlineToHtml(text)).toBe(html);
  });

  it.each([
    ['italic-star', '*a '.repeat(66_667)],
    ['italic-underscore', '_a '.repeat(66_667)],
    ['link-words', '['.repeat(200_000)],
    ['link-address', '[a](http://'.repeat(18_182)],
    ['chip-value', '{{date:'.repeat(28_572)],
    ['chip-spaces', `{{date:a${' '.repeat(200_000)}`],
  ])('renders marks that never close in linear time (%s)', (_name, text) => {
    // The regex took 2-20 s on each of these.
    const start = performance.now();
    inlineToHtml(text);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('renders marks nested thousands deep', () => {
    // Each *a but the innermost opens one more italic; recursion overflowed the call stack here.
    const html = inlineToHtml('*a '.repeat(8000) + '*'.repeat(8000));
    expect(html.split('<em>').length - 1).toBe(7999);
  });
});
