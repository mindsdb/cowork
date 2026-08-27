// Regression for ENG-2029: "cursor in Cowork is displaced — editing the task
// box is impossible" after pasting multi-line/bulleted content.
//
// The composer is a transparent <textarea> layered over a mirror overlay that
// renders the visible, syntax-tinted text (see composerHighlight.jsx). The
// native caret lives on the textarea; the glyphs the user sees are the
// overlay. For the caret to sit where the user sees it, the two boxes MUST
// wrap long lines at exactly the same points — which requires them to reserve
// the same horizontal space.
//
// The bug: the overlay hides its scrollbar (`scrollbar-width: none`, 0px) but
// the textarea used the default `auto` scrollbar. On platforms with classic,
// space-consuming scrollbars (Windows, most Linux) the textarea eats ~15-17px
// for its vertical scrollbar once content overflows the max-height, so it
// wraps earlier than the full-width overlay. Every wrap point downstream
// shifts and the caret desyncs from the visible text.
//
// happy-dom does no layout, so this can't be asserted by measuring wrap
// points. Instead we lock the source invariant that makes the two boxes wrap
// identically: BOTH the textarea and its overlay must suppress the scrollbar
// (reserve zero gutter). If a future change gives one a scrollbar without the
// other, this fails and points back here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// happy-dom's import.meta.url isn't a file: URL, so resolve from the Vitest
// root (the package dir) instead.
// Strip /* */ comments first — several composer comments mention
// "scrollbar-width: none" in prose, which would let the assertions pass off
// a comment instead of a real declaration.
const css = readFileSync(resolve(process.cwd(), 'src/renderer/cowork/styles/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Return the body of the declaration block for `selector` — the exact rule
 *  whose selector is `<selector> {` (a leading boundary avoids matching a
 *  longer selector like `.composer-textarea-overlay` for `.composer-textarea`,
 *  and requiring the `{` avoids matching mentions in comments). */
function ruleBody(selector) {
  const needle = `${selector} {`;
  let from = 0;
  for (;;) {
    const at = css.indexOf(needle, from);
    if (at === -1) return null;
    const prev = css[at - 1];
    // Reject a longer selector ending in our text (e.g. `.foo-bar` for `.foo`).
    // A real rule boundary is preceded by whitespace, `}`, `,`, `*/`, or SOF.
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
    // The `-webkit-scrollbar { display: none }` is what actually zeroes the
    // gutter in Electron; `scrollbar-width` covers Firefox/standards. Both
    // selectors must carry it, or the two boxes diverge in Chromium.
    expect(css).toMatch(/\.composer-textarea::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.composer-textarea-overlay::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
});
