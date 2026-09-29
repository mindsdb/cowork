import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '../../../../tailwind.config.js';

describe('theme-aware typography', () => {
  it('compiles font utilities to the same theme tokens used by the app', async () => {
    const { root } = await postcss([tailwind({
      ...config,
      content: [{ raw: '<p class="font-body text-body"><span class="font-display"></span><code class="font-mono"></code></p>' }],
    })]).process('@tailwind utilities;', { from: undefined });
    const families = {};
    root.walkRules(rule => {
      rule.walkDecls('font-family', declaration => { families[rule.selector] = declaration.value; });
    });
    expect(families).toEqual({
      '.font-body': 'var(--font-body)',
      '.font-display': 'var(--font-display)',
      '.font-mono': 'var(--font-mono)',
    });
    // Keep the established conversation size; the mismatch was the font,
    // not a reason to adopt an editor's type scale for chat.
    expect(root.toString()).toContain('font-size: 14.5px');
  });
});
