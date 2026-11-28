import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isDevServerNavigation, isSelfReload, normalizeExternalBrowserUrl } from './external-url';

describe('normalizeExternalBrowserUrl', () => {
  it.each([
    ['https://github.com/mindsdb/cowork/pull/1', 'https://github.com/mindsdb/cowork/pull/1'],
    ['http://127.0.0.1:4173/preview', 'http://127.0.0.1:4173/preview'],
    ['mailto:team@example.com', 'mailto:team@example.com'],
  ])('accepts browser and mail URLs', (value, expected) => {
    expect(normalizeExternalBrowserUrl(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'not a URL',
    'file:///tmp/source',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'vscode://file/tmp/source',
  ])('rejects a non-browser handler: %s', (value) => {
    expect(normalizeExternalBrowserUrl(value)).toBeNull();
  });
});

// The shell blocks renderer navigation and hands the URL to the OS browser. A
// reload comes through that same guard and is the one case it has to allow —
// silently blocking it took out the document replacement that an account
// switch, an organization switch and a sign-out all depend on, in packaged
// builds only.
describe('isSelfReload', () => {
  const PAGE = 'file:///Applications/Cowork.app/Contents/Resources/app/dist/renderer/index.html';

  it('allows a document reloading itself', () => {
    expect(isSelfReload(PAGE, PAGE)).toBe(true);
  });

  it('does not allow a navigation somewhere else on the same origin', () => {
    // Only an identical URL is a reload; a different path, query or fragment
    // is a navigation, and the guard still owns those.
    expect(isSelfReload(`${PAGE}?next=1`, PAGE)).toBe(false);
    expect(isSelfReload(`${PAGE}#section`, PAGE)).toBe(false);
    expect(isSelfReload('file:///Applications/Cowork.app/other.html', PAGE)).toBe(false);
  });

  it('does not allow an external URL', () => {
    expect(isSelfReload('https://example.com/', PAGE)).toBe(false);
  });

  it('refuses anything that is not a pair of strings, and never an empty one', () => {
    // getURL() can answer '' before a load has committed, and two empties must
    // not read as a reload and open the guard.
    expect(isSelfReload('', '')).toBe(false);
    expect(isSelfReload(undefined, PAGE)).toBe(false);
    expect(isSelfReload(PAGE, null)).toBe(false);
  });

  it('is consulted by the navigation guard before it blocks', () => {
    // Pinned mechanically, the way the renderer pins its purge/reload wiring:
    // standing up a BrowserWindow to observe a cancelled navigation is not
    // worth it, and a guard that forgot this call would look identical here
    // while being silently broken in packaged builds only.
    const source = fs.readFileSync(path.join(__dirname, 'app.ts'), 'utf-8');
    expect(source).toMatch(/isSelfReload\(url,\s*mainWindow\?\.webContents\.getURL\(\)\)/);
    const guard = source.slice(source.indexOf("on('will-navigate'"));
    expect(guard.indexOf('isSelfReload')).toBeLessThan(guard.indexOf('event.preventDefault()'));
  });
});

// An unpackaged build lets the main window navigate to Vite's dev server, so
// a dev reload works. Any other page there would run in the main window's
// top-level frame, whose fetches to the server carry the window proof.
describe('isDevServerNavigation', () => {
  it.each([
    'http://localhost:5173/',
    'http://localhost:5173/x?y',
  ])('allows Vite at %s', (url) => {
    expect(isDevServerNavigation(url, '5173')).toBe(true);
  });

  it.each([
    'http://localhost.evil.com/',
    'http://localhost.evil.com:5173/',
    'http://localhost@evil.com/',
    'http://localhost:5173@evil.com:5173/',
    'http://localhost:9999/',
    'https://localhost:5173/',
    'file:///Users/someone/index.html',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isDevServerNavigation(url, '5173')).toBe(false);
  });

  it('refuses everything when the renderer is not served from Vite', () => {
    expect(isDevServerNavigation('http://localhost:5173/', null)).toBe(false);
  });

  it('is what the navigation guard checks, with the port the window loads Vite from', () => {
    const source = fs.readFileSync(path.join(__dirname, 'app.ts'), 'utf-8');
    const guard = source.slice(source.indexOf("on('will-navigate'"));
    expect(guard).toMatch(/!packagedRun && isDevServerNavigation\(url, viteDevPort\)\) return;/);
    expect(guard).not.toContain("startsWith('http://localhost')");
  });
});
