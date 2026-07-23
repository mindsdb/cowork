import { describe, it, expect } from 'vitest';
import {
  domSnapshotScript,
  domClickScript,
  domTypeScript,
  domReadScript,
  domScrollScript,
  DEFAULT_SNAPSHOT_MAX_ELS,
  MAX_SNAPSHOT_MAX_ELS,
  DEFAULT_READ_MAX_CHARS,
  SNAPSHOT_SCAN_LIMIT,
} from './browser-dom-tools';

// The scripts run inside the tab (no Node) so they can only be smoke-tested
// here as STRINGS: params must be inlined safely (numbers clamped, text
// JSON-escaped) and the element-stash contract between snapshot and
// click/type must hold.

describe('dom tools script builders', () => {
  it('snapshot script selects interactive elements and stashes refs by index', () => {
    const script = domSnapshotScript();
    expect(script).toContain('__coworkBrowserEls');
    expect(script).toContain('a,button,input,textarea,select,[role],[onclick],summary');
    expect(script).toContain(`const MAX = ${DEFAULT_SNAPSHOT_MAX_ELS};`);
    expect(script).toContain('getBoundingClientRect');
  });

  it('snapshot script caps scanned nodes and returns an incrementing version', () => {
    const script = domSnapshotScript();
    expect(script).toContain(`const SCAN_MAX = ${SNAPSHOT_SCAN_LIMIT};`);
    expect(script).toContain('scanned >= SCAN_MAX');
    // Stash carries { v, els }; the snapshot reports v back to the caller.
    expect(script).toContain('const v = prev + 1;');
    expect(script).toContain('= { v: v, els: refs };');
    expect(script).toContain('v: v, elements: els');
  });

  it('domSnapshotScript clamps maxEls into [1, 400]', () => {
    expect(domSnapshotScript(10)).toContain('const MAX = 10;');
    expect(domSnapshotScript(0)).toContain('const MAX = 1;');
    expect(domSnapshotScript(99999)).toContain(`const MAX = ${MAX_SNAPSHOT_MAX_ELS};`);
    expect(domSnapshotScript(Number.NaN)).toContain('const MAX = 1;');
    expect(domSnapshotScript(7.9)).toContain('const MAX = 7;');
  });

  it('snapshot walks incrementally and never serializes password values', () => {
    const script = domSnapshotScript();
    // Incremental traversal — no full NodeList allocation on hostile pages.
    expect(script).toContain('document.createTreeWalker');
    expect(script).not.toContain("querySelectorAll('a,button,input");
    // Password inputs keep their secret out of the snapshot text.
    expect(script).toContain("el.type === 'password'");
    expect(script).toContain("(isPassword ? '' : el.value)");
  });

  it('domClickScript looks the element up by clamped index and clicks', () => {
    const script = domClickScript(3);
    expect(script).toContain('els[3]');
    expect(script).toContain("scrollIntoView({ block: 'center' })");
    expect(script).toContain('el.click()');
    expect(domClickScript(-2)).toContain('els[0]');
  });

  it('click/type refuse detached elements and honor the snapshot version', () => {
    // Detached elements are not-found, whatever the version situation.
    expect(domClickScript(0)).toContain('if (!el || !el.isConnected) return false;');
    // No v provided → no version check (backward compatible).
    expect(domClickScript(0)).toContain('const expected = null;');
    // v provided → mismatch returns 'stale' (bridge maps to 409).
    const versioned = domClickScript(0, 7);
    expect(versioned).toContain('const expected = 7;');
    expect(versioned).toContain("if (expected !== null && (!stash || stash.v !== expected)) return 'stale';");
    const typed = domTypeScript(1, 'x', false, 3);
    expect(typed).toContain('const expected = 3;');
    expect(typed).toContain("return 'stale';");
  });

  it('a custom stash name is threaded into all stash-touching scripts', () => {
    const stash = '__coworkEls_ab12cd34';
    expect(domSnapshotScript(undefined, stash)).toContain(`window["${stash}"]`);
    expect(domClickScript(0, undefined, stash)).toContain(`window["${stash}"]`);
    expect(domTypeScript(0, 'x', false, undefined, stash)).toContain(`window["${stash}"]`);
    // The read/scroll scripts never touch the stash.
    expect(domReadScript()).not.toContain(stash);
    expect(domScrollScript('down')).not.toContain(stash);
  });

  it('domTypeScript uses the native value setter and JSON-escapes the text', () => {
    const script = domTypeScript(2, 'he said "hi"\n<script>', true);
    expect(script).toContain('els[2]');
    expect(script).toContain(JSON.stringify('he said "hi"\n<script>'));
    expect(script).toContain("Object.getOwnPropertyDescriptor(proto, 'value')");
    expect(script).toContain("new Event('input', { bubbles: true })");
    expect(script).toContain('requestSubmit');
    // submit flag is inlined into the guard around the Enter/submit block
    expect(domTypeScript(0, 'x', false)).toContain('if (false)');
    expect(domTypeScript(0, 'x', true)).toContain('if (true)');
  });

  it('domReadScript strips chrome, prefers article/main, caps chars', () => {
    const script = domReadScript();
    expect(script).toContain(`const MAX = ${DEFAULT_READ_MAX_CHARS};`);
    expect(script).toContain('script,style,noscript,nav,footer,aside,header,form,iframe');
    expect(script).toContain("querySelector('article') || clone.querySelector('main')");
    expect(domReadScript(500)).toContain('const MAX = 500;');
    expect(domReadScript(0)).toContain('const MAX = 1;');
  });

  it('domScrollScript validates direction and defaults the amount to viewport-ish', () => {
    expect(domScrollScript('up', 300)).toContain('"up"');
    expect(domScrollScript('up', 300)).toContain('const amount = 300');
    expect(domScrollScript('down')).toContain('window.innerHeight * 0.8');
    expect(domScrollScript('top')).toContain('window.scrollTo(0, 0)');
    expect(domScrollScript('bottom')).toContain('scrollHeight');
    expect(domScrollScript('sideways')).toContain('"down"'); // invalid → down
    expect(domScrollScript('down', -50)).toContain('const amount = 0');
  });
});
