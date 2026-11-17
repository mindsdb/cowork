import { describe, expect, it } from 'vitest';
import shared from '../../__fixtures__/docs-inline/cases.json';
import { inlineToHtml } from './docModel';

const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot);/g, (e) => ENTITY[e]);
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The editor's HTML in the form the shared cases hold (the server's): `<br>` as a line
 * feed, a link without its target and rel, a chip as the server writes it, quotes
 * unescaped in text. Throws on a tag the editor should never write or one closed out of order. */
function serverForm(markup) {
  const open = [];
  let out = '';
  for (const [, closing, tag, attrs, text] of markup.matchAll(/<(\/?)([a-z]+)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) out += encode(decode(text));
    else if (tag === 'br') out += '\n';
    else if (closing) {
      if (open.pop() !== tag) throw new Error(`</${tag}> closes out of order in ${markup}`);
      out += `</${tag}>`;
    } else {
      open.push(tag);
      if (tag === 'a') out += `<a href="${encode(decode(/href="([^"]*)"/.exec(attrs)[1])).replace(/"/g, '&quot;')}">`;
      else if (tag === 'span') out += `<span class="chip chip-${/doc-chip--(\w+)/.exec(attrs)[1]}">`;
      else if (['em', 'strong', 's', 'code'].includes(tag)) out += `<${tag}>`;
      else throw new Error(`unexpected <${tag}> in ${markup}`);
    }
  }
  if (open.length) throw new Error(`<${open.at(-1)}> left open in ${markup}`);
  return out;
}

// Pieces that open, close or break marks, and characters CommonMark counts as white space or punctuation.
const PIECES = [
  '*', '**', '***', '_', '__', '~', '~~', '`', '\\', '\\*', '\\_', '\\`', '[', ']', '(', ')', '](', '](http://x)',
  '](https://', '](mailto:a)', '{{', '}}', '{{date:', '{{ status :', '2026-10-21', ' ', '\n', '\r', ' ',
  ' ', '　', 'a', 'b c', 'é', '1', '.', '&', '<', '"', '\u{1F600}', '\0',
];

describe('inline marks', () => {
  // cowork-server's render.inline_html runs an identical copy of these cases.
  it.each(shared.cases.map((c) => [c.name, c]))('renders a shared case as the server does: %s', (_name, { text, html }) => {
    expect(serverForm(inlineToHtml(text))).toBe(html);
  });

  it('renders any text to tags that nest', () => {
    let seed = 3667;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    for (let k = 0; k < 5000; k++) {
      let text = '';
      for (let n = 1 + rand(24); n > 0; n--) text += PIECES[rand(PIECES.length)];
      expect(() => serverForm(inlineToHtml(text)), JSON.stringify(text)).not.toThrow();
    }
  });

  it.each([
    ['italic-star', '*a '.repeat(66_667)],
    ['italic-underscore', '_a '.repeat(66_667)],
    ['link-words', '['.repeat(200_000)],
    ['link-address', '[a](http://'.repeat(18_182)],
    ['chip-value', '{{date:'.repeat(28_572)],
    ['chip-spaces', `{{date:a${' '.repeat(200_000)}`],
    ['brackets-before-links', '['.repeat(100_000) + '[a](http://x)'.repeat(8_000)],
    ['brackets-before-addresses', '['.repeat(100_000) + '](http://a'.repeat(10_000)],
    ['mixed-marks', '*_'.repeat(100_000)],
    ['rule-of-3', '*a**'.repeat(50_000)],
    ['closers-before-openers', 'a* '.repeat(66_667) + ' *a'.repeat(66_667)],
  ])('renders adversarial marks in linear time (%s)', (_name, text) => {
    // Quadratic readings took 2-20 s on inputs like these.
    const start = performance.now();
    inlineToHtml(text);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('renders marks nested thousands deep in linear time', () => {
    // Each *a opens an emphasis that a later b* closes. Recursing into each
    // emphasis's words overflowed the call stack here, and re-reading them as a
    // string of their own took time proportional to length times depth.
    const start = performance.now();
    const html = inlineToHtml('*a '.repeat(50_000) + 'b* '.repeat(50_000));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(html.split('<em>').length - 1).toBe(50_000);
  });
});
