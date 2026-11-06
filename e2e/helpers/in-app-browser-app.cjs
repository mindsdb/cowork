/*
 * Isolated Electron host for e2e/in-app-browser.spec.ts. It opens one window
 * with the main window's own webPreferences and preload, and runs the real
 * in-app browser host from dist/main on a throwaway profile. There is no local
 * server, so nothing is registered; the spec reads the bridge's address and
 * key from `globalThis.inAppBrowserE2e` through electronApp.evaluate. Needs
 * `npm run build` first, for dist/main.
 */
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const { InAppBrowserHost } = require('../../dist/main/main/browser-host.js');
const { mainWindowWebPreferences } = require('../../dist/main/main/main-window-preferences.js');
const { IPC } = require('../../dist/main/shared/ipc-channels.js');

const profile = process.env.IN_APP_BROWSER_PROFILE;
app.setPath('userData', path.join(profile, 'user-data'));

/* The preload reads the signed-in account synchronously when it loads. */
ipcMain.on(IPC.ACCOUNT_SIGNED_IN_SYNC, (event) => {
  event.returnValue = { accountId: null, legacyState: 'keep', organizationId: null };
});

const host = new InAppBrowserHost({
  // A port nothing listens on, standing in for the local server.
  serverPort: () => 9,
  runningServerPort: () => null,
  authHeader: () => ({}),
  accountRoot: () => path.join(profile, 'account'),
  storesRoot: () => null,
  downloadsDir: () => path.join(profile, 'downloads'),
  profileSession: (dir) => session.fromPath(dir),
  fetch: (input, init) => fetch(input, init),
  electronVersion: () => process.versions.electron,
});

app.whenReady().then(async () => {
  host.registerIpc(ipcMain);
  await host.start();
  const win = new BrowserWindow({ width: 1200, height: 800, webPreferences: mainWindowWebPreferences(9) });
  host.attachWindow(win);
  await win.loadFile(path.join(__dirname, 'in-app-browser-shell.html'));
  globalThis.inAppBrowserE2e = { url: host.bridgeUrl(), token: host.currentToken() };
});
