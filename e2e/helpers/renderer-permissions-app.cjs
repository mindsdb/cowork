// Isolated Electron host for the production permission policy. No backend,
// credentials, onboarding or access to the user's normal app profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { registerRendererPermissions } = require('../../dist/main/main/renderer-permissions.js');

app.setPath('userData', process.env.PERMISSION_TEST_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ webPreferences: { sandbox: true, contextIsolation: true } });
  registerRendererPermissions(win.webContents);
  await win.loadFile(path.join(__dirname, 'renderer-permissions.html'));
});
app.on('window-all-closed', () => app.quit());
