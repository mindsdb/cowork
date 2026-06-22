import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkInstallStatus, runInstaller } from './installer';
import { startServer, stopServer, isServerRunning, isServerStarting, getServerPort, getServerDiagnostics, getServerLogPath } from './server-process';
import { maybeUpdateServer, setUpdateNotifier } from './server-updater';
import { oauthConnect, cancelCurrentOAuth } from './oauth-service';
import { saveTokens, getAccessToken, getRefreshToken, clearTokens } from './token-store';
import { silentRefresh, refreshTokensOnly, writeMindsKeyToEnvAndRestart, provisionAntonApiKey, scheduleRefresh, endKeycloakSession } from './minds-auth';
import { sendEvent } from './analytics';
import { getRendererPath, getBundledPath, checkForUIUpdate, applyUIUpdate, hasInternet, getCachedVersion } from './ui-updater';
import type { UpdateCheckResult } from './ui-updater';

function getAntonEnvPath(): string {
  return path.join(os.homedir(), '.anton', '.env');
}

function getCoworkStatePath(): string {
  return path.join(os.homedir(), '.anton', 'cowork', 'state.json');
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

/** Read UI_UPDATE_MODE from ~/.anton/.env. Defaults to 'auto'. */
function getUpdateMode(): 'auto' | 'manual' {
  const vars = readEnvFile();
  return vars.UI_UPDATE_MODE === 'manual' ? 'manual' : 'auto';
}

function checkConfigured(): { configured: boolean; provider: string } {
  const vars = readEnvFile();
  if (vars.ANTON_TERMS_CONSENT !== 'true') return { configured: false, provider: '' };
  if (vars.ANTON_MINDS_API_KEY) return { configured: true, provider: 'minds' };
  if (vars.ANTON_ANTHROPIC_API_KEY) return { configured: true, provider: 'anthropic' };
  if (vars.ANTON_OPENAI_API_KEY && vars.ANTON_OPENAI_BASE_URL) return { configured: true, provider: 'openai' };
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

  ipcMain.handle('oauth:connect', async (_event, opts) => {
    return oauthConnect(opts || {});
  });

  // ── MindsHub onboarding ──────────────────────────────────────
  // Logging in via Keycloak doesn't yet decide the user's LLM —
  // free users hit a paywall and may bail to BYOK. So login only
  // refreshes in-memory tokens + persists the refresh token to disk
  // (for next-launch silent refresh); writing ~/.anton/.env is
  // deferred to `mindshub:finalize` (or to host.saveSettings on the
  // BYOK path).
  ipcMain.handle(IPC.MINDSHUB_LOGIN, async () => {
    // `anton-desktop` is the only Keycloak client in the dev realm
    // that allows loopback (127.0.0.1) redirect URIs — `public-client`
    // returns HTTP 400 for those. Pulling org context into the token
    // is handled post-login by ensureActiveOrg() in minds-auth.ts.
    const result = await oauthConnect({
      clientId: 'anton-desktop',
      authUrl: 'https://auth.mindshub.ai/auth/realms/mindsdb/protocol/openid-connect/auth',
      tokenUrl: 'https://auth.mindshub.ai/auth/realms/mindsdb/protocol/openid-connect/token',
      scopes: ['openid', 'profile', 'email', 'organization', 'offline_access'],
    });
    if (result.ok && result.access_token) {
      saveTokens(result.access_token, result.expires_in ?? 3600, result.refresh_token ?? '');
      scheduleRefresh(result.expires_in ?? 3600);
      // Pull the desktop app back to the foreground. The SSO flow opens the
      // OS default browser, which is frontmost after the redirect — without
      // this the user is left on the "you can close this tab" page and may
      // not realize the app has signed them in.
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          app.focus({ steal: true }); // macOS: steal focus from the browser
        }
      } catch {}
    }
    return result;
  });

  // Re-roll the access token using the stored refresh_token without
  // touching the env file. Used after Stripe checkout so the renderer
  // can re-decode roles and confirm the user is now paid.
  ipcMain.handle(IPC.MINDSHUB_REFRESH, async () => {
    const token = await refreshTokensOnly();
    if (!token) return { ok: false, reason: 'No refresh token or refresh failed.' };
    return { ok: true, access_token: token };
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
    if (!token) return { ok: false, reason: 'No cached MindsHub access token.' };
    const result = await provisionAntonApiKey(token);
    if (result.upgradeRequired) {
      return { ok: false, upgradeRequired: true };
    }
    if (!result.key) {
      return { ok: false, reason: result.error || 'Could not provision a MindsHub API key.' };
    }
    await writeMindsKeyToEnvAndRestart(result.key);
    return { ok: true, apiKey: result.key };
  });

  // Returns the in-memory access token if one is cached (e.g. boot-
  // time silent refresh already succeeded). Lets the Onboarding page
  // skip a redundant PKCE round-trip for returning users.
  ipcMain.handle(IPC.MINDSHUB_GET_CACHED_TOKEN, () => {
    return { access_token: getAccessToken() };
  });

  ipcMain.handle(IPC.AUTH_GET_ACCESS_TOKEN, () => getAccessToken());
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
    clearTokens();
    const envPath = getAntonEnvPath();
    if (fs.existsSync(envPath)) {
      const LOGOUT_KEYS = [
        'ANTON_MINDS_API_KEY',
        'ANTON_MINDS_URL',
        'ANTON_MINDS_ENABLED',
        'ANTON_OPENAI_API_KEY',
        'ANTON_OPENAI_BASE_URL',
        'ANTON_ANTHROPIC_API_KEY',
        'ANTON_PLANNING_PROVIDER',
        'ANTON_CODING_PROVIDER',
        'ANTON_PLANNING_MODEL',
        'ANTON_CODING_MODEL',
      ];
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
        .filter((l) => !LOGOUT_KEYS.some((k) => l.startsWith(k + '=')));
      fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
      for (const key of LOGOUT_KEYS) {
        delete process.env[key];
      }
    }
    clearStoredProviderState();
    if (isServerRunning() || isServerStarting()) {
      try {
        // Cap the reset at 3s. httpRequest() has no timeout of its own,
        // so a hung (vs. crashed) python server would otherwise block
        // this await forever — the deferred reload below would never
        // fire and the confirm modal would sit on "Signing out…". The
        // runtime reset is best-effort cleanup; the reload re-routes to
        // onboarding regardless of whether it succeeded.
        await Promise.race([
          httpRequest(`http://127.0.0.1:${getServerPort()}/v1/settings/runtime-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('runtime-reset timed out')), 3000),
          ),
        ]);
      } catch (error) {
        console.warn('[logout] failed to reset live runtimes', error);
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
    const result = await startServer({});
    if (result.ok) {
      console.log(`[server] restarted on http://127.0.0.1:${result.port}`);
    } else {
      console.error(`[server] restart failed: ${result.reason}`);
    }
    return result;
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, content: string) => {
    const antonDir = path.join(os.homedir(), '.anton');
    if (!fs.existsSync(antonDir)) {
      fs.mkdirSync(antonDir, { recursive: true });
    }
    const envPath = path.join(antonDir, '.env');
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

  ipcMain.handle(IPC.SETTINGS_CHECK_CONFIGURED, async () => {
    return checkConfigured();
  });

  ipcMain.handle(
    IPC.SETTINGS_VALIDATE,
    async (_event, provider: string, apiKey: string, baseUrl?: string, model?: string) => {
      if (provider === 'anthropic') {
        return validateAnthropic(apiKey, model || 'claude-sonnet-4-6');
      } else if (provider === 'minds') {
        return validateMinds(apiKey, baseUrl || 'https://api.mindshub.ai');
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
              click: () => {
                const uiVersion = getCachedVersion();
                const versionStr = uiVersion
                  ? `${app.getVersion()} (UI: ${uiVersion})`
                  : app.getVersion();
                app.setAboutPanelOptions({
                  applicationName: 'MindsHub Cowork',
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
          label: 'Anton Cowork Documentation',
          click: () => {
            shell.openExternal('https://docs.mindsdb.com');
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
  createWindow();

  // Boot-time server start. If cowork-server is installed, start it
  // in the background. If not, skip — the renderer's boot flow will
  // route to the setup screen which handles installation.
  checkInstallStatus().then(async ({ antonInstalled }) => {
    if (!antonInstalled) {
      console.log('[server] skipped: cowork-server not installed; setup screen will handle.');
      return;
    }
    // If MindsHub SSO tokens are stored, silently refresh before the Python
    // server starts — it reads .env at boot and needs a valid JWT.
    const existingRefresh = getRefreshToken();
    if (existingRefresh) {
      const ok = await silentRefresh();
      if (!ok) {
        // Refresh token expired — clear so checkConfigured() returns false
        // and the renderer routes back to onboarding.
        clearTokens();
        const envPath = getAntonEnvPath();
        if (fs.existsSync(envPath)) {
          const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
            .filter(l => !l.startsWith('ANTON_OPENAI_API_KEY=') && !l.startsWith('ANTON_MINDS_API_KEY='));
          fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
        }
      }
    }

    const result = await startServer();
    if (!result.ok) {
      console.error(`[server] start failed: ${result.reason}`);
    } else {
      console.log(`[server] running on http://127.0.0.1:${result.port}`);
      // Background update check — runs after the server is already
      // serving so users aren't blocked. If a newer version is found
      // on PyPI, stops the server, upgrades, and restarts. Rolls back
      // automatically if the new version fails the health probe.
      setUpdateNotifier((payload) => {
        mainWindow?.webContents.send(IPC.SERVER_UPDATE_STATUS, payload);
      });

      // Update server first, then check for UI updates. This ensures
      // the renderer and server stay in sync — both track git HEAD on
      // main, so updating them in sequence (server → UI) avoids any
      // window where a new renderer talks to an old server.
      const serverUpdateDone = maybeUpdateServer().then((updateResult) => {
        if (updateResult.updated) {
          console.log(`[server-updater] updated ${updateResult.previousVersion} → ${updateResult.newVersion}`);
        } else if (updateResult.error) {
          console.error(`[server-updater] ${updateResult.error}`);
        }
      }).catch((err) => {
        console.error('[server-updater] check failed:', err);
      });

      // OTA UI update check — only in packaged builds and not in DEV_MODE.
      // Waits for both the server update AND the renderer to finish loading
      // so the React app has time to mount its IPC listener.
      const devMode = getDevMode();
      if (app.isPackaged && !devMode) {
        const rendererReady = new Promise<void>((resolve) => {
          mainWindow?.webContents.once('did-finish-load', () => {
            setTimeout(resolve, 1500);
          });
        });

        Promise.all([serverUpdateDone, rendererReady]).then(async () => {
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
        });
      } else if (!app.isPackaged) {
        console.log('[ui-updater] skipped — not a packaged build');
      } else if (devMode) {
        console.log(`[ui-updater] skipped — DEV_MODE=${devMode}`);
      }
    }
  }).catch((err) => {
    console.error('[server] check-and-start failed:', err);
  });

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
