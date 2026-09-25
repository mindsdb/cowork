// A clamped user message must contain everything it clips. `overflow: hidden`
// skips descendants whose containing block is outside the box, and the markdown
// pipeline emits absolutely positioned visually-hidden spans (a link's "(opens
// in new window)" label, a code block's copy label). Without a containing block
// on the clamp those spans resolved against `.user-turn-inner` and kept the
// static position they'd have at the message's full height, which stretched the
// transcript's scroll extent as if the message were expanded — screens of empty
// space under the last turn. happy-dom does no layout, so lock the source
// invariant instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/renderer/cowork/styles/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the rule for exactly `<selector> {` — the `{` and leading boundary
 *  avoid matching a longer selector (`.user-turn-clamp--faded`). */
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

describe('user message clamp containment', () => {
  it('clips its overflow', () => {
    const body = ruleBody('.user-turn-clamp');
    expect(body, '.user-turn-clamp rule not found').not.toBeNull();
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it('is a containing block, so absolute descendants cannot escape the clip', () => {
    const body = ruleBody('.user-turn-clamp');
    expect(body).toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
  });

  it('still has absolutely positioned screen-reader text to contain', () => {
    // The reason the rule above exists. If .sr-only ever stops being
    // out-of-flow, the containment is merely harmless rather than load-bearing.
    const body = ruleBody('.anton-code-block-copy-label');
    expect(body, '.sr-only / copy-label rule not found').not.toBeNull();
    expect(body).toMatch(/position:\s*absolute/);
  });
});
