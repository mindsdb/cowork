import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkAntonInstalled, checkInstallStatus, runInstaller } from './installer';
import { startServer, stopServer, isServerRunning, isServerStarting, getServerPort, getServerDiagnostics } from './server-process';
import { getSelectedHarness } from './harness-process';
import { oauthConnect } from './oauth-service';
import { sendEvent } from './analytics';
import { getRendererPath, getBundledPath, checkForUIUpdate, applyUIUpdate, hasInternet, getCachedVersion } from './ui-updater';
import type { UpdateCheckResult } from './ui-updater';

function getAntonEnvPath(): string {
  return path.join(os.homedir(), '.anton', '.env');
}

function readEnvFile(): Record<string, string> {
  const envPath = getAntonEnvPath();
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return vars;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return vars;
}

/** Read DEV_MODE from ~/.anton/.env. Returns 'live', 'full', or null.
 *
 * Defaults to 'full' when the user hasn't set anything — the OTA
 * hot-update path is parked while we stabilize. Bundled renderer is
 * the path of least surprise: every relaunch picks up whatever was
 * shipped in the .app, no async cache fetch in the boot path. Set
 * `DEV_MODE=live` for the Vite dev-server flow, `DEV_MODE=ota` to
 * opt back into the cached-bundle path. `false` / `none` also map
 * to the OTA path for callers that want the previous behaviour.
 */
function getDevMode(): string | null {
  const vars = readEnvFile();
  const val = (vars.DEV_MODE || '').trim().toLowerCase();
  if (val === 'ota' || val === 'false' || val === 'none') return null;
  if (!val) return 'full';
  return val; // 'live' or 'full'
}

/** Read UI_UPDATE_MODE from ~/.anton/.env. Defaults to 'manual'. */
function getUpdateMode(): 'auto' | 'manual' {
  const vars = readEnvFile();
  return vars.UI_UPDATE_MODE === 'auto' ? 'auto' : 'manual';
}

function checkConfigured(): { configured: boolean; provider: string } {
  const harness = getSelectedHarness();
  if (harness === 'hermes') {
    return { configured: true, provider: 'hermes' };
  }
  const vars = readEnvFile();
  if (vars.ANTON_ANTHROPIC_API_KEY) {
    return { configured: true, provider: 'anthropic' };
  }
  if (vars.ANTON_OPENAI_API_KEY && vars.ANTON_OPENAI_BASE_URL) {
    return { configured: true, provider: 'minds' };
  }
  return { configured: false, provider: '' };
}

function httpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string; rejectUnauthorized?: boolean }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const rejectUnauth = options.rejectUnauthorized !== false;
    const reqOptions: any = {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers,
    };
    if (!rejectUnauth && parsed.protocol === 'https:') {
      // codeql[js/disabling-certificate-validation]
      reqOptions.agent = new https.Agent({ rejectUnauthorized: false });
    }
    const req = mod.request(
      reqOptions,
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function validateAnthropic(apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await httpRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    try {
      const parsed = JSON.parse(res.body).error?.message || `HTTP ${res.status}`;
      return { ok: false, error: parsed };
    } catch {
      return { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

async function validateMinds(
  apiKey: string,
  baseUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    // First check the minds API is reachable
    const base = baseUrl.replace(/\/+$/, '');
    const mindsUrl = base + '/api/v1/minds/';
    const res = await httpRequest(mindsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true };
    }
    return { ok: false, error: `Server returned HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

async function validateOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    // Support endpoints that already include a versioned path (e.g. Gemini's /v1beta/openai)
    const chatUrl = /\/v\d/.test(normalizedBase)
      ? `${normalizedBase}/chat/completions`
      : `${normalizedBase}/v1/chat/completions`;
    const res = await httpRequest(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    try {
      const parsed = JSON.parse(res.body).error?.message || `HTTP ${res.status}`;
      return { ok: false, error: parsed };
    } catch {
      return { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

// ─── Projects ────────────────────────────────────────────────
function getProjectsDir(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'projects');
}

function ensureProjectsDir() {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureDefaultProject() {
  ensureProjectsDir();
  const defaultDir = path.join(getProjectsDir(), 'default');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  const antonDir = path.join(defaultDir, '.anton');
  if (!fs.existsSync(antonDir)) {
    fs.mkdirSync(antonDir, { recursive: true });
  }
}

// ─── Icons ───────────────────────────────────────────────────
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.png');
  }
  return path.join(__dirname, '..', '..', '..', 'assets', 'icon.png');
}

let mainWindow: BrowserWindow | null = null;
let activeInstall: { cancelled: boolean } | null = null;

function createWindow() {
  const icon = nativeImage.createFromPath(getIconPath());
  const isDev = !app.isPackaged && process.env.VITE_DEV === '1';
  const devMode = getDevMode();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Embed the macOS traffic lights inside the sidebar header. Coordinates
    // are window-relative; the sidebar floats with ~9px outer padding so
    // x:18 / y:22 places the lights inside the chrome row with a small gap
    // from the sidebar's top-left.
    trafficLightPosition: process.platform === 'darwin' ? { x: 20, y: 24 } : undefined,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // Disable Chromium's same-origin/mixed-content checks so the renderer
      // (loaded from file://) can fetch http://127.0.0.1:<antonPort>/v1/*.
      // Safe in this context: app is local, network calls only target the
      // loopback python server we spawn ourselves. CSP in index.html still
      // allowlists the exact origins for defense in depth.
      // codeql[js/electron-disable-websecurity]
      webSecurity: false, 
    },
  });

  // Renderer loading priority:
  // 1. DEV_MODE=live → Vite dev server (hot reload without full build)
  // 2. Standard Vite dev (VITE_DEV=1) → dev server
  // 3. DEV_MODE=full → always use bundled renderer, skip OTA cache
  // 4. Production → OTA cached bundle or bundled fallback
  if (devMode === 'live') {
    const port = process.env.VITE_RENDERER_PORT || '5173';
    console.log(`[main] DEV_MODE=live — loading from http://localhost:${port}`);
    mainWindow.loadURL(`http://localhost:${port}`);
  } else if (isDev) {
    mainWindow.loadURL(process.env.VITE_RENDERER_URL || 'http://localhost:5173');
  } else if (devMode === 'full') {
    console.log('[main] DEV_MODE=full — using bundled renderer, skipping OTA cache');
    mainWindow.loadFile(getBundledPath());
  } else {
    const rendererPath = getRendererPath();
    console.log(`[main] loading renderer from ${rendererPath}`);
    mainWindow.loadFile(rendererPath);
  }

  // DevTools no longer auto-open on launch. Still reachable on demand
  // via the View menu (Cmd+Option+I) when needed for debugging.
  // Opt back in by setting ANTON_DEVTOOLS=1.
  if (process.env.ANTON_DEVTOOLS === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    });
  }

  // Grant the renderer access to the microphone so the Web Speech API
  // (composer voice input) can capture audio. Other permissions stay
  // denied. Pair with NSMicrophoneUsageDescription in Info.plist and
  // the audio-input entitlement so the OS prompt actually fires.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    // 'audioCapture' isn't in Electron's Permission union but some
    // Chromium builds emit it for the Web Speech API. Cast through
    // string for the comparison so TS doesn't narrow it away.
    const perm = permission as string;
    if (perm === 'media' || perm === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });

  // Open external links in the OS default browser instead of navigating Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server reloads
    if (!app.isPackaged && url.startsWith('http://localhost')) return;
    // Block navigation and open in OS browser
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
function setupIPC() {
  ipcMain.handle(IPC.INSTALL_CHECK, async () => {
    // Return both the CLI presence AND the server-deps readiness so
    // the renderer can route to setup when either is missing — covers
    // the case where the user already has the anton CLI installed
    // independently but doesn't have fastapi/uvicorn/etc. yet.
    return checkInstallStatus();
  });

  ipcMain.handle(IPC.INSTALL_START, async () => {
    if (!mainWindow) return false;
    if (activeInstall) return false;
    const state = { cancelled: false };
    activeInstall = state;
    try {
      // runInstaller now also spins up the python server as its final
      // visible step (so the install screen shows "Start Anton server").
      return await runInstaller(mainWindow, { shouldAbort: () => state.cancelled });
    } finally {
      if (activeInstall === state) {
        activeInstall = null;
      }
    }
  });

  // Renderer can ask main where the server lives.
  ipcMain.handle('server:get-info', () => ({
    running: isServerRunning(),
    starting: isServerStarting(),
    port: getServerPort(),
    origin: `http://127.0.0.1:${getServerPort()}`,
    harness: getSelectedHarness(),
  }));

  // Toggle the python server up/down. Used by the sidebar footer button.
  // Returns the new state so the renderer can reflect it without polling.
  // "Already starting" counts as up — stop it instead of double-spawning.
  ipcMain.handle('server:toggle', async () => {
    if (isServerRunning() || isServerStarting()) {
      await stopServer();
      return { running: false, port: getServerPort() };
    }
    const result = await startServer();
    return { running: !!result.ok, port: result.port ?? getServerPort(), error: result.reason };
  });
  ipcMain.handle('server:start', async () => {
    if (isServerRunning()) return { running: true, port: getServerPort() };
    // If a start is already in progress, await it rather than spawn again.
    const result = await startServer();
    return { running: !!result.ok, port: result.port ?? getServerPort(), error: result.reason };
  });
  ipcMain.handle('server:stop', async () => {
    // Actually await the child's exit before resolving. The renderer
    // typically follows this with a serverStart() — without the wait,
    // the new python races the dying one for port 26866.
    await stopServer();
    return { running: false, port: getServerPort() };
  });
  // Diagnostics — last start error + recent stdout/stderr tail. The
  // renderer surfaces these in a help modal when the user wonders
  // why the backend is offline.
  ipcMain.handle('server:get-diagnostics', () => getServerDiagnostics());

  // PKCE OAuth — opens a one-shot loopback server + the user's
  // default browser. The renderer hands over either Anton's hosted
  // client_id (Pattern A) or BYOK client_id + client_secret (Pattern B).
  ipcMain.handle('oauth:connect', async (_event, opts) => {
    return oauthConnect(opts || {});
  });

  ipcMain.handle(IPC.INSTALL_CANCEL, async () => {
    if (!activeInstall) return false;
    activeInstall.cancelled = true;
    return true;
  });

  ipcMain.handle(IPC.SETTINGS_READ, async () => {
    return readEnvFile();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, content: string) => {
    const antonDir = path.join(os.homedir(), '.anton');
    if (!fs.existsSync(antonDir)) {
      fs.mkdirSync(antonDir, { recursive: true });
    }
    const envPath = path.join(antonDir, '.env');
    fs.writeFileSync(envPath, content + '\n', 'utf-8');

    // Analytics — fire-and-forget, never blocks
    if (content.includes('ANTON_TERMS_CONSENT=true')) {
      sendEvent('ANTONAPP_TERMS_ACCEPTED');
    }
    if (content.includes('ANTON_MINDS_ENABLED=true')) {
      sendEvent('ANTONAPP_MINDSLLM');
    } else if (content.includes('ANTON_ANTHROPIC_API_KEY') || content.includes('ANTON_OPENAI_API_KEY')) {
      sendEvent('ANTONAPP_BYOK');
    }

    return true;
  });

  ipcMain.handle(IPC.SETTINGS_CHECK_CONFIGURED, async () => {
    return checkConfigured();
  });

  ipcMain.handle(
    IPC.SETTINGS_VALIDATE,
    async (_event, provider: string, apiKey: string, baseUrl?: string, model?: string) => {
      if (provider === 'anthropic') {
        return validateAnthropic(apiKey, model || 'claude-sonnet-4-6');
      } else if (provider === 'minds') {
        return validateMinds(apiKey, baseUrl || 'https://mdb.ai');
      } else if (provider === 'openai-compatible') {
        return validateOpenAICompatible(apiKey, baseUrl || 'https://api.openai.com/v1', model);
      }
      return { ok: false, error: 'Unknown provider' };
    }
  );

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });

  // Open a local file/folder in the OS default app (Finder, browser,
  // editor, etc.). Used by the chat's working-folder card.
  ipcMain.handle('shell:open-path', async (_event, p: string) => {
    if (typeof p !== 'string' || !p) return { ok: false, reason: 'empty path' };
    try {
      const result = await shell.openPath(p);
      // shell.openPath returns '' on success, or an error string.
      if (result) return { ok: false, reason: result };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: e?.message || String(e) };
    }
  });

  // Reveal a local file in the platform file manager. Unlike
  // shell.openPath, this selects the artifact instead of opening it.
  ipcMain.handle(IPC.SHOW_ITEM_IN_FOLDER, async (_event, p: string) => {
    if (typeof p !== 'string' || !p) return { ok: false, reason: 'empty path' };
    try {
      const target = path.resolve(p);
      if (!fs.existsSync(target)) return { ok: false, reason: 'file not found' };
      shell.showItemInFolder(target);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: e?.message || String(e) };
    }
  });

  // Move a local file/folder to the OS Trash. Recoverable from the
  // user's Trash/Recycle Bin — used by the artifact viewer's Delete
  // action so an accidental click is undoable.
  ipcMain.handle('shell:trash-item', async (_event, p: string) => {
    if (typeof p !== 'string' || !p) return { ok: false, reason: 'empty path' };
    try {
      await shell.trashItem(p);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: e?.message || String(e) };
    }
  });

  ipcMain.handle(IPC.APP_UI_VERSION, async () => {
    const uiVersion = getCachedVersion();
    return {
      app: app.getVersion(),
      ui: uiVersion || 'bundled',
    };
  });

  // UI Updates
  ipcMain.handle(IPC.UI_UPDATE_CHECK, async () => {
    return checkForUIUpdate();
  });

  ipcMain.handle(IPC.UI_UPDATE_APPLY, async () => {
    console.log('[ui-updater] apply requested via IPC');
    try {
      const applied = await applyUIUpdate();
      console.log(`[ui-updater] apply result: ${applied}`);
      if (applied && mainWindow) {
        console.log('[ui-updater] reloading window with new bundle');
        mainWindow.loadFile(getRendererPath());
      }
      return applied;
    } catch (err) {
      console.error('[ui-updater] apply failed:', err);
      throw err;
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(getIconPath());
    app.dock?.setIcon(dockIcon);

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          {
            label: 'About Anton',
            click: () => {
              const uiVersion = getCachedVersion();
              const versionStr = uiVersion
                ? `${app.getVersion()} (UI: ${uiVersion})`
                : app.getVersion();
              app.setAboutPanelOptions({
                applicationName: 'Anton',
                applicationVersion: versionStr,
                copyright: 'By MindsDB',
                credits: 'Autonomous AI Coworker\nhttps://mindsdb.com',
              });
              app.showAboutPanel();
            },
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { role: 'togglefullscreen' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
        ],
      },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  ensureDefaultProject();
  setupIPC();
  createWindow();

  // If anton is already installed AND the server-runtime Python deps
  // are importable, start the bundled python server in the
  // background. Skips silently if either is missing — the renderer's
  // boot flow will route to the setup screen, which handles installing
  // (or re-installing with extras) and then starts the server itself.
  // Without the deps check, a returning user with a stand-alone
  // `anton` install would see the server fail to start with a Python
  // ImportError they can't act on.
  // Boot-time server start. Three branches, all loud so the user
  // can see why they're offline if it goes wrong:
  //   1. Anton not installed at all → setup screen handles it.
  //   2. Server deps missing from the tool venv → log + skip; the
  //      install step re-fills the deps, the next launch picks up.
  //   3. Otherwise → call `startServer()`, which itself begins with a
  //      `/health` probe so it adopts an already-listening orphan
  //      from a prior session before trying to spawn a fresh python.
  //
  // Auto-update is handled inside `server/main.py` via
  // `_maybe_self_update_and_reexec` — same `anton.updater.check_and_update`
  // the CLI uses. The python child execs itself in-place when a new
  // release lands, transparent to Node.
  checkInstallStatus().then(async ({ antonInstalled, serverDepsReady }) => {
    if (!antonInstalled) {
      console.log('[server] skipped: Anton CLI not installed; setup screen will handle.');
      return;
    }
    if (!serverDepsReady) {
      console.warn('[server] skipped: server deps missing from tool venv. Run installer to repair.');
      return;
    }
    const result = await startServer();
    if (!result.ok) {
      console.error(`[server] start failed: ${result.reason}`);
    } else {
      console.log(`[server] running on http://127.0.0.1:${result.port}`);
    }
  }).catch((err) => {
    console.error('[server] check-and-start failed:', err);
  });

  // OTA UI update check — only in packaged builds and not in DEV_MODE.
  // Waits for the renderer to finish loading so the React app has time
  // to mount and register its IPC listener before we push status.
  const devMode = getDevMode();
  if (app.isPackaged && !devMode) {
    const runUpdateCheck = async () => {
      try {
        const updateMode = getUpdateMode();
        console.log(`[ui-updater] checking for updates (mode: ${updateMode})...`);
        mainWindow?.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'checking' });

        const online = await hasInternet();
        if (!online) {
          console.log('[ui-updater] offline — skipping update check');
          mainWindow?.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'offline' });
          return;
        }

        const result = await checkForUIUpdate();
        if (!result.updateAvailable) {
          console.log('[ui-updater] up to date');
          mainWindow?.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'up-to-date' });
          return;
        }

        console.log(`[ui-updater] new version available: ${result.newVersion}`);

        if (updateMode === 'auto') {
          console.log('[ui-updater] auto mode — downloading and applying...');
          mainWindow?.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'downloading', version: result.newVersion });
          const applied = await applyUIUpdate();
          if (applied && mainWindow) {
            console.log('[ui-updater] update applied — reloading window');
            mainWindow.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'reloading' });
            mainWindow.loadFile(getRendererPath());
          }
        } else {
          console.log('[ui-updater] manual mode — notifying renderer');
          mainWindow?.webContents.send(IPC.UI_UPDATE_STATUS, {
            phase: 'available',
            version: result.newVersion,
          });
        }
      } catch (err) {
        console.error('[ui-updater] startup check failed:', err);
      }
    };
    // Delay until the renderer has loaded and React has mounted
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(runUpdateCheck, 1500);
    });
  } else if (!app.isPackaged) {
    console.log('[ui-updater] skipped — not a packaged build');
  } else if (devMode) {
    console.log(`[ui-updater] skipped — DEV_MODE=${devMode}`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Tracks whether we've already drained the python child during this
// quit. before-quit can fire multiple times (Cmd+Q, dock quit, force
// quit menu) — we only want to block on the first occurrence.
let _quitDrained = false;

async function drainServerForQuit(): Promise<void> {
  if (_quitDrained) return;
  _quitDrained = true;
  // Hard ceiling so a wedged python can't pin the quit indefinitely.
  // stopServer's own SIGTERM(3s) + SIGKILL(1.5s) chain stays inside
  // this window, but a misbehaving OS-level process delay could push
  // past it; if so we'd rather quit and reparent the child to launchd
  // than leave the user waiting on the dock icon.
  await Promise.race([
    stopServer(),
    new Promise<void>((resolve) => setTimeout(resolve, 6_000)),
  ]);
}

app.on('window-all-closed', async () => {
  await drainServerForQuit();
  app.quit();
});

// Block the quit until the python child has actually exited. Earlier
// this was `void stopServer()` — fire-and-forget — which meant
// Electron exited (often within milliseconds of SIGTERM) before the
// python had time to respond. The child got reparented to launchd
// (PPID=1) and kept running, holding port 26866. The next launch's
// new python couldn't bind, fell back to talking to the orphan, and
// since the orphan's cwd was inside a now-deleted bundle directory,
// every chat completion crashed in `os.getcwd()` with [Errno 2].
//
// `event.preventDefault()` defers the quit; we re-call `app.quit()`
// after the drain finishes. Guarded by `_quitDrained` so the second
// invocation skips the deferral and the app exits cleanly.
app.on('before-quit', (event) => {
  if (_quitDrained) return;
  event.preventDefault();
  drainServerForQuit().finally(() => {
    app.quit();
  });
});
