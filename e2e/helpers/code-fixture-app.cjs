// Isolated Electron host that opens one Code Mode fixture from the web dev
// renderer, so a test can measure real layout. No backend or user profile.
const { app, BrowserWindow } = require('electron');

app.setPath('userData', process.env.CODE_FIXTURE_PROFILE);
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(process.env.CODE_FIXTURE_WIDTH) || 760,
    height: 720,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  await win.loadURL(process.env.CODE_FIXTURE_URL);
});
app.on('window-all-closed', () => app.quit());
