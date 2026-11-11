/*
 * Isolated Electron host for e2e/in-app-browser.spec.ts. It opens one window
 * with the main window's own webPreferences and preload, and runs the real
 * in-app browser host from dist/main on a throwaway profile. There is no local
 * server, so nothing is registered; the spec reads the bridge's address and
 * key from `globalThis.inAppBrowserE2e` through electronApp.evaluate. Needs
 * `npm run build` first, for dist/main.
 */
const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('node:path');
const { InAppBrowserHost } = require('../../dist/main/main/browser-host.js');
const { markDownloaded } = require('../../dist/main/main/download-quarantine.js');
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
  sidecarAccountRoot: () => null,
  storesRoot: () => null,
  downloadsDir: () => path.join(profile, 'downloads'),
  markDownloaded,
  profileSession: (dir) => session.fromPath(dir),
  memorySession: (partition) => session.fromPartition(partition),
  fetch: (input, init) => fetch(input, init),
  electronVersion: () => process.versions.electron,
  userDataDir: () => app.getPath('userData'),
});

/* Close, Reload and Force Reload (Command+W, Command+R and Command+Shift+R on
   macOS, Control elsewhere), as the app's own menu has them (app.ts). The
   spec presses the agent's chords through the bridge and checks that none
   reaches the menu, and the person's through the tab's sendInputEvent and
   checks that they reload the site, never the app. */
Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Window', submenu: [{ role: 'close' }, { role: 'reload' }, { role: 'forceReload' }] }]));

app.whenReady().then(async () => {
  host.registerIpc(ipcMain);
  await host.start();
  const win = new BrowserWindow({ width: 1200, height: 800, webPreferences: mainWindowWebPreferences(9) });
  host.attachWindow(win);
  await win.loadFile(path.join(__dirname, 'in-app-browser-shell.html'));
  globalThis.inAppBrowserE2e = { url: host.bridgeUrl(), token: host.currentToken() };
});
