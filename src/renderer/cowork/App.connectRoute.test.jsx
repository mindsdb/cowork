// Keep Cloud's Connect Apps and Data route reachable.
// Check the navigation closure in source so a staging-only Coming soon intercept cannot remove the
// production feature.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = readFileSync(resolve(__dirname, 'App.jsx'), 'utf-8');

describe('the connect route on Cloud', () => {
  it('is not intercepted by the coming-soon modal in org mode', () => {
    // Any `setComingSoonFeature` reachable from a `key === 'customize'` test.
    const gated = APP.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) =>
        /key\s*===\s*'customize'/.test(line) && /orgMode/.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);

    expect(gated).toEqual([]);
  });

  it('never names the connect page as a coming-soon feature', () => {
    // The modal itself stays — desktop-only connector tiles use it. What must
    // not come back is naming the whole page as unavailable.
    expect(APP).not.toMatch(/setComingSoonFeature\(\s*'Connect Apps and Data'/);
  });
});
