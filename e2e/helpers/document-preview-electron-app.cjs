/*
 * Isolated Electron host for e2e/document-preview-electron.spec.ts. It opens
 * one window with the main window's own webPreferences and preload, registers
 * the production document preview guard, and adds the server token to
 * loopback requests the way app.ts's onBeforeSendHeaders listener does. The
 * listener here copies only the direct-port branch, with no Minds gate and no
 * Vite dev proxy; src/main/document-preview-wiring.test.ts pins how app.ts's
 * own listener asks the guard. No backend, credentials, onboarding or access
 * to the user's normal app profile. Needs `npm run build` first, for dist/main.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { guardDocumentPreviewFrames } = require('../../dist/main/main/document-preview-guard.js');
const { mainWindowWebPreferences } = require('../../dist/main/main/main-window-preferences.js');
const { IPC } = require('../../dist/main/shared/ipc-channels.js');

const serverPort = process.env.PREVIEW_HOST_SERVER_PORT;
const token = process.env.PREVIEW_HOST_TOKEN;

/* What the spec reads back through electronApp.evaluate (HostRecord in document-preview-electron.ts). */
globalThis.previewHost = { navigations: [], openedExternally: [], windowsCreated: 0, framesCreated: [], listenerCalls: [] };

/* Stands in for the OS browser, so the spec sees anything sent there. */
const recordExternalOpen = async (url) => { globalThis.previewHost.openedExternally.push(url); };
shell.openExternal = recordExternalOpen;
if (shell.openExternal !== recordExternalOpen) throw new Error('shell.openExternal could not be replaced');

app.setPath('userData', process.env.PREVIEW_HOST_PROFILE);
app.on('browser-window-created', () => { globalThis.previewHost.windowsCreated += 1; });

/* The preload reads the signed-in account synchronously when it loads. */
ipcMain.on(IPC.ACCOUNT_SIGNED_IN_SYNC, (event) => {
  event.returnValue = { accountId: null, legacyState: 'keep', organizationId: null };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 760, webPreferences: mainWindowWebPreferences(Number(serverPort)) });
  const guard = guardDocumentPreviewFrames(win.webContents);

  /* Registered after the guard, so each sees what the guard saw or decided. */
  win.webContents.on('frame-created', (_event, { frame }) => {
    let name = null;
    try { name = frame ? frame.name : null; } catch { /* a disposed frame stays null */ }
    globalThis.previewHost.framesCreated.push(name);
  });
  win.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) globalThis.previewHost.navigations.push({ url: event.url, cancelled: event.defaultPrevented });
  });

  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*', 'http://localhost/*'] },
    (details, callback) => {
      const { frame } = details;
      const tokenAllowed = guard.mayCarryServerToken(frame);
      const url = new URL(details.url);
      globalThis.previewHost.listenerCalls.push({ path: url.pathname, hadFrame: Boolean(frame) });
      if (tokenAllowed && url.port === serverPort) {
        details.requestHeaders.Authorization = `Bearer ${token}`;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  /* A download's request is already out when this fires; cancelling it keeps a save dialog from opening. */
  win.webContents.session.on('will-download', (_event, item) => item.cancel());

  await win.loadFile(path.join(__dirname, 'document-preview-electron.html'));
});
app.on('window-all-closed', () => app.quit());
