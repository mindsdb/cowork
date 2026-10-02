// Home's prefill is held in App and handed to HomeView. HomeView drops it on
// the way out through onPrefillConsumed, which is what stops a trip away from
// Home replaying a sample over the user's edits. HomeView's own tests supply
// that prop themselves, so removing it from App leaves them green.
//
// A rendering test can't reach this cheaply: App is a 5000-line component and
// the bug needs a route change that skips newTask(). A source guard holds the
// line, in the spirit of App.connectRoute.test.jsx.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = readFileSync(resolve(__dirname, 'App.jsx'), 'utf-8');

const homeViewElement = () => {
  const start = APP.indexOf('<HomeView');
  expect(start).toBeGreaterThan(-1);
  return APP.slice(start, APP.indexOf('/>', start));
};

describe('App wires Home\'s prefill so it is consumed once', () => {
  it('passes HomeView a callback that clears the prefill it holds', () => {
    expect(homeViewElement()).toMatch(
      /onPrefillConsumed=\{\(\)\s*=>\s*setComposerPrefill\(null\)\}/
    );
  });

  it('hands HomeView the same prefill state it clears', () => {
    expect(homeViewElement()).toMatch(/prefill=\{composerPrefill\}/);
  });
});
