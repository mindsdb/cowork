// The transparent textarea and mirror must wrap identically to align the caret. happy-dom has no
// layout, so assert both suppress the scrollbar in source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// happy-dom's import.meta.url isn't a file: URL, so resolve from the Vitest
// root. Strip comments so a prose mention of a property can't satisfy a match.
const css = readFileSync(resolve(process.cwd(), 'src/renderer/cowork/styles/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the rule for exactly `<selector> {` — the `{` and leading boundary
 *  avoid matching a longer selector (`.composer-textarea-overlay`). */
function ruleBody(selector) {
  const needle = `${selector} {`;
  let from = 0;
  for (;;) {
    const at = css.indexOf(needle, from);
    if (at === -1) return null;
    const prev = css[at - 1];
    if (at === 0 || /[\s}*,]/.test(prev)) {
      const open = at + needle.length - 1;
      const close = css.indexOf('}', open);
      return close === -1 ? null : css.slice(open + 1, close);
    }
    from = at + needle.length;
  }
}

describe('composer overlay alignment (ENG-2029)', () => {
  it('the textarea suppresses its scrollbar so it reserves zero gutter', () => {
    const body = ruleBody('.composer-textarea');
    expect(body, '.composer-textarea rule not found').not.toBeNull();
    expect(body).toMatch(/scrollbar-width:\s*none/);
  });

  it('the overlay suppresses its scrollbar (unchanged half of the invariant)', () => {
    const body = ruleBody('.composer-textarea-overlay');
    expect(body, '.composer-textarea-overlay rule not found').not.toBeNull();
    expect(body).toMatch(/scrollbar-width:\s*none/);
  });

  it('both boxes hide the WebKit/Blink scrollbar (Electron is Chromium)', () => {
    // ::-webkit-scrollbar { display: none } is what zeroes the gutter in Electron.
    expect(css).toMatch(/\.composer-textarea::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.composer-textarea-overlay::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
});
