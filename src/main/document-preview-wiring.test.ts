import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';

import { ipcRenderer } from 'electron';
import type { InAppBrowserBridge } from '../shared/browser-contract';
import { IPC } from '../shared/ipc-channels';
import { mainWindowWebPreferences } from './main-window-preferences';

const exposed = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, unknown>) => { exposed.current = api; },
  },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn(), sendSync: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}));

describe('the preload flag', () => {
  it('reports supportsDocumentPreview as literal true on a shell with the guard', async () => {
    vi.resetModules();
    await import('./preload');
    expect(exposed.current?.supportsDocumentPreview).toBe(true);
  });
});

describe('the in-app browser in the preload', () => {
  it.each([
    ['39.8.10', false],
    ['43.2.0', false],
    ['44.0.0', true],
    ['45.2.3', true],
    [undefined, false],
  ])('on Electron %s exposes the pane: %s', async (version, supported) => {
    const { inAppBrowserExposure } = await import('./preload');
    const browser = {} as InAppBrowserBridge;
    expect(inAppBrowserExposure(version, browser)).toEqual({ supportsInAppBrowser: supported, browser: supported ? browser : undefined });
  });

  it("exposes the pane by this shell's own Electron version", async () => {
    // Node runs the tests, so there is no Electron version: below the floor.
    vi.resetModules();
    await import('./preload');
    expect(exposed.current?.supportsInAppBrowser).toBe(false);
    expect(exposed.current?.browser).toBeUndefined();
    Object.defineProperty(process.versions, 'electron', { value: '45.2.3', configurable: true });
    try {
      vi.resetModules();
      await import('./preload');
      expect(exposed.current?.supportsInAppBrowser).toBe(true);
      expect(exposed.current?.browser).toMatchObject({ ready: expect.any(Function), clearData: expect.any(Function) });
    } finally {
      delete (process.versions as Record<string, unknown>).electron;
    }
  });
});

describe('the in-app browser registration in the preload', () => {
  it('hands the renderer each registration main reports, until it stops listening', async () => {
    vi.resetModules();
    await import('./preload');
    const onBrowserRegistered = exposed.current?.onBrowserRegistered as (cb: () => void) => () => void;
    const cb = vi.fn();
    const stop = onBrowserRegistered(cb);
    const [channel, listener] = (ipcRenderer.on as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(channel).toBe(IPC.BROWSER_REGISTERED);
    (listener as () => void)();
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.BROWSER_REGISTERED, listener);
  });
});

describe('mainWindowWebPreferences', () => {
  it('hands the renderer the server port and the preload beside it', () => {
    const preferences = mainWindowWebPreferences(43210);
    expect(preferences.additionalArguments).toEqual(['--cowork-server-port=43210']);
    expect(preferences.preload).toBe(resolve(__dirname, 'preload.js'));
  });
});

describe('the main window wiring in app.ts', () => {
  /*
   * Read from source rather than run: app.ts registers the whole app at import.
   * The seams are the window's preferences, the guard's registration and the
   * token listener app.ts registers, the way mindshubFinalizeBridge.test.ts
   * pins its handler. A slice whose anchors go missing is empty, so the checks
   * on it fail instead of reading a wider text. server-token-listener.test.ts
   * runs the listener, and the Electron spec runs it with the guard for real.
   */
  const source = readFileSync(resolve(__dirname, 'app.ts'), 'utf-8');
  const start = source.indexOf('function createWindow()');
  const end = start < 0 ? -1 : source.indexOf('\n}\n', start);
  const createWindow = end > start ? source.slice(start, end) : '';
  const listenerStart = createWindow.indexOf('webRequest.onBeforeSendHeaders(');
  const firstLoad = listenerStart < 0 ? -1 : createWindow.indexOf('mainWindow.loadURL(', listenerStart);
  const listener = firstLoad > listenerStart ? createWindow.slice(listenerStart, firstLoad) : '';

  it('locates createWindow, the token listener and the first load after it, so the checks below are not vacuous', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(listenerStart).toBeGreaterThan(-1);
    expect(firstLoad).toBeGreaterThan(listenerStart);
  });

  it('builds the main window from mainWindowWebPreferences', () => {
    expect(createWindow).toContain('webPreferences: mainWindowWebPreferences(getServerPort())');
  });

  it('registers the guard on the main window before the window loads anything', () => {
    /* The whole declaration, so the listener's `guard: previewGuard` below is the real guard. */
    const registered = createWindow.indexOf('const previewGuard = guardDocumentPreviewFrames(mainWindow.webContents);');
    expect(registered).toBeGreaterThan(-1);
    for (const load of ['mainWindow.loadURL(', 'mainWindow.loadFile(']) {
      expect(createWindow.indexOf(load)).toBeGreaterThan(registered);
    }
  });

  it('registers serverTokenListener with the guard and the per-request port and token getters', () => {
    for (const dep of ['serverTokenListener({', 'guard: previewGuard,', 'serverPort: getServerPort,', 'token: getServerAuthToken,', 'viteDevPort,']) {
      expect(listener).toContain(dep);
    }
  });

  it('leaves the frame to the listener and hands the Minds gate\'s answer back to it', () => {
    expect(listener).not.toContain('.frame');
    expect(listener).toContain('gateMindsResponseCreationRequest(');
    expect(listener).toContain('settle(ready);');
  });
});
