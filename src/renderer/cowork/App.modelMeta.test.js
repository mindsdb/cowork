/* App hands every model picker outside Settings (the composer, Code Mode's new
   task, project settings and runtime controls) one `modelMeta` bag. The reason
   map has to ride in it beside `modelEnabled`, or an admin-restricted model
   reads "Needs credits" with an Add credits button in those pickers while
   Settings says "Restricted".

   A source guard, like App.connectRoute.test.js: the bag is built inside a
   5000-line component that a render test reaches only through a full boot. The
   pickers' own handling of the map is pinned by the builder and component
   tests; this pins that App passes it on. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = readFileSync(resolve(__dirname, 'App.jsx'), 'utf-8');

describe("App's picker metadata", () => {
  const start = APP.indexOf('const modelMeta = useMemo(');
  const block = APP.slice(start, APP.indexOf(']);', start) + 3);

  it('is found, so the guard below is reading the real bag', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('modelEnabled: settings.modelEnabled');
  });

  it('carries the disabled-reason map beside the enabled map, and recomputes when it changes', () => {
    expect(block).toContain('modelDisabledReasons: settings.modelDisabledReasons');
    const deps = block.slice(block.lastIndexOf('['));
    expect(deps).toContain('settings.modelDisabledReasons');
  });
});
