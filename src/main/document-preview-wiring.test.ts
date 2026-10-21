import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';

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
   * The seams are the window's preferences, the guard's registration and one
   * call inside the token listener, the way mindshubFinalizeBridge.test.ts pins
   * its handler. The Electron spec runs the guard and the rule for real.
   */
  const source = readFileSync(resolve(__dirname, 'app.ts'), 'utf-8');
  const start = source.indexOf('function createWindow()');
  const createWindow = source.slice(start, source.indexOf('\n}\n', start));
  const listenerStart = createWindow.indexOf('webRequest.onBeforeSendHeaders(');
  const listener = createWindow.slice(listenerStart, createWindow.indexOf('gateMindsResponseCreationRequest(', listenerStart));

  it('builds the main window from mainWindowWebPreferences', () => {
    expect(createWindow).toContain('webPreferences: mainWindowWebPreferences(getServerPort())');
  });

  it('registers the guard on the main window before the window loads anything', () => {
    const registered = createWindow.indexOf('guardDocumentPreviewFrames(mainWindow.webContents)');
    expect(registered).toBeGreaterThan(-1);
    for (const load of ['mainWindow.loadURL(', 'mainWindow.loadFile(']) {
      expect(createWindow.indexOf(load)).toBeGreaterThan(registered);
    }
  });

  it('asks the guard inside the token listener, before the Minds gate can defer the request', () => {
    expect(listenerStart).toBeGreaterThan(-1);
    expect(listener).toContain('previewGuard.mayCarryServerToken(details.frame)');
    expect(listener).toContain('tokenAllowed ? getServerAuthToken() : null');
  });
});
