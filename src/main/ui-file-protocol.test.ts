import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { ServedSlotChange, ServedUiFileRead } from './ui-updater';

/* The UI updater the registered handler reads through. The pure functions below take their
   access as an argument; only registerUiFileProtocol reads this. */
const updater = vi.hoisted(() => ({
  cacheDir: '',
  servedRoot: null as string | null,
  read: { ok: false, reason: 'not-serving' } as ServedUiFileRead,
  refused: [] as string[],
}));

vi.mock('./ui-updater', () => ({
  getCacheDir: () => updater.cacheDir,
  servedUiRoot: () => updater.servedRoot,
  readServedUiFile: () => updater.read,
  refuseServedUiSlot: (reason: ServedSlotChange) => { updater.refused.push(reason); },
}));

import {
  answerFileRequest,
  registerUiFileProtocol,
  relativeInside,
  routeFileRequest,
  slotChangedOnDisk,
  type UiCacheAccess,
  type UiCacheView,
} from './ui-file-protocol';

/* Absolute on every platform: `/ui-cache` on POSIX, `<drive>:\ui-cache` on Windows. */
const cacheDir = path.resolve(path.sep, 'ui-cache');
const currentDir = path.join(cacheDir, 'current');
const servedView: UiCacheView = { cacheDir, servedRoot: currentDir };
const bundledView: UiCacheView = { cacheDir, servedRoot: null };

function fileUrl(...segments: string[]): string {
  return pathToFileURL(path.join(...segments)).href;
}

function get(url: string): { method: string; url: string } {
  return { method: 'GET', url };
}

/* A fake UI updater: `read` answers every read, and the test inspects what it was asked. */
function fakeAccess(view: UiCacheView, read: ServedUiFileRead) {
  const reads: string[] = [];
  const refused: ServedSlotChange[] = [];
  const access: UiCacheAccess = {
    view: () => view,
    readServedFile: (relativePath) => { reads.push(relativePath); return read; },
    refuseServedSlot: (reason) => { refused.push(reason); },
  };
  return { access, reads, refused };
}

const unreachable = vi.fn(async (): Promise<Response> => { throw new Error('passed through'); });

beforeEach(() => {
  unreachable.mockClear();
  updater.cacheDir = cacheDir;
  updater.servedRoot = null;
  updater.read = { ok: false, reason: 'not-serving' };
  updater.refused = [];
});

describe('relativeInside', () => {
  it('maps a path inside the root to a /-separated relative path', () => {
    expect(relativeInside('/a/ui-cache', '/a/ui-cache/current/assets/app.js', path.posix)).toBe('current/assets/app.js');
    expect(relativeInside('/a/ui-cache', '/a/ui-cache', path.posix)).toBe('');
  });

  it('maps a Windows path with / separators', () => {
    const root = 'C:\\Users\\a\\AppData\\Roaming\\anton\\ui-cache';
    expect(relativeInside(root, `${root}\\current\\assets\\app.js`, path.win32)).toBe('current/assets/app.js');
  });

  it('reads Windows folder names without regard to case, as the file system does', () => {
    expect(relativeInside('C:\\Users\\a\\ui-cache', 'c:\\users\\A\\UI-CACHE\\current\\index.html', path.win32)).toBe('current/index.html');
  });

  it('finds no path for a sibling folder, a parent, or another drive', () => {
    expect(relativeInside('/a/ui-cache', '/a/ui-cache-other/current/index.html', path.posix)).toBeNull();
    expect(relativeInside('/a/ui-cache', '/a/rejected.json', path.posix)).toBeNull();
    expect(relativeInside('/a/ui-cache', '/a', path.posix)).toBeNull();
    expect(relativeInside('C:\\ui-cache', 'D:\\ui-cache\\current\\index.html', path.win32)).toBeNull();
  });

  it('keeps a name that only starts with two dots inside the root', () => {
    expect(relativeInside('/a/ui-cache', '/a/ui-cache/current/..app.js', path.posix)).toBe('current/..app.js');
  });
});

describe('routeFileRequest', () => {
  it('serves a GET of a file in the served slot, by its path relative to the slot', () => {
    expect(routeFileRequest(get(fileUrl(currentDir, 'assets', 'app.js')), servedView)).toEqual({ kind: 'served-file', relativePath: 'assets/app.js' });
    expect(routeFileRequest(get(fileUrl(currentDir, 'index.html')), servedView)).toEqual({ kind: 'served-file', relativePath: 'index.html' });
  });

  it('ignores the query and the fragment', () => {
    const url = `${fileUrl(currentDir, 'assets', 'app.js')}?v=2#section`;
    expect(routeFileRequest(get(url), servedView)).toEqual({ kind: 'served-file', relativePath: 'assets/app.js' });
  });

  it('passes every path outside the cache through, the bundled renderer among them', () => {
    const bundled = fileUrl(path.resolve(path.sep, 'Applications', 'Cowork.app', 'Contents', 'Resources', 'app.asar'), 'dist', 'renderer', 'index.html');
    expect(routeFileRequest(get(bundled), servedView)).toEqual({ kind: 'pass-through' });
    expect(routeFileRequest(get(bundled), bundledView)).toEqual({ kind: 'pass-through' });
    expect(routeFileRequest(get(fileUrl(`${cacheDir}-other`, 'current', 'index.html')), servedView)).toEqual({ kind: 'pass-through' });
    expect(routeFileRequest({ method: 'POST', url: bundled }, servedView)).toEqual({ kind: 'pass-through' });
  });

  it('refuses the rest of the cache: the other slots, the cache files, and the slot itself while bundled runs', () => {
    for (const url of [
      fileUrl(cacheDir, 'staging', 'index.html'),
      fileUrl(cacheDir, 'previous', 'assets', 'app.js'),
      fileUrl(cacheDir, 'rejected.json'),
      fileUrl(cacheDir),
    ]) {
      expect(routeFileRequest(get(url), servedView)).toEqual({ kind: 'not-found' });
    }
    expect(routeFileRequest(get(fileUrl(currentDir, 'index.html')), bundledView)).toEqual({ kind: 'not-found' });
  });

  it('refuses any method but GET inside the cache', () => {
    for (const method of ['HEAD', 'POST', 'PUT']) {
      expect(routeFileRequest({ method, url: fileUrl(currentDir, 'index.html') }, servedView)).toEqual({ kind: 'not-found' });
    }
  });

  it('refuses a URL whose path cannot be read, such as one with an encoded slash', () => {
    const url = fileUrl(currentDir, 'assets').concat('%2Fapp.js');
    expect(routeFileRequest(get(url), servedView)).toEqual({ kind: 'not-found' });
  });

  it('keeps a differently spelled cache URL inside the cache where the volume ignores case, and finds no served file for it', () => {
    const upper = fileUrl(currentDir.toUpperCase(), 'index.html');
    expect(routeFileRequest(get(upper), servedView, path, fileURLToPath, true)).toEqual({ kind: 'not-found' });
    expect(routeFileRequest(get(fileUrl(currentDir, 'INDEX.HTML')), servedView, path, fileURLToPath, true))
      .toEqual({ kind: 'served-file', relativePath: 'INDEX.HTML' });
    expect(routeFileRequest(get(upper), servedView, path, fileURLToPath, false)).toEqual({ kind: 'pass-through' });
  });

  it('maps a Windows request with / separators', () => {
    const root = 'C:\\Users\\a\\AppData\\Roaming\\anton\\ui-cache';
    const view: UiCacheView = { cacheDir: root, servedRoot: `${root}\\current` };
    const toPath = () => `${root}\\current\\assets\\chunks\\xterm.js`;
    expect(routeFileRequest(get('file:///C:/Users/a/AppData/Roaming/anton/ui-cache/current/assets/chunks/xterm.js'), view, path.win32, toPath))
      .toEqual({ kind: 'served-file', relativePath: 'assets/chunks/xterm.js' });
  });
});

describe('slotChangedOnDisk', () => {
  it('names the refusals that mean a file of the served slot changed after the check', () => {
    expect(slotChangedOnDisk('hash-mismatch')).toBe(true);
    expect(slotChangedOnDisk('non-regular-entry')).toBe(true);
    expect(slotChangedOnDisk('missing-file')).toBe(true);
  });

  it('leaves out a file the bundle does not have, a path that is not safe, a read error, and a bundled load', () => {
    expect(slotChangedOnDisk('not-in-manifest')).toBe(false);
    expect(slotChangedOnDisk('unsafe-path')).toBe(false);
    expect(slotChangedOnDisk('unreadable')).toBe(false);
    expect(slotChangedOnDisk('not-serving')).toBe(false);
  });
});

describe('answerFileRequest', () => {
  it('answers a served file with its bytes and the content type of its extension', async () => {
    const { access, reads, refused } = fakeAccess(servedView, { ok: true, bytes: Buffer.from('export const x = 1;') });
    const response = await answerFileRequest(new Request(fileUrl(currentDir, 'assets', 'app.js')), access, unreachable);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript');
    expect(await response.text()).toBe('export const x = 1;');
    expect(reads).toEqual(['assets/app.js']);
    expect(refused).toEqual([]);
  });

  it('answers 404 to a file whose bytes changed, and refuses the slot', async () => {
    const { access, refused } = fakeAccess(servedView, { ok: false, reason: 'hash-mismatch' });
    const response = await answerFileRequest(new Request(fileUrl(currentDir, 'assets', 'xterm.js')), access, unreachable);
    expect(response.status).toBe(404);
    expect(refused).toEqual(['hash-mismatch']);
  });

  it('answers 404 to a file the manifest does not list, and keeps the slot', async () => {
    const { access, refused } = fakeAccess(servedView, { ok: false, reason: 'not-in-manifest' });
    const response = await answerFileRequest(new Request(fileUrl(currentDir, 'favicon.ico')), access, unreachable);
    expect(response.status).toBe(404);
    expect(refused).toEqual([]);
  });

  it('answers 404 to an unreadable file or an unsafe path, and keeps the slot', async () => {
    for (const reason of ['unreadable', 'unsafe-path'] as const) {
      const { access, refused } = fakeAccess(servedView, { ok: false, reason });
      const response = await answerFileRequest(new Request(fileUrl(currentDir, 'index.html')), access, unreachable);
      expect(response.status).toBe(404);
      expect(refused).toEqual([]);
    }
  });

  it('answers 404 inside the cache while the bundled renderer is loaded, without reading', async () => {
    const { access, reads } = fakeAccess(bundledView, { ok: true, bytes: Buffer.from('stale') });
    const response = await answerFileRequest(new Request(fileUrl(currentDir, 'index.html')), access, unreachable);
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('passes a request outside the cache on unchanged', async () => {
    const { access, reads } = fakeAccess(servedView, { ok: true, bytes: Buffer.from('cached') });
    const request = new Request(fileUrl(path.resolve(path.sep, 'opt', 'cowork', 'resources', 'app.asar'), 'dist', 'renderer', 'index.html'));
    const passed = new Response('bundled');
    const passThrough = vi.fn(async () => passed);
    await expect(answerFileRequest(request, access, passThrough)).resolves.toBe(passed);
    expect(passThrough).toHaveBeenCalledExactlyOnceWith(request);
    expect(reads).toEqual([]);
  });
});

describe('registerUiFileProtocol', () => {
  function fakeSession() {
    const handlers = new Map<string, (request: Request) => Response | Promise<Response>>();
    const fetch = vi.fn(async () => new Response('from electron'));
    return {
      handlers,
      fetch,
      session: { protocol: { handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) => { handlers.set(scheme, handler); } }, fetch },
    };
  }

  it('handles file:// on the session, reading through the UI updater', async () => {
    const fake = fakeSession();
    registerUiFileProtocol(fake.session as unknown as Parameters<typeof registerUiFileProtocol>[0]);
    const handler = fake.handlers.get('file');
    expect(handler).toBeDefined();

    updater.servedRoot = currentDir;
    updater.read = { ok: true, bytes: Buffer.from('<html></html>') };
    const served = await handler!(new Request(fileUrl(currentDir, 'index.html')));
    expect(await served.text()).toBe('<html></html>');
    expect(served.headers.get('content-type')).toBe('text/html');

    updater.read = { ok: false, reason: 'missing-file' };
    expect((await handler!(new Request(fileUrl(currentDir, 'assets', 'mermaid.js')))).status).toBe(404);
    expect(updater.refused).toEqual(['missing-file']);
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it("passes a path outside the cache to Electron's own handler through the same session", async () => {
    const fake = fakeSession();
    registerUiFileProtocol(fake.session as unknown as Parameters<typeof registerUiFileProtocol>[0]);
    const request = new Request(fileUrl(path.resolve(path.sep, 'tmp'), 'page.html'));
    const response = await fake.handlers.get('file')!(request);
    expect(await response.text()).toBe('from electron');
    expect(fake.fetch).toHaveBeenCalledExactlyOnceWith(request, { bypassCustomProtocolHandlers: true });
  });
});
