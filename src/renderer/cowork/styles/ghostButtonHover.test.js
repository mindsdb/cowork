// Ghost buttons (`<Button variant="subtle">`, the composer `.meta-pill`
// pickers) are borderless in every state: hover and press lift the fill and
// ink only. The base `.btn:hover` / `.btn:active` draw a 1px ring via
// box-shadow, so the subtle variant must cancel it explicitly. happy-dom does
// no layout or cascade, so we lock the source invariant instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Strip comments so a prose mention of a property can't satisfy a match.
const css = readFileSync(resolve(process.cwd(), 'src/renderer/cowork/styles/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the rule for exactly `<selector> {`. */
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

describe('ghost buttons stay borderless on hover', () => {
  it.each(['.btn.subtle:hover', '.btn.subtle:active'])('%s cancels the base ring', (selector) => {
    const body = ruleBody(selector);
    expect(body, `${selector} rule not found`).not.toBeNull();
    expect(body).toMatch(/box-shadow:\s*none/);
    expect(body).not.toMatch(/border-color/);
  });

  it.each(['.btn.subtle:hover', 'button.meta-pill:hover'])('%s uses the shared ghost fill', (selector) => {
    expect(ruleBody(selector)).toMatch(/background:\s*var\(--ghost-hover\)/);
  });

  it('.meta-pill hover does not gain a border', () => {
    const body = ruleBody('button.meta-pill:hover');
    expect(body, 'button.meta-pill:hover rule not found').not.toBeNull();
    expect(body).not.toMatch(/border/);
  });
});
