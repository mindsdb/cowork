// Connect Apps and Data must stay reachable on Cloud.
//
// The route has been gated behind a "Coming soon to Cloud" modal twice —
// da5c1d99 (Cloud MVP) and again 25f6f952 (Dev code mode) — both times on
// staging only. Production ships from main, which carries neither, so Cloud
// users there connect Gmail and the other OAuth connectors normally; the next
// staging→main release would have removed a working feature.
//
// A rendering test can't reach this: the intercept lives in a closure inside a
// 5000-line component, behind org-mode state and a sidebar click. A source
// guard is what actually holds the line, in the spirit of
// projectLabelSurfaces.test.js.

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
