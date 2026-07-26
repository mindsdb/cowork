import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, powerMonitor, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkInstallStatus, runInstaller } from './installer';
import { startServer, stopServer, forceReapServer, isServerRunning, isServerStarting, getServerPort, getServerDiagnostics, getServerLogPath, resolveServerPort, fetchServerVersions } from './server-process';
import { setUpdateNotifier, recreateVenvIfUnsupportedPython, repairServerInstall } from './server-updater';
import { initUpdater, registerUpdateHandlers } from './updater';
import { oauthConnect, cancelCurrentOAuth } from './oauth-service';
import { setRefreshToken, deleteRefreshToken, getRefreshToken as getOAuthRefreshToken } from './keychain-service';
import { OAUTH_CREDENTIALS } from './credentials';
import { startRefreshLoop, stopRefreshLoop, stopAllRefreshLoops, revokedConnections, getPickerAccess } from './token-refresh';
import { fetchAccountEmail } from './oauth-identity';
import { openDrivePickerFlow, cancelCurrentDrivePicker, isValidDriveFileIds } from './drive-picker-service';
import { getPickedFiles, savePickedFiles, verifyPickedFiles, type PickedFile } from './picked-files';
import { saveTokens, getAccessToken, getRefreshToken, clearTokens, migrateRefreshTokenStore, isAccessTokenExpired } from './token-store';
import { refreshTokensOnly, writeMindsKeyToEnvAndRestart, provisionAntonApiKey, scheduleRefresh, cancelScheduledRefresh, endKeycloakSession, KEYCLOAK_AUTH_URL, KEYCLOAK_REGISTRATION_URL, KEYCLOAK_TOKEN_URL, SIGNUP_CALLBACK_TIMEOUT_MS } from './minds-auth';
import { MINDS_API_HOST } from './minds-urls';
import { sendEvent } from './analytics';
import { getRendererPath, getBundledPath, checkForUIUpdate, applyUIUpdate, hasInternet, getCachedVersion, isServingOta, rollbackUI } from './ui-updater';
import type { UpdateCheckResult } from './ui-updater';
import { coworkHome, coworkEnvPath, coworkStatePath, migrateLegacyHome, readEnvFile } from './cowork-home';
import { getServerAuthToken, authHeader, resetServerAuthTokenCache } from './server-auth';
import { getAppDisplayVersion } from './server-source';
import { unifiedVersion, SKEW_WARN_DAYS } from '../shared/version';

function getAntonEnvPath(): string {
  return coworkEnvPath();
}

function getCoworkStatePath(): string {
  return coworkStatePath();
}

function clearStoredProviderState(): void {
  const statePath = getCoworkStatePath();
  if (!fs.existsSync(statePath)) return;
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as { preferences?: Record<string, unknown> };
    if (!parsed || typeof parsed !== 'object') return;
    const prefs = parsed.preferences;
    if (!prefs || typeof prefs !== 'object') return;
    delete prefs.providers;
    delete prefs.modelMode;
    delete prefs.modelOverrides;
    delete prefs.providerStatus;
    delete prefs.providerStatusDetails;
    fs.writeFileSync(statePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  } catch (error) {
    console.warn('[logout] failed to clear provider state', error);
  }
}

/** Read DEV_MODE from ~/.anton/.env. Returns 'live', 'full', or null.
 *
 * Defaults to null (OTA enabled). Set `DEV_MODE=live` for the Vite
 * dev-server flow, `DEV_MODE=full` to force the bundled renderer
 * and skip OTA updates.
 */
function getDevMode(): string | null {
  const vars = readEnvFile();
  const val = (vars.DEV_MODE || '').trim().toLowerCase();
  if (val === 'ota' || val === 'false' || val === 'none' || !val) return null;
  return val; // 'live' or 'full'
}

/** Read UI_UPDATE_MODE from ~/.anton/.env. Defaults to 'auto'.
 *
 * ENG-858: this is now an env-only escape hatch, not a user-facing setting —
 * there is no Settings UI control for it. It exists for support (pin a user
 * to manual if a bad version ships) and QA (version-pinning during testing);
 * everyone else gets forced auto-apply at boot. */
function getUpdateMode(): 'auto' | 'manual' {
  const vars = readEnvFile();
  return vars.UI_UPDATE_MODE === 'manual' ? 'manual' : 'auto';
}

// Resolves once the boot-time server start has settled (server up, or
// decided-not-to-start because it isn't installed). serverConfigured() awaits
// this instead of polling, so cold-boot routing waits exactly as long as the
// real startup takes — uvicorn cold start included — rather than a fixed cap.
// Assigned synchronously in app.whenReady() so it exists before the renderer's
// init() can call through to checkConfigured().
let bootServerSettled: Promise<void> = Promise.resolve();

// Ask the running server for its readiness. Reads `config_ready` from /health —
// the SAME signal the in-app chat gate uses (settings.config_status) — so
// routing and the chat gate read one identical value and cannot disagree.
// Returns null when the server can't be reached/answered, so the caller falls
// back to the .env heuristic.
async function serverConfigured(): Promise<{ configured: boolean; provider: string } | null> {
  try { await bootServerSettled; } catch { /* boot start failed — fall through */ }
  if (!isServerRunning()) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/health/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`[checkConfigured] /health returned HTTP ${res.status}; falling back to .env`);
      return null;
    }
    const data = await res.json() as { config_ready?: boolean; provider?: string };
    if (typeof data.config_ready !== 'boolean') {
      console.warn('[checkConfigured] /health had no config_ready; falling back to .env');
      return null;
    }
    return { configured: data.config_ready, provider: data.provider ?? '' };
  } catch (err) {
    console.warn('[checkConfigured] could not reach server /health; falling back to .env:', err);
    return null;
  }
}

async function checkConfigured(): Promise<{ configured: boolean; provider: string }> {
  const vars = readEnvFile();
  if (vars.ANTON_TERMS_CONSENT !== 'true') return { configured: false, provider: '' };
  // config_ready from /health is authoritative and is the SAME signal the
  // in-app chat gate uses — defer to it so routing and the chat gate can't
  // disagree. (The old .env any-key check could pass here while config_ready
  // was false, stranding the user on "Connect a provider" with no recovery.)
  const fromServer = await serverConfigured();
  if (fromServer) return fromServer;
  // Server genuinely unreachable: fall back to the .env heuristic so a
  // configured user isn't needlessly bounced to onboarding. Provider strings
  // mirror the server's config_status vocabulary so the IPC value isn't
  // path-dependent.
  if (vars.ANTON_MINDS_API_KEY) return { configured: true, provider: 'minds_cloud' };
  if (vars.ANTON_ANTHROPIC_API_KEY) return { configured: true, provider: 'anthropic' };
  if (vars.ANTON_OPENAI_API_KEY) return { configured: true, provider: 'openai' };
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
    // Probe the real inference path (a 1-token chat completion) instead
    // of a listing route. `/v1/minds/` and `/models` are not deployed on
    // every MindsHub host and 404/401 even for valid keys, which blocked
    // onboarding with a working key. Mirrors minds_chat_base_url in
    // cowork-server: mdb.ai needs /api/v1, others need /v1.
    const base = baseUrl.replace(/\/+$/, '');
    const chatBase = base.endsWith('/v1')
      ? base
      : base.includes('mdb.ai') ? `${base}/api/v1` : `${base}/v1`;
    const res = await httpRequest(`${chatBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'latest:haiku',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true };
    }
    try {
      const parsed = JSON.parse(res.body).error?.message || `HTTP ${res.status}`;
      return { ok: false, error: parsed };
    } catch {
      return { ok: false, error: `Server returned HTTP ${res.status}` };
    }
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
        model: model || 'gpt-5.5',
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

// Pulls the desktop app back to the foreground after a browser-based
// flow (OAuth sign-in/connect, MindsHub login, the Drive Picker) hands
// control back to us — the OS default browser is frontmost after the
// redirect, and without this the user is left on the "you can close
// this tab" page with no indication the app already picked up the
// result.
function focusMainWindow() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      app.focus({ steal: true }); // macOS: steal focus from the browser
    }
  } catch {}
}

// One-shot self-heal for the boot OTA load: if the activated bundle's main
// frame fails to load (missing/corrupt assets), roll it back and fall to the
// app-bundled renderer. Uses `.on()` (not `.once()`) so benign subframe /
// ERR_ABORTED events don't consume the listener before a real main-frame
// result; disarms on the first relevant main-frame outcome or a timeout.
function armOtaBootSelfHeal(win: BrowserWindow) {
  let done = false;
  const disarm = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    win.webContents.removeListener('did-finish-load', onOk);
    win.webContents.removeListener('did-fail-load', onFail);
  };
  const recover = (why: string) => {
    disarm();
    console.error(`[main] OTA renderer ${why} at boot — rolling back to bundled`);
    rollbackUI();
    if (!win.isDestroyed()) win.loadFile(getBundledPath());
  };
  const onOk = () => disarm();
  const onFail = (_e: unknown, code: number, _desc: string, _url: string, isMainFrame: boolean) => {
    if (!isMainFrame || code === -3) return; // subframe / benign abort — stay armed
    recover('failed to load');
  };
  // A bundle that hangs during parse fires neither event; treat the timeout as a
  // failure and roll back (same 15s the post-swap health check uses), rather
  // than leaving the user stuck on a hung renderer.
  const timer = setTimeout(() => { if (!done) recover('did not load within timeout'); }, 15000);
  win.webContents.on('did-finish-load', onOk);
  win.webContents.on('did-fail-load', onFail);
}

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
      // ENG-439: hand the resolved (per-OS-user) server port to the renderer
      // synchronously, so getApiOrigin() addresses our own sidecar instead of
      // a hardcoded 26866 that could belong to another OS user.
      additionalArguments: [`--cowork-server-port=${getServerPort()}`],
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

  // Inject the server's bearer token into every request the renderer makes to
  // the loopback API — including browser-initiated loads (images, iframes and
  // their relative sub-resources, downloads) that can't carry an Authorization
  // header from renderer JS, and requests that follow a 307 trailing-slash
  // redirect (Chromium strips the header on those; this re-adds it on the
  // redirected request). Done at the network layer so it's uniform and the
  // token never reaches the renderer. Scoped to our loopback server's origin
  // so it can't leak elsewhere. No-op when the server runs without auth.
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*', 'http://localhost/*'] },
    (details, callback) => {
      const token = getServerAuthToken();
      if (token) {
        try {
          if (new URL(details.url).port === String(getServerPort())) {
            details.requestHeaders['Authorization'] = `Bearer ${token}`;
          }
        } catch {
          // Malformed URL — leave the headers untouched.
        }
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );

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
    // Boot self-heal: arm BEFORE the load (so the result can't be missed) when
    // serving an activated OTA bundle. A bad hot-update rolls back to the
    // app-bundled renderer instead of re-loading the broken bundle every launch.
    if (isServingOta()) armOtaBootSelfHeal(mainWindow);
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

  // Right-click editing menu. Electron ships no default context menu, so
  // without this, right-click → Cut/Copy/Paste does nothing anywhere
  // (the app menu only provides the keyboard accelerators). Wire a
  // minimal editing menu for any editable field or text selection so
  // pasting an API key by right-click works — the onboarding/settings
  // screens are the most paste-heavy surface in the app.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { isEditable, editFlags, selectionText } = params;
    if (!isEditable && !selectionText) return;
    const template: Electron.MenuItemConstructorOptions[] = isEditable
      ? [
          { role: 'cut', enabled: editFlags.canCut },
          { role: 'copy', enabled: editFlags.canCopy },
          { role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll' },
        ]
      : [{ role: 'copy', enabled: editFlags.canCopy }];
    Menu.buildFromTemplate(template).popup({ window: mainWindow! });
  });

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
    // Start the boot-veil fade only now that the window is actually visible.
    // (A parse-time CSS animation would finish while the window is still
    // hidden behind `show:false`, so the black cover would be gone before the
    // first frame the user sees.) The welcome orb is already rendered by now,
    // so we only need a brief mask over the show moment — then fade quickly
    // into the animated orb. A long black hold reads as a hung/broken screen.
    setTimeout(() => {
      mainWindow?.webContents
        .executeJavaScript(
          "var v=document.getElementById('boot-veil');if(v)v.classList.add('boot-veil--fade');",
        )
        .catch(() => {});
    }, 140);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
function setupIPC() {
  ipcMain.handle(IPC.INSTALL_CHECK, async () => {
    return checkInstallStatus();
  });

  ipcMain.handle(IPC.INSTALL_START, async () => {
    if (!mainWindow) return false;
    if (activeInstall) return false;
    const state = { cancelled: false };
    activeInstall = state;
    try {
      // runInstaller now also spins up the python server as its final
      // visible step (so the install screen shows "Start Cowork server").
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
  // default browser. Pure bridge: callers are responsible for any
  // persistence (token storage, env writes). MindsHub onboarding
  // goes through the dedicated `mindshub:*` handlers below so the
  // env file only gets touched once the user picks an LLM path.
  ipcMain.handle(IPC.OAUTH_CANCEL, () => {
    cancelCurrentOAuth();
    return true;
  });

  ipcMain.handle(IPC.OAUTH_CONNECT, async (_event, opts) => {
    const o = opts || {};

    // Builtin flow: renderer passes { engine, name } only.
    // Main owns the full flow — credentials never leave this process.
    if (o.engine && !o.authUrl) {
      const engine: string = o.engine;
      const labelName: string = o.name || '';
      if (!OAUTH_CREDENTIALS[engine]) {
        return { ok: false, reason: `No OAuth credentials configured for "${engine}".` };
      }
      let clientId: string;
      let clientSecret: string;
      try {
        const credsRes = await fetch(
          `http://127.0.0.1:${getServerPort()}/api/v1/connectors/oauth/${engine}/credentials`,
          { headers: authHeader() },
        );
        if (!credsRes.ok) {
          const err = await credsRes.json().catch(() => ({})) as { detail?: string };
          return { ok: false, reason: err.detail || `OAuth credentials not configured for "${engine}".` };
        }
        const credsData = await credsRes.json() as { client_id: string; client_secret: string };
        clientId = credsData.client_id;
        clientSecret = credsData.client_secret;
      } catch {
        return { ok: false, reason: `Could not fetch OAuth credentials for "${engine}".` };
      }

      let oauthBlock: Record<string, any>;
      try {
        const specRes = await fetch(
          `http://127.0.0.1:${getServerPort()}/api/v1/connectors/specs/${engine}`,
          { headers: authHeader() },
        );
        if (!specRes.ok) throw new Error(`HTTP ${specRes.status}`);
        const spec = await specRes.json() as Record<string, any>;
        const builtinMethod = spec?.form?.methods?.find((m: any) => m.id === 'browser_oauth_builtin');
        oauthBlock = builtinMethod?.oauth;
        if (!oauthBlock?.auth_url || !oauthBlock?.token_url || !Array.isArray(oauthBlock?.scopes)) {
          return { ok: false, reason: `Connector spec for "${engine}" is missing OAuth configuration.` };
        }
      } catch {
        return { ok: false, reason: `Could not load connector spec for "${engine}".` };
      }

      // supports_refresh defaults true (matches the server-side schema
      // default) when a spec doesn't declare it explicitly.
      const supportsRefresh = oauthBlock.supports_refresh !== false;

      const pkceResult = await oauthConnect({
        authUrl: oauthBlock.auth_url,
        tokenUrl: oauthBlock.token_url,
        clientId,
        clientSecret,
        scopes: oauthBlock.scopes,
        extraAuthParams: oauthBlock.extra_auth_params,
        redirectPort: oauthBlock.redirect_port,
      });
      if (!pkceResult.ok || !pkceResult.access_token || (supportsRefresh && !pkceResult.refresh_token)) {
        return { ok: false, reason: pkceResult.reason || 'OAuth flow did not return tokens.' };
      }
      focusMainWindow();

      // Fetch account email — needed as keychain key and for the vault
      // record's display name. The token exchange already succeeded at
      // this point, so retry once on a transient failure rather than
      // forcing the user to redo the whole consent flow.
      let accountEmail = '';
      for (let attempt = 0; attempt < 2 && !accountEmail; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
        accountEmail = await fetchAccountEmail(engine, pkceResult.access_token);
      }
      if (!accountEmail) return { ok: false, reason: 'Could not retrieve account email.' };

      // Store refresh_token in OS keychain — never sent over the network.
      // Absent entirely for a supports_refresh: false connector.
      if (pkceResult.refresh_token) {
        await setRefreshToken(engine, accountEmail, pkceResult.refresh_token);
      }

      const expiresAt = new Date(Date.now() + (pkceResult.expires_in ?? 3600) * 1000).toISOString();
      const tokenUrl: string = oauthBlock.token_url;

      // Persist to vault — refresh_token intentionally excluded.
      const saveRes = await fetch(
        `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/save`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({
            connector_id: engine,
            method: 'browser_oauth_builtin',
            name: labelName,
            values: {
              access_token: pkceResult.access_token,
              expires_at: expiresAt,
              account_email: accountEmail,
              token_url: tokenUrl,
              scope: pkceResult.scope || oauthBlock.scopes.join(' '),
              auth_type: 'oauth',
            },
          }),
        },
      );
      if (!saveRes.ok) {
        // Roll back the keychain write from above (a no-op if this
        // connector has none, e.g. supports_refresh: false) — otherwise a
        // live refresh token is orphaned in the OS keychain with no vault
        // record ever pointing at it.
        try { await deleteRefreshToken(engine, accountEmail); } catch {}
        return { ok: false, reason: `Failed to save connection (${saveRes.status}).` };
      }
      const saved = await saveRes.json() as { ok: boolean; name?: string };
      const vaultSlug = saved.name || labelName;

      startRefreshLoop(engine, vaultSlug, accountEmail, expiresAt, tokenUrl);
      return { ok: true, name: vaultSlug, account_email: accountEmail };
    }

    // BYOK passthrough: renderer passes full OAuth opts, gets tokens back.
    const byokResult = await oauthConnect(o);
    if (byokResult.ok) focusMainWindow();
    return byokResult;
  });

  ipcMain.handle(IPC.OAUTH_PICK_DRIVE_FILES, async (_event, opts) => {
    const { engine, name, accountEmail, fileIds, projectName } = opts || {};
    if (!engine || !name || !accountEmail) return { ok: false, reason: 'engine, name, and accountEmail are required.' };
    if (!isValidDriveFileIds(fileIds)) return { ok: false, reason: 'Invalid file id.' };
    const access = await getPickerAccess(engine, accountEmail);
    if (!access.ok) return access;
    const pickResult = await openDrivePickerFlow(access.accessToken, access.apiKey, access.appId, fileIds);
    if (!pickResult.ok) return pickResult;
    focusMainWindow();
    const newFiles = pickResult.files || [];
    // Nothing new picked (user cancelled) — return the existing persisted
    // list untouched rather than wiping it.
    if (newFiles.length === 0) {
      return { ok: true, files: await getPickedFiles(engine, name), newFiles: [] };
    }
    // The picker's PICKED callback firing doesn't guarantee Google actually
    // completed the per-file grant — confirm each file is readable with the
    // token we just minted before persisting it, so a broken grant surfaces
    // immediately instead of silently sitting in the list until Anton hits
    // a 403 on it later.
    const { verified, failed } = await verifyPickedFiles(access.accessToken, newFiles);
    // Tag each newly-verified file with the project it was picked for
    // (e.g. from the composer or a project's Project files rail) so the
    // Project files display can scope to just that project — untagged
    // (no projectName passed) when picked from connection-details, which
    // has no project context. merge_picked_files unions this with
    // whatever projects an already-picked file was tagged with before.
    const tagged = projectName
      ? verified.map((f) => ({ ...f, projects: [projectName] }))
      : verified;
    let files: PickedFile[];
    if (tagged.length > 0) {
      const saveResult = await savePickedFiles(engine, name, tagged);
      // Persistence failing here must surface as a real failure — the
      // renderer would otherwise show these files as granted/attached
      // when the server never actually recorded the grant, so a reload
      // later silently loses them.
      if (!saveResult.ok) return { ok: false, reason: saveResult.reason, failed };
      files = saveResult.files;
    } else {
      files = await getPickedFiles(engine, name);
    }
    // `files` is the connection's full accumulated grant (every file ever
    // picked) — correct for CustomizeView's "everything this app can
    // access" list, but callers that want "what did the user just pick in
    // THIS session" (e.g. attaching to the current message) need `tagged`
    // on its own, not the merged history.
    return { ok: true, files, newFiles: tagged, failed };
  });

  ipcMain.handle(IPC.OAUTH_CANCEL_PICKER, () => {
    cancelCurrentDrivePicker();
    return true;
  });

  ipcMain.handle(IPC.KEYCHAIN_REVOKE, async (_event, opts) => {
    const { engine, name, accountEmail } = opts || {};
    if (!engine || !name || !accountEmail) return { ok: false, reason: 'engine, name, and accountEmail are required.' };
    const key = `${engine}:${accountEmail}`;
    revokedConnections.add(key);
    stopRefreshLoop(engine, accountEmail);
    // The refresh_token is the only thing that actually revokes the whole
    // grant with the provider — revoking an access_token (what
    // cowork-server's own revoke() does, since the vault never holds
    // refresh_token) only invalidates that one short-lived token, leaving
    // the underlying authorization standing indefinitely. Electron is the
    // only place that ever holds the real refresh_token, so this has to
    // happen here, before it's deleted from the keychain. Gated on
    // supports_revoke — false means silently skip, local cleanup only.
    try {
      const refreshToken = await getOAuthRefreshToken(engine, accountEmail);
      if (refreshToken) {
        const specRes = await fetch(
          `http://127.0.0.1:${getServerPort()}/api/v1/connectors/specs/${engine}`,
          { headers: authHeader() },
        );
        if (specRes.ok) {
          const spec = await specRes.json() as Record<string, any>;
          const builtinMethod = spec?.form?.methods?.find((m: any) => m.id === 'browser_oauth_builtin');
          const oauthBlock = builtinMethod?.oauth;
          if (oauthBlock?.supports_revoke !== false && oauthBlock?.revoke_url) {
            await fetch(oauthBlock.revoke_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: refreshToken }).toString(),
            });
          }
        }
      }
    } catch {}
    try { await deleteRefreshToken(engine, accountEmail); } catch {}
    try {
      await fetch(
        `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${engine}/${name}`,
        { method: 'DELETE', headers: authHeader() },
      );
    } catch {}
    return { ok: true };
  });

  // ── MindsHub onboarding ──────────────────────────────────────
  // Logging in via Keycloak doesn't yet decide the user's LLM —
  // free users hit a paywall and may bail to BYOK. So login only
  // refreshes in-memory tokens + persists the refresh token to disk
  // (for next-launch silent refresh); writing ~/.anton/.env is
  // deferred to `mindshub:finalize` (or to host.saveSettings on the
  // BYOK path).
  // Shared by MINDSHUB_LOGIN and MINDSHUB_SIGNUP — the same loopback PKCE
  // exchange against Keycloak; only the browser entry point (login vs
  // registration form) and the callback patience differ. `anton-desktop`
  // is the only Keycloak client in the realm that allows loopback
  // (127.0.0.1) redirect URIs — `public-client` returns HTTP 400 for
  // those. Pulling org context into the token is handled post-auth by
  // ensureActiveOrg() in minds-auth.ts.
  const runMindsAuthFlow = async (authUrl: string, callbackTimeoutMs?: number) => {
    const result = await oauthConnect({
      clientId: 'anton-desktop',
      authUrl,
      tokenUrl: KEYCLOAK_TOKEN_URL,
      scopes: ['openid', 'profile', 'email', 'organization', 'offline_access'],
      callbackTimeoutMs,
    });
    if (result.ok && result.access_token) {
      if (!result.refresh_token) {
        // Session won't survive a restart without it — loud so a failing
        // machine's log explains the next-launch sign-out (ENG-761).
        console.warn('[mindshub:auth] Keycloak returned no refresh_token — session will not persist across restarts');
      }
      saveTokens(result.access_token, result.expires_in ?? 3600, result.refresh_token ?? '');
      scheduleRefresh(result.expires_in ?? 3600);
      focusMainWindow();
    }
    return result;
  };

  ipcMain.handle(IPC.MINDSHUB_LOGIN, () => runMindsAuthFlow(KEYCLOAK_AUTH_URL));

  // Sign-up (ENG-917): Keycloak's registration form, then the identical
  // code exchange. The long callback window covers the VERIFY_EMAIL pause —
  // the emailed link resumes the parked flow back to our loopback.
  ipcMain.handle(IPC.MINDSHUB_SIGNUP, () =>
    runMindsAuthFlow(KEYCLOAK_REGISTRATION_URL, SIGNUP_CALLBACK_TIMEOUT_MS));

  // Re-roll the access token using the stored refresh_token without
  // touching the env file. Used after Stripe checkout so the renderer
  // can re-decode roles and confirm the user is now paid.
  ipcMain.handle(IPC.MINDSHUB_REFRESH, async () => {
    const result = await refreshTokensOnly();
    if (result.status === 'ok') return { ok: true, access_token: result.token };
    // Superseded means a newer login/logout won the race while this
    // refresh was in flight — the store, not this exchange, holds the
    // truth. Report the current session instead of a false failure.
    if (result.status === 'superseded') {
      const current = getAccessToken();
      if (current) return { ok: true, access_token: current };
    }
    return { ok: false, reason: `Token refresh failed (${result.status}).` };
  });

  // Commit MindsHub as the LLM provider. The Keycloak JWT alone is
  // NOT a valid LLM credential — the gateway only accepts an `mdb_*`
  // API key minted through the auth-service. We exchange the JWT for
  // a key here, write that key to env, and restart the python server
  // so it talks to the gateway with a credential the gateway will
  // actually accept (otherwise every chat call comes back 401).
  // Renderer only calls this on the paid-user / Minds-as-LLM path.
  ipcMain.handle(IPC.MINDSHUB_FINALIZE, async () => {
    const token = getAccessToken();
    if (!token) {
      console.error('[mindshub:finalize] no cached access token — login may not have completed');
      return { ok: false, reason: 'No cached MindsHub access token.' };
    }
    console.log('[mindshub:finalize] provisioning API key…');
    const result = await provisionAntonApiKey(token);
    console.log('[mindshub:finalize] provisionAntonApiKey result:', result.key ? 'key minted' : `error: ${result.error}`);
    if (result.upgradeRequired) {
      return { ok: false, upgradeRequired: true };
    }
    if (!result.key) {
      return { ok: false, reason: result.error || 'Could not provision a MindsHub API key.' };
    }
    try {
      await writeMindsKeyToEnvAndRestart(result.key);
    } catch (err: any) {
      console.error('[mindshub:finalize] writeMindsKeyToEnvAndRestart failed:', err);
      return { ok: false, reason: `Failed to save MindsHub credentials: ${err?.message || err}` };
    }
    return { ok: true, apiKey: result.key };
  });

  // Returns the in-memory access token if one is cached (e.g. boot-
  // time silent refresh already succeeded). Lets the Onboarding page
  // skip a redundant PKCE round-trip for returning users.
  ipcMain.handle(IPC.MINDSHUB_GET_CACHED_TOKEN, () => {
    return { access_token: getAccessToken() };
  });

  // Authoritative "am I signed in?" read. The in-memory token is
  // process-lifetime only, so right after a launch (or after a missed
  // refresh window — laptop slept past the timer) it can be empty while
  // a perfectly valid refresh token sits on disk. Refresh on miss so the
  // Settings account card reflects the real session instead of showing
  // an authenticated user as signed out (ENG-761).
  ipcMain.handle(IPC.AUTH_GET_ACCESS_TOKEN, async () => {
    const cached = getAccessToken();
    if (cached && !isAccessTokenExpired()) return cached;
    if (!getRefreshToken()) return cached;
    const result = await refreshTokensOnly();
    return result.status === 'ok' ? result.token : getAccessToken();
  });
  ipcMain.handle(IPC.AUTH_LOGOUT, async () => {
    // Full sign-out: clear every credential + LLM-config key so the
    // next launch's checkConfigured() returns false and the user is
    // routed straight to onboarding. We deliberately keep
    // ANTON_TERMS_CONSENT (the user already agreed) and non-credential
    // preferences (memory mode, theme, etc.).
    //
    // SSO end-session is fire-and-forget — endKeycloakSession reads
    // the refresh token before this returns, so it has what it needs
    // even though we drop the local copy in the next line. We must
    // NOT await it: when the dev Keycloak hangs (which has happened),
    // a synchronous await freezes the whole logout, leaving the
    // confirm modal stuck on "Signing out…" because the renderer is
    // waiting on this IPC. The end-session call has its own 3s
    // timeout regardless, so worst case it tidies up in background.
    endKeycloakSession();
    cancelScheduledRefresh();
    // Tear down any sign-in still waiting on its browser tab. Without
    // this, the loopback server stays armed for up to 3 minutes and
    // completing that stale tab silently signs the user back in after
    // an explicit logout.
    cancelCurrentOAuth();
    clearTokens();

    // Clear credentials from the server's SQLite DB (the authoritative
    // source for config_ready). A single POST /settings/logout atomically
    // clears all credential keys and provider state in one transaction.
    // If the endpoint isn't available (404/405 — older server version),
    // fall back to individual DELETE requests for each credential key.
    let dbCleared = false;
    if (isServerRunning() || isServerStarting()) {
      const port = getServerPort();
      try {
        const res = await Promise.race([
          httpRequest(`http://127.0.0.1:${port}/api/v1/settings/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('logout request timed out')), 5000),
          ),
        ]);
        dbCleared = res.status >= 200 && res.status < 300;
        if (!dbCleared) console.warn('[logout] POST /settings/logout returned', res.status);
      } catch (err) {
        console.warn('[logout] POST /settings/logout failed:', err);
      }

      // Fallback: if POST /settings/logout isn't available (404/405 on
      // older server versions that don't have the endpoint yet), clear
      // each credential key individually via DELETE. Without this, the
      // DB retains credentials and config_ready stays true after logout.
      if (!dbCleared) {
        console.log('[logout] falling back to individual DELETE requests');
        const DB_CREDENTIAL_KEYS = [
          'minds_api_key', 'anthropic_api_key', 'openai_api_key',
          'gemini_api_key', 'openai_compatible_api_key',
          'minds_url', 'openai_base_url',
          'providers_json', 'provider_status', 'provider_status_details',
        ];
        const deletes = DB_CREDENTIAL_KEYS.map((key) =>
          httpRequest(`http://127.0.0.1:${port}/api/v1/settings/${key}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
          }).catch(() => { /* best effort */ }),
        );
        await Promise.race([
          Promise.allSettled(deletes),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);
        dbCleared = true;
      }
    }

    // Strip .env (for the standalone anton CLI and next-boot migration).
    const LOGOUT_ENV_KEYS = [
      'ANTON_MINDS_API_KEY',
      'ANTON_MINDS_URL',
      'ANTON_MINDS_ENABLED',
      'ANTON_OPENAI_API_KEY',
      'ANTON_OPENAI_BASE_URL',
      'ANTON_OPENAI_API_KEY_CUSTOM',
      'ANTON_ANTHROPIC_API_KEY',
      'ANTON_GEMINI_API_KEY',
      'ANTON_PLANNING_PROVIDER',
      'ANTON_CODING_PROVIDER',
      // ANTON_PLANNING_MODEL / ANTON_CODING_MODEL are intentionally NOT stripped
      // on logout (ENG-739). Preserving them on sign-in but deleting them on
      // sign-out would break the same "a `latest:` value may be a deliberate
      // choice — never silently mutate it" rule the sign-in path now follows.
      // A model is CLI-only in .env; the DB (product) is cleared separately.
    ];
    const envPath = getAntonEnvPath();
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
        .filter((l) => !LOGOUT_ENV_KEYS.some((k) => l.startsWith(k + '=')));
      fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
      for (const key of LOGOUT_ENV_KEYS) {
        delete process.env[key];
      }
    }
    clearStoredProviderState();

    // Restart the server so in-memory caches (settings, provider objects)
    // are flushed. If the DB clear failed (server was down, timed out),
    // the restart re-reads the cleaned .env as the sole credential source.
    // Without this, the Python process could still hold credentials in
    // memory and report config_ready: true after the UI says "signed out".
    if (isServerRunning() || isServerStarting()) {
      try {
        await stopServer();
        await startServer();

        // Verify the restart actually cleared config_ready. If it didn't,
        // credentials survived in the DB — log loudly so we can diagnose.
        const healthPort = getServerPort();
        try {
          const healthRes = await Promise.race([
            fetch(`http://127.0.0.1:${healthPort}/api/v1/health/`, {
              signal: AbortSignal.timeout(3000),
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('health check timed out')), 3500),
            ),
          ]);
          if (healthRes.ok) {
            const health = await healthRes.json() as Record<string, unknown>;
            if (health.config_ready) {
              console.error('[logout] BUG: config_ready is still true after logout — credentials survived in DB');
            } else {
              console.log('[logout] verified: config_ready is false after restart');
            }
          }
        } catch {
          // Health check failed — server may still be starting, not fatal
        }
      } catch (err) {
        console.warn('[logout] server restart failed:', err);
      }
    }

    // Force-reload the renderer from main. The renderer's own
    // `window.location.reload()` was unreliable here (page stayed on
    // the stuck confirm modal); driving the reload from the main
    // process via webContents.reload() always navigates and reboots
    // App.tsx's init() → checkConfigured() → onboarding redirect.
    //
    // Defer to the next tick so this handler's promise resolves and the
    // IPC reply is delivered to the renderer BEFORE we tear the page
    // down. Reloading synchronously here races the reply: sometimes the
    // renderer got it and also reloaded (double reload → stuck modal),
    // sometimes the page died before the reply landed. The single
    // deferred reload makes it deterministic. The renderer no longer
    // reloads on Electron (see SettingsView.handleLogout).
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    });
  });

  ipcMain.handle(IPC.INSTALL_CANCEL, async () => {
    if (!activeInstall) return false;
    activeInstall.cancelled = true;
    return true;
  });

  ipcMain.handle(IPC.SETTINGS_READ, async () => {
    return readEnvFile();
  });

  ipcMain.handle(IPC.SERVER_RESTART, async () => {
    console.log('[server] restart requested (post-onboarding)');
    await stopServer();
    // A restarted server may have generated a fresh COWORK_AUTH_TOKEN; drop
    // the cache so the webRequest hook re-reads it on the next request.
    resetServerAuthTokenCache();
    const result = await startServer({});
    if (result.ok) {
      console.log(`[server] restarted on http://127.0.0.1:${result.port}`);
    } else {
      console.error(`[server] restart failed: ${result.reason}`);
    }
    return result;
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, content: string) => {
    const homeDir = coworkHome();
    if (!fs.existsSync(homeDir)) {
      fs.mkdirSync(homeDir, { recursive: true });
    }
    const envPath = coworkEnvPath();
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    const merged = new Map<string, string>();
    for (const line of existing.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) merged.set(line.slice(0, eq), line.slice(eq + 1));
    }
    for (const line of content.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) merged.set(line.slice(0, eq), line.slice(eq + 1));
    }
    const out = [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(envPath, out, 'utf-8');

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

  // Keychain preference — reads/writes COWORK_KEYCHAIN in ~/.cowork/.env.
  // When enabled the refresh token lives in the macOS keychain; otherwise
  // it sits in a plaintext file under ~/.cowork. Flipping the flag migrates
  // any existing token to the chosen store.
  ipcMain.handle(IPC.KEYCHAIN_PREF_GET, () => {
    const vars = readEnvFile();
    // Default is enabled; only false when explicitly set to 'false'.
    return { enabled: vars.COWORK_KEYCHAIN !== 'false' };
  });

  ipcMain.handle(IPC.KEYCHAIN_PREF_SET, async (_event, enabled: boolean) => {
    try {
      const homeDir = coworkHome();
      if (!fs.existsSync(homeDir)) {
        fs.mkdirSync(homeDir, { recursive: true });
      }
      const envPath = coworkEnvPath();
      const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
      const lines = existing.split('\n').filter((l) => !l.startsWith('COWORK_KEYCHAIN='));
      // Only write the key when disabling; absence means "enabled" (the default).
      if (!enabled) lines.push('COWORK_KEYCHAIN=false');
      const out = lines.filter((l) => l.length > 0).join('\n') + '\n';
      fs.writeFileSync(envPath, out, 'utf-8');

      // Move any existing token into the newly-chosen store.
      migrateRefreshTokenStore(enabled);
      return { ok: true };
    } catch (error) {
      console.error('[keychain] failed to set preference', error);
      return { ok: false };
    }
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
        return validateMinds(apiKey, baseUrl || MINDS_API_HOST);
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

  ipcMain.handle(IPC.APP_UI_VERSION, async () => {
    // `ui` is the OTA-activated bundle version, or null when running the
    // renderer bundled with the installer. The renderer resolves the effective
    // UI version (falling back to its own baked __APP_VERSION__) and shows the
    // source tag; here we just report the raw facts.
    const uiVersion = getCachedVersion();
    return {
      app: getAppDisplayVersion(),
      ui: uiVersion,
      source: uiVersion ? 'ota' : 'bundled',
    };
  });

  // Register UI/server update IPC handlers unconditionally so the renderer
  // can check/apply in any build (dev, unpackaged, server-down). The gated
  // boot/periodic polling is started separately by initUpdater().
  registerUpdateHandlers(() => mainWindow);
}

// One-time purge of the on-disk HTTP cache, gated by app version. Older builds
// let Electron cache settings/stream responses to Cache_Data, leaving plaintext
// API keys (incl. rotated ones) on disk (ENG-462). Secret-bearing responses now
// send Cache-Control: no-store, but keys already cached must be cleared — so do
// it once per version (on upgrade / first install), not on every launch.
async function purgeHttpCacheOnUpgrade(): Promise<void> {
  try {
    const markerPath = path.join(app.getPath('userData'), 'cache-purge.json');
    const current = getAppDisplayVersion();
    let last = '';
    if (fs.existsSync(markerPath)) {
      try {
        last = (JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as { version?: string }).version || '';
      } catch {
        // Corrupt marker → treat as not-yet-purged and rewrite below.
      }
    }
    if (last === current) return;
    await session.defaultSession.clearCache();
    fs.writeFileSync(markerPath, JSON.stringify({ version: current }) + '\n', 'utf-8');
    console.log(`[cache] purged HTTP cache on upgrade (${last || 'none'} → ${current})`);
  } catch (err) {
    console.warn('[cache] HTTP cache purge failed (non-fatal)', err);
  }
}

app.whenReady().then(async () => {
  // Consolidate the legacy ~/.anton global config into ~/.cowork before
  // anything reads the env or starts the server. Best-effort + idempotent.
  migrateLegacyHome();

  // A machine that slept past the refresh timer wakes with an expired
  // in-memory token and a timer that fired into the void. Refresh on
  // resume so the session is live again before the user looks at it
  // (ENG-761 — the Windows-sleep flavour of "signed in but shows
  // signed out"). powerMonitor is only usable after app ready.
  powerMonitor.on('resume', () => {
    if (getRefreshToken() && isAccessTokenExpired()) void refreshTokensOnly();
  });

  // Purge any plaintext API keys older builds cached to disk (ENG-462).
  // Fire-and-forget: version-gated + idempotent, and current responses send
  // no-store so nothing new re-caches while this runs.
  void purgeHttpCacheOnUpgrade();

  const isMac = process.platform === 'darwin';

  if (isMac) {
    const dockIcon = nativeImage.createFromPath(getIconPath());
    app.dock?.setIcon(dockIcon);
  }

  /* Wording matches each platform's file manager so the label isn't a
     lie on Windows/Linux. The action (shell.showItemInFolder) is the
     same everywhere. */
  const revealLogsLabel = isMac
    ? 'Reveal Logs in Finder'
    : process.platform === 'win32'
      ? 'Show Logs in Explorer'
      : 'Show Logs in File Manager';

  /* Built on every platform so Windows/Linux users also get the Help
     menu (Documentation + log access). The macOS-only app-name submenu
     leads the bar on Mac; elsewhere a minimal File menu carries Quit,
     which the app menu would otherwise have owned. */
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            {
              label: 'About MindsHub Cowork',
              click: async () => {
                // Unified headline = ISO week of the newest hot-updated
                // component (UI + server + agent); the App shell is shown
                // separately since it updates via a different channel.
                // Per-component versions go in credits as a lightweight
                // diagnostics readout. Mirrors the Settings → Updates panel
                // (ENG-213).
                const shell = getAppDisplayVersion();
                const uiOta = getCachedVersion(); // OTA bundle version, or null when bundled
                const uiEffective = uiOta || shell;
                const { server, anton } = await fetchServerVersions().catch(() => ({ server: null, anton: null }));
                const unified = unifiedVersion([uiEffective, server, anton]);

                const lines = [
                  `App shell ${shell}`,
                  `UI ${uiOta ? `${uiOta} (OTA)` : `${shell} (bundled)`}`,
                ];
                if (server) lines.push(`Server ${server}`);
                if (anton) lines.push(`Agent ${anton}`);
                if (unified && unified.skewDays >= SKEW_WARN_DAYS) {
                  lines.push(`⚠ components out of sync (${unified.skewDays} days apart)`);
                }

                app.setAboutPanelOptions({
                  applicationName: 'MindsHub Cowork',
                  applicationVersion: unified ? unified.label : shell,
                  copyright: 'By MindsDB',
                  credits: `Autonomous AI Coworker\nhttps://mindsdb.com\n\n${lines.join('\n')}`,
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
        } as Electron.MenuItemConstructorOptions]
      : [{ role: 'fileMenu' } as Electron.MenuItemConstructorOptions]),
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
    {
      role: 'help',
      submenu: [
        {
          label: 'MindsHub Cowork Documentation',
          click: () => {
            shell.openExternal('https://docs.mindshub.ai/index.html');
          },
        },
        { type: 'separator' },
        {
          label: revealLogsLabel,
          click: () => {
            /* showItemInFolder needs the file to exist; before the server
               has ever started there's no log yet, so fall back to opening
               the logs directory itself. getServerLogPath() is now a pure
               getter, so ensure the directory exists before opening it. */
            const logPath = getServerLogPath();
            if (fs.existsSync(logPath)) {
              shell.showItemInFolder(logPath);
            } else {
              const logDir = path.dirname(logPath);
              fs.mkdirSync(logDir, { recursive: true });
              shell.openPath(logDir);
            }
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  ensureDefaultProject();
  setupIPC();
  // ENG-439: decide the (per-OS-user) server port before the window exists so
  // the renderer can be handed the resolved port via additionalArguments,
  // instead of hardcoding 26866. Best-effort + bounded — never blocks boot.
  await resolveServerPort();
  createWindow();

  // Capture renderer readiness NOW, before the async server start —
  // did-finish-load fires quickly (especially with Vite dev server)
  // and would be missed if we attached the listener after server boot.
  const rendererReady = new Promise<void>((resolve) => {
    if (mainWindow?.webContents.isLoading() === false) {
      // Already loaded (race: window created and loaded before we got here)
      setTimeout(resolve, 1500);
    } else {
      mainWindow?.webContents.once('did-finish-load', () => {
        setTimeout(resolve, 1500);
      });
    }
  });

  // Boot-time server start. If cowork-server is installed, start it
  // in the background. If not, skip — the renderer's boot flow will
  // route to the setup screen which handles installation.
  //
  // `bootServerSettled` is resolved the moment the start decision is made
  // (server up, failed, or skipped) — before the slow OTA update checks — so
  // checkConfigured() can await the real readiness without polling.
  let resolveBootServer: () => void = () => {};
  bootServerSettled = new Promise<void>((resolve) => { resolveBootServer = resolve; });
  checkInstallStatus().then(async ({ antonInstalled }) => {
    if (!antonInstalled) {
      console.log('[server] skipped: cowork-server not installed; setup screen will handle.');
      resolveBootServer();
      return;
    }
    // If MindsHub SSO tokens are stored, silently refresh before the Python
    // server starts — it reads .env at boot and needs a valid JWT.
    //
    // ENG-761: destroy local auth state ONLY on a definitive
    // `invalid_grant` from Keycloak. The old code cleared tokens (and
    // stripped env credentials) on ANY falsy refresh — so a network
    // blip at launch (Windows boots the app before the network is up)
    // permanently signed the user out. A transient failure now keeps
    // everything; minds-auth retries on its own timer and the next
    // successful refresh broadcasts the signed-in state to the UI.
    const existingRefresh = getRefreshToken();
    if (existingRefresh) {
      const outcome = await refreshTokensOnly();
      if (outcome.status === 'invalid_grant') {
        // Session is dead for real (tokens already cleared by
        // refreshTokensOnly) — strip stale credentials so
        // checkConfigured() returns false and the renderer routes
        // back to onboarding.
        const envPath = getAntonEnvPath();
        if (fs.existsSync(envPath)) {
          const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
            .filter(l => !l.startsWith('ANTON_OPENAI_API_KEY=') && !l.startsWith('ANTON_MINDS_API_KEY='));
          fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
        }
      } else if (outcome.status === 'transient') {
        console.warn('[auth] boot token refresh failed transiently — keeping session, retry scheduled');
      } else if (outcome.status !== 'ok') {
        console.warn(`[auth] boot token refresh skipped (${outcome.status}) — keeping session`);
      }
    }

    let result = await startServer();
    if (!result.ok) {
      // The server is installed but won't boot. Two self-heal paths, tried in
      // order; each rebuilds the venv with a clean --force --reinstall on the
      // source it was installed from, then we retry start once.
      console.error(`[server] start failed (${result.reason}); attempting recovery`);

      // 1. Venv stranded on an unsupported Python (a pre-3.12 install an
      //    in-place update loaded newer 3.12+ code into) — crashes at import
      //    time. Recreating it re-selects a supported interpreter.
      const recreated = await recreateVenvIfUnsupportedPython();
      if (recreated) {
        console.log('[server] recreated venv on a supported Python; retrying start');
        result = await startServer();
      }

      // 2. Venv on a supported Python but still dead — a corrupt or partially
      //    written environment (e.g. an interrupted upgrade left a dependency
      //    as a bare namespace package that ImportErrors at startup). A clean
      //    reinstall repairs it. Gated on the crash signature: repairServerInstall
      //    only reinstalls when the captured stderr looks like a broken install,
      //    so a migration/port/config failure never triggers a pointless (and
      //    potentially env-corrupting) reinstall. Skip when we just recreated:
      //    that already did a --force --reinstall.
      const failureLog = getServerDiagnostics().recentLog;
      if (!result.ok && !recreated && await repairServerInstall(failureLog)) {
        console.log('[server] repaired the server environment; retrying start');
        result = await startServer();
      }
    }
    resolveBootServer();  // readiness decided — unblock routing before the OTA checks below
    if (result.ok) {
      console.log(`[server] running on http://127.0.0.1:${result.port}`);
      // Resume refresh loops for Google OAuth connections already in the
      // vault from prior sessions — fire-and-forget, failures are per-entry.
      startOrphanRefreshLoops().catch(() => {});
    } else {
      console.error(`[server] start failed: ${result.reason}`);
    }
    // A constrained OTA cache that booted bundled (fail-closed) is re-verified
    // and, if compatible, swapped in by the updater's boot check after the
    // server-update pass — see settleConstrainedCache in updater.ts.

    // Wire the update checker regardless of whether the server booted. A
    // server that can't start is the case that MOST needs an update — a newer
    // build may be exactly what fixes the crash — so the boot check must not be
    // gated behind a successful start. When the server is down, the poll
    // applies an available server update even in manual mode (recovery, not a
    // routine update); a healthy server still honors the auto/manual env hatch.
    // maybeUpdateServer rolls back automatically if the new version also fails
    // its health probe, so this can't strand a previously-working install.
    setUpdateNotifier((payload) => {
      mainWindow?.webContents.send(IPC.SERVER_UPDATE_STATUS, payload);
    });

    const devMode = getDevMode();
    if (app.isPackaged && !devMode && mainWindow) {
      initUpdater(() => mainWindow, rendererReady, getUpdateMode);
    } else if (!app.isPackaged) {
      console.log('[updater] skipped — not a packaged build');
    } else if (devMode) {
      console.log(`[updater] skipped — DEV_MODE=${devMode}`);
    }
  }).catch((err) => {
    console.error('[server] check-and-start failed:', err);
    resolveBootServer();  // never leave checkConfigured() awaiting a stuck boot
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Tracks whether we've already drained the python child during this
const OAUTH_ENGINES = new Set(Object.keys(OAUTH_CREDENTIALS));

async function startOrphanRefreshLoops(): Promise<void> {
  try {
    const base = `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections`;
    const listRes = await fetch(`${base}/`, { headers: authHeader() });
    if (!listRes.ok) return;
    const connections = await listRes.json() as Array<{ engine: string; name: string }>;

    for (const { engine, name } of connections) {
      if (!OAUTH_ENGINES.has(engine)) continue;
      try {
        const detailRes = await fetch(`${base}/${engine}/${name}`, { headers: authHeader() });
        if (!detailRes.ok) continue;
        const detail = await detailRes.json() as { method?: string; fields?: Record<string, string> };
        const fields = detail.fields || {};
        // Use _method (underscore-prefixed, never masked by the API) rather than
        // auth_type or token_url which are in secure_keys and come back as sentinels.
        if (detail.method !== 'browser_oauth_builtin') continue;
        if (fields.status === 'needs_reconnect') continue;
        const accountEmail = fields.account_email;
        const expiresAt = fields.expires_at;
        if (!accountEmail || !expiresAt) continue;
        // Fetch token_url from the spec — it's masked in the vault detail response.
        const specRes = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/connectors/specs/${engine}`, { headers: authHeader() });
        if (!specRes.ok) continue;
        const spec = await specRes.json() as Record<string, any>;
        const oauthBlock = spec?.form?.methods?.find((m: any) => m.id === 'browser_oauth_builtin')?.oauth;
        if (oauthBlock?.supports_refresh === false) continue;
        const tokenUrl = oauthBlock?.token_url;
        if (!tokenUrl) continue;
        const refreshToken = await getOAuthRefreshToken(engine, accountEmail);
        if (!refreshToken) continue;
        startRefreshLoop(engine, name, accountEmail, expiresAt, tokenUrl);
        console.log(`[token-refresh] resumed loop for ${engine}:${accountEmail}`);
      } catch (err) {
        console.warn(`[token-refresh] could not resume loop for ${engine}/${name}:`, err);
      }
    }
  } catch (err) {
    console.warn('[token-refresh] orphan cleanup failed:', err);
  }
}

// quit. before-quit can fire multiple times (Cmd+Q, dock quit, force
// quit menu) — we only want to block on the first occurrence.
let _quitDrained = false;

async function drainServerForQuit(): Promise<void> {
  if (_quitDrained) return;
  _quitDrained = true;
  // Stop all OAuth refresh loops before the server shuts down so no
  // in-flight tick can call PATCH /token against a dead server.
  stopAllRefreshLoops();
  // Hard ceiling so a wedged python can't pin the quit indefinitely.
  // stopServer's own SIGTERM(6s) + SIGKILL(1.5s) chain stays inside
  // this window, but a misbehaving OS-level process delay could push
  // past it; if so we'd rather quit than leave the user waiting on the
  // dock icon. Both numbers end early the moment the child exits, so a
  // healthy quit is still immediate.
  const stopped = await Promise.race([
    stopServer().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
  ]);

  // stopServer lost the race. The usual reason is that a start still holds
  // the lifecycle lock — a sidecar that is still importing can hold it for
  // the whole start cap, far longer than this ceiling — so the polite stop
  // never even ran. Quitting here would leave that python behind to bind the
  // port unsupervised. Reap it directly, without the lock, still bounded.
  if (!stopped) {
    console.warn('[server] stop did not finish before the quit ceiling; force-reaping the sidecar');
    await Promise.race([
      forceReapServer(),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
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
