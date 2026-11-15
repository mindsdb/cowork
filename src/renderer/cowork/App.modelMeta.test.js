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

// ENG-4147: one throttled availability re-check, merged into current settings, feeding the triggers.
describe("App's model availability re-check", () => {
  const start = APP.indexOf('createAvailabilityRefresher({');
  const block = APP.slice(start, APP.indexOf('const modelMeta = useMemo(', start));

  it('is built once from the shared refresher, fetching with refresh and the requested scope', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('fetchRecommendedModels({ refresh: true, scope })');
  });

  it('merges inside the setSettings updater and skips a no-op merge', () => {
    expect(block).toMatch(/setSettings\(\(prev\) => \{\s*const merged = mergeRecommendedModels\(prev, data/);
    expect(block).toContain('!mergeChangesNothing(prev, merged)');
  });

  it("gives pickers the 'all' scope and the triggers the 'minds' scope", () => {
    expect(block).toContain('refresh(REFRESH_SCOPE.all)');
    expect(block).toContain('refresh(REFRESH_SCOPE.minds)');
    const meta = APP.slice(APP.indexOf('const modelMeta = useMemo('));
    expect(meta).toContain('onRefresh: refreshModelAvailability');
  });

  it('feeds the triggers the credit-lock refresh and the reason map', () => {
    const hook = APP.slice(APP.indexOf('useModelAvailabilityTriggers({'), APP.indexOf('});', APP.indexOf('useModelAvailabilityTriggers({')));
    expect(hook).toContain('refresh: refreshCreditLocks');
    expect(hook).toContain('modelDisabledReasons: settings.modelDisabledReasons');
    expect(hook).toContain('usage: hubUsage');
    expect(hook).toContain("mindsIds: settings.recommendedModels?.['minds-cloud']");
    expect(hook).toContain('canNarrowRefresh: () => serverHonorsRefreshScope(REFRESH_SCOPE.minds)');
  });
});
