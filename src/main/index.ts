// MUST be first: sets the per-channel Electron app name (→ userData dir) before
// any module that reads app.getPath('userData') at load time (e.g. token-store).
import './app-identity';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, powerMonitor, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { IPC } from '../shared/ipc-channels';
import { checkInstallStatus, runInstaller } from './installer';
import { startServer, stopServer, forceReapServer, isServerRunning, isServerStarting, getServerPort, getServerDiagnostics, getServerLogPath, resolveServerPort, fetchServerVersions, setServerStartedHook } from './server-process';
import { setUpdateNotifier, recreateVenvIfUnsupportedPython, repairServerInstall } from './server-updater';
import { initUpdater, registerUpdateHandlers } from './updater';
import { awaitBootSettled } from './boot-gate';
import { awaitUpdateMaintenanceIdle } from './update-maintenance';
import { oauthConnect, cancelCurrentOAuth } from './oauth-service';
import { setRefreshToken, deleteRefreshToken, getRefreshToken as getOAuthRefreshToken } from './keychain-service';
import { OAUTH_CREDENTIALS } from './credentials';
import { startRefreshLoop, stopRefreshLoop, stopAllRefreshLoops, revokedConnections, getPickerAccess } from './token-refresh';
import { fetchAccountIdentity, buildRevokeRequest } from './oauth-identity';
import { openDrivePickerFlow, cancelCurrentDrivePicker, isValidDriveFileIds } from './drive-picker-service';
import { getPickedFiles, savePickedFiles, verifyPickedFiles, type PickedFile } from './picked-files';
import { saveTokens, getAccessToken, getRefreshToken, clearTokens, migrateRefreshTokenStore } from './token-store';
import { refreshTokensOnly, refreshMindsCredentialAfterResume, handOffMindsCredentialToStartedSidecar, beginMindsCredentialSignOut, endMindsCredentialSignOut, commitMindsSignIn, selectEntitledOrg, scheduleRefresh, cancelScheduledRefresh, revokeDeviceKeyAndEndSession, getRevokeToken, freshAccessToken, listMindsOrgs, switchMindsOrg, KEYCLOAK_AUTH_URL, KEYCLOAK_REGISTRATION_URL, KEYCLOAK_TOKEN_URL, SIGNUP_CALLBACK_TIMEOUT_MS } from './minds-auth';
import { clearUserSuppliedMindsKey, establishMindsCredential, forgetMindsCredential, setUserSuppliedMindsKey } from './minds-credential';
import { isMindsResumeCredentialGateActive, resetMindsResumeCredentialGate, settleMindsResumeCredentialGate, waitForMindsResumeCredential } from './minds-resume-gate';
import {
  gateMindsResponseCreationRequest,
  mindsRuntimeCredentialRequirementFromHealth,
} from './minds-response-request-gate';
import { scrubEnvCredentials } from './logout-env';
import {
  beginSignOutRouting,
  endSignOutRouting,
  isSignOutRoutingActive,
  performSignOutCleanup,
  type SignOutDeps,
} from './sign-out';
import { awaitSignOutSidecarFlush, startSignOutSidecarFlush } from './sign-out-restart';
import { SERVER_START_CAP_MS } from '../shared/server-status';
import { MINDS_API_HOST } from './minds-urls';
import {
  validateAnthropic,
  validateMinds,
  validateOpenAICompatible,
} from './provider-validation';
import { sendEvent } from './analytics';
import { getRendererPath, getBundledPath, checkForUIUpdate, applyUIUpdate, hasInternet, getCachedVersion, isServingOta, rollbackUI } from './ui-updater';
import type { UpdateCheckResult } from './ui-updater';
import { coworkHome, coworkEnvPath, coworkStatePath, migrateLegacyHome, readEnvFile, buildKind, buildKindStrict } from './cowork-home';
import { checkChannelConsistency } from './channels';
import { resolveChannelIconPath } from './app-icon';
import { applyChannelUvIsolation, primeLoginShellPath } from './uv-paths';
import { shellAutoUpdateEnabledFor } from './shell-auto-update-rollout';
import { getServerAuthToken, authHeader, resetServerAuthTokenCache } from './server-auth';
import { getAppDisplayVersion } from './server-source';
import { unifiedVersion, SKEW_WARN_DAYS } from '../shared/version';
import { detectClaudeCode } from './coding-mode';
import { normalizeExternalBrowserUrl } from './external-url';
import {
  startCodingTerminal,
  writeToCodingTerminal,
  resizeCodingTerminal,
  isCodingTerminalRunning,
  killCodingTerminal,
  killAllCodingTerminals,
  removeCodingTask,
} from './coding-terminal';

/*
 * Register before any startup path: every sidecar start needs its in-memory credential restored.
 * Also settle the wake barrier after a successful handoff.
 */
setServerStartedHook(handOffMindsCredentialToStartedSidecar);

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

/** DEV_MODE=live uses Vite; full uses the bundled renderer and skips OTA; unset permits OTA. */
function getDevMode(): string | null {
  const vars = readEnvFile();
  const val = (vars.DEV_MODE || '').trim().toLowerCase();
  if (val === 'ota' || val === 'false' || val === 'none' || !val) return null;
  return val; // 'live' or 'full'
}

/** UI_UPDATE_MODE is a support/QA environment override; normal users auto-apply updates at boot. */
function getUpdateMode(): 'auto' | 'manual' {
  const vars = readEnvFile();
  return vars.UI_UPDATE_MODE === 'manual' ? 'manual' : 'auto';
}

/** ENG-850 shell auto-update — on by default for `stable` and `prod`;
 *  `SHELL_AUTO_UPDATE_ENABLED=false` is the environment kill switch. */
function shellAutoUpdateEnabled(): boolean {
  const vars = readEnvFile();
  return shellAutoUpdateEnabledFor(buildKindStrict(), vars.SHELL_AUTO_UPDATE_ENABLED);
}

// Assign before renderer initialization; routing awaits the real sidecar start decision, including
// failures/skips.
let bootServerSettled: Promise<void> = Promise.resolve();

// The loading screen awaits the boot update poll; resolve immediately on paths without an updater.
let bootUpdateSettled: Promise<void> = Promise.resolve();

// Read the same config_ready health field as the chat gate; null permits the offline .env fallback.
async function serverConfigured(): Promise<{
  configured: boolean;
  provider: string;
  mindsRuntimeCredentialRequired: boolean | null;
} | null> {
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
    const data = await res.json() as {
      config_ready?: boolean;
      provider?: string;
      minds_runtime_credential_required?: boolean;
    };
    if (typeof data.config_ready !== 'boolean') {
      console.warn('[checkConfigured] /health had no config_ready; falling back to .env');
      return null;
    }
    return {
      configured: data.config_ready,
      provider: data.provider ?? '',
      mindsRuntimeCredentialRequired: mindsRuntimeCredentialRequirementFromHealth(data),
    };
  } catch (err) {
    console.warn('[checkConfigured] could not reach server /health; falling back to .env:', err);
    return null;
  }
}

async function checkConfigured(): Promise<{ configured: boolean; provider: string }> {
  const vars = readEnvFile();
  if (vars.ANTON_TERMS_CONSENT !== 'true') return { configured: false, provider: '' };
  /*
   * While sign-out’s restart is pending, ignore stale sidecar readiness so reload cannot route back
   * into the app.
   */
  if (isSignOutRoutingActive()) return { configured: false, provider: '' };
  // Health config_ready is authoritative; keep boot routing aligned with the chat gate.
  const fromServer = await serverConfigured();
  if (fromServer) return fromServer;
  // Use .env only when health is unreachable, retaining the server’s provider vocabulary.
  if (vars.ANTON_MINDS_API_KEY) return { configured: true, provider: 'minds_cloud' };
  if (vars.ANTON_ANTHROPIC_API_KEY) return { configured: true, provider: 'anthropic' };
  if (vars.ANTON_OPENAI_API_KEY) return { configured: true, provider: 'openai' };
  return { configured: false, provider: '' };
}

async function runtimeMindsCredentialRequirement(): Promise<boolean | null> {
  const configured = await serverConfigured();
  // A missing field identifies an older or unreachable sidecar. The request
  // gate treats that as unknown and preserves the conservative wait.
  return configured?.mindsRuntimeCredentialRequired ?? null;
}

// Forward only busy server-update phases to the UI progress channel; errors must not leave a
// spinner active.
function serverPhaseToUiStatus(
  payload: Record<string, unknown>,
): { phase: string; version?: string } | null {
  const phase = typeof payload.phase === 'string' ? payload.phase : '';
  const version = typeof payload.to === 'string' ? payload.to : undefined;
  if (phase === 'downloading') return { phase: 'downloading', ...(version ? { version } : {}) };
  if (phase === 'restarting') return { phase: 'reloading' };
  return null;
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

// Use channel-badged runtime icons; app-icon.ts owns selection and fallback.
function getIconPath(): string {
  const assetsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', '..', '..', 'assets');
  return resolveChannelIconPath(buildKind(), assetsDir, fs.existsSync);
}

let mainWindow: BrowserWindow | null = null;
let activeInstall: { cancelled: boolean } | null = null;

// Return focus to the app after browser-based OAuth/Picker completion.
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

// Rollback failed main-frame OTA loads. Ignore subframe/ERR_ABORTED events without consuming the
// listener.
// Disarm on the first relevant result or timeout.
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
    // Quarantine is synchronous; bundled loading need not await cache cleanup, whose failure must
    // not crash the app.
    void rollbackUI().catch((err) => console.error('[main] UI rollback failed', err));
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
    // Keep Electron above the phone breakpoint so MobileShell does not collide with embedded
    // traffic lights.
    minWidth: 640,
    minHeight: 440,
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Position macOS traffic lights within the padded sidebar header.
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

  // Inject bearer auth only for our loopback origin, including browser loads and redirects that
  // strip headers.
  // Keep the token out of renderer JavaScript.
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*', 'http://localhost/*'] },
    (details, callback) => {
      const forward = () => {
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
      };

      const gated = gateMindsResponseCreationRequest(
        details,
        getServerPort(),
        isMindsResumeCredentialGateActive(),
        runtimeMindsCredentialRequirement,
        waitForMindsResumeCredential,
        (ready) => {
          if (!ready) {
            console.warn('[minds-auth] response creation aborted while the resumed credential remained unavailable');
            callback({ cancel: true });
            return;
          }
          forward();
        },
      );
      if (!gated) forward();
    },
  );

  // Prefer live/Vite development, then forced bundled mode, otherwise the active OTA bundle or
  // bundled fallback.
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

  // Electron has no default editing context menu; install one for editable fields and selected
  // text.
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

  // Allow microphone only; pair with the macOS usage description and audio-input entitlement.
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
    const browserUrl = normalizeExternalBrowserUrl(url);
    if (browserUrl) void shell.openExternal(browserUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server reloads
    if (!app.isPackaged && url.startsWith('http://localhost')) return;
    // Block navigation and open in OS browser
    event.preventDefault();
    const browserUrl = normalizeExternalBrowserUrl(url);
    if (browserUrl) void shell.openExternal(browserUrl);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Begin the boot-veil fade only after show; a parse-time animation would finish while the
    // window was hidden.
    setTimeout(() => {
      mainWindow?.webContents
        .executeJavaScript(
          "var v=document.getElementById('boot-veil');if(v)v.classList.add('boot-veil--fade');",
        )
        .catch(() => {});
    }, 140);
  });

  const sendWindowVisibility = (visible: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.APP_WINDOW_VISIBILITY, visible);
  };
  mainWindow.on('hide', () => sendWindowVisibility(false));
  mainWindow.on('minimize', () => sendWindowVisibility(false));
  mainWindow.on('show', () => sendWindowVisibility(true));
  mainWindow.on('restore', () => sendWindowVisibility(true));
  mainWindow.on('focus', () => sendWindowVisibility(true));

  mainWindow.on('closed', () => {
    mainWindow = null;
    killAllCodingTerminals();
  });
}

// Bound the boot credential handoff to one refresh plus PUT; refresh retries can repair a timed-out
// handoff.
const BOOT_CREDENTIAL_TIMEOUT_MS = 15_000;

// Wait briefly for sign-out’s restart before sign-in; commitMindsSignIn also ensures a live
// sidecar.
const SIGN_OUT_FLUSH_SIGN_IN_WAIT_MS = 30_000;

// Share sign-out between IPC and legacy-key migration; sign-out.ts owns the sequence.
async function performMindsSignOut() {
  beginMindsCredentialSignOut();
  beginSignOutRouting();
  try {
    await performSignOutCleanup(mindsSignOutDeps());
  } finally {
    endMindsCredentialSignOut();
    /*
     * Keep routing latched until sign-out’s restart settles, beyond the earlier credential-clear
     * reply.
     * Bound it by the start cap so a failed restart cannot leave the app permanently unconfigured.
     */
    void awaitSignOutSidecarFlush(SERVER_START_CAP_MS).finally(endSignOutRouting);
  }
}

/* Wire real dependencies for the shared sign-out sequence. */
function mindsSignOutDeps(): SignOutDeps {
  return {
    getRevokeToken,
    getRefreshToken,
    revokeDeviceKeyAndEndSession,
    cancelScheduledRefresh,
    cancelCurrentOAuth,
    clearTokens,
    settleMindsResumeCredentialGate,
    resetMindsResumeCredentialGate,
    forgetMindsCredential,
    isServerRunning,
    isServerStarting,
    getServerPort,
    httpRequest,
    scrubEnvCredentials,
    getAntonEnvPath,
    clearStoredProviderState,
    startSidecarFlush: () => {
      void startSignOutSidecarFlush({
        isServerRunning,
        isServerStarting,
        stopServer,
        startServer,
        probeConfigReady,
      });
    },
    reloadRenderer: () => {
      setImmediate(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      });
    },
  };
}

/* Bound flush-health diagnostics with both fetch abort and a wall-clock race. */
async function probeConfigReady(): Promise<boolean | null> {
  const healthPort = getServerPort();
  const healthRes = await Promise.race([
    fetch(`http://127.0.0.1:${healthPort}/api/v1/health/`, {
      signal: AbortSignal.timeout(3000),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('health check timed out')), 3500),
    ),
  ]);
  if (!healthRes.ok) return null;
  const health = await healthRes.json() as Record<string, unknown>;
  return Boolean(health.config_ready);
}

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
    // Always call startServer’s health-aware ensure path; an adopted process can die without
    // updating its cached flag.
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

  // Generic OAuth only exchanges tokens; callers own persistence. MindsHub finalization uses
  // dedicated handlers.
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
        return {
          ok: false,
          code: 'oauth_credentials_missing',
          reason: `No OAuth credentials configured for "${engine}".`,
        };
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
          return {
            ok: false,
            code: credsRes.status === 422 ? 'oauth_credentials_missing' : undefined,
            reason: err.detail || `OAuth credentials not configured for "${engine}".`,
          };
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
        redirectHost: oauthBlock.redirect_host,
        tokenAuthStyle: oauthBlock.token_auth_style,
      });
      if (!pkceResult.ok || !pkceResult.access_token || (supportsRefresh && !pkceResult.refresh_token)) {
        return { ok: false, reason: pkceResult.reason || 'OAuth flow did not return tokens.' };
      }
      focusMainWindow();

      // Retry a transient identity lookup once rather than repeating an already-completed consent
      // flow.
      let accountIdentity: Awaited<ReturnType<typeof fetchAccountIdentity>> = { email: '' };
      for (let attempt = 0; attempt < 2 && !accountIdentity.email; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
        accountIdentity = await fetchAccountIdentity(engine, pkceResult.access_token);
      }
      const accountEmail = accountIdentity.email;
      if (!accountEmail) return { ok: false, reason: accountIdentity.reason || 'Could not retrieve account email.' };

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
            replace_existing: Boolean(labelName),
            values: {
              access_token: pkceResult.access_token,
              expires_at: expiresAt,
              account_email: accountEmail,
              ...(accountIdentity.name ? { account_name: accountIdentity.name } : {}),
              token_url: tokenUrl,
              scope: pkceResult.scope || oauthBlock.scopes.join(' '),
              auth_type: 'oauth',
            },
          }),
        },
      );
      if (!saveRes.ok) {
        // Remove the keychain token if vault creation fails so no live refresh token is orphaned.
        try { await deleteRefreshToken(engine, accountEmail); } catch {}
        return { ok: false, reason: `Failed to save connection (${saveRes.status}).` };
      }
      const saved = await saveRes.json() as { ok: boolean; name?: string };
      const vaultSlug = saved.name || labelName;

      startRefreshLoop(engine, vaultSlug, accountEmail, expiresAt, tokenUrl, oauthBlock.token_auth_style);
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
    const pickResult = await openDrivePickerFlow(access.accessToken, access.apiKey, access.appId, accountEmail, fileIds);
    // Bring the app forward on failure too — this is the only place the
    // account-mismatch guidance the picker page fell back to shows up.
    focusMainWindow();
    if (!pickResult.ok) return pickResult;
    const newFiles = pickResult.files || [];
    // Nothing new picked (user cancelled) — return the existing persisted
    // list untouched rather than wiping it.
    if (newFiles.length === 0) {
      return { ok: true, files: await getPickedFiles(engine, name), newFiles: [] };
    }
    // Verify Picker grants are readable before persisting; PICKED alone does not prove access.
    const { verified, failed } = await verifyPickedFiles(access.accessToken, newFiles);
    // Tag new picks with their project; server merging unions existing project memberships.
    const tagged = projectName
      ? verified.map((f) => ({ ...f, projects: [projectName] }))
      : verified;
    let files: PickedFile[];
    if (tagged.length > 0) {
      const saveResult = await savePickedFiles(engine, name, tagged);
      // Surface persistence failure so the renderer cannot report an unrecorded grant as attached.
      if (!saveResult.ok) return { ok: false, reason: saveResult.reason, failed };
      files = saveResult.files;
    } else {
      files = await getPickedFiles(engine, name);
    }
    // Return both accumulated grants and this session’s picks; attachment callers need only the
    // latter.
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
    // Revoke the refresh token before deleting it locally; access-token revocation alone leaves the
    // provider grant live.
    // Skip remote revocation when the connector declares supports_revoke=false.
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
            // Load app credentials for providers whose revoke request requires them; local cleanup
            // remains best-effort.
            let clientId = '';
            let clientSecret = '';
            try {
              const credsRes = await fetch(
                `http://127.0.0.1:${getServerPort()}/api/v1/connectors/oauth/${engine}/credentials`,
                { headers: authHeader() },
              );
              if (credsRes.ok) {
                const credsData = await credsRes.json() as { client_id?: string; client_secret?: string };
                clientId = credsData.client_id || '';
                clientSecret = credsData.client_secret || '';
              }
            } catch {}
            const { headers, body } = buildRevokeRequest(engine, refreshToken, clientId, clientSecret);
            await fetch(oauthBlock.revoke_url, { method: 'POST', headers, body });
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

  // Share PKCE between login and signup; defer provider configuration to finalize or BYOK settings.
  // Use anton-desktop for loopback redirects; ensureActiveOrg supplies post-auth organization
  // context.
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
    // This bridge returns the refreshed JWT so the renderer can re-decode
    // roles after checkout. A pending sidecar handoff does not make that JWT
    // unusable for the caller; the handoff keeps its own bounded retry.
    if (result.status === 'ok' || result.status === 'handoff_pending') {
      return { ok: true, access_token: result.token };
    }
    // Superseded means a newer login/logout won the race while this
    // refresh was in flight — the store, not this exchange, holds the
    // truth. Report the current session instead of a false failure.
    if (result.status === 'superseded') {
      const current = getAccessToken();
      if (current) return { ok: true, access_token: current };
    }
    return { ok: false, reason: `Token refresh failed (${result.status}).` };
  });

  // Select an active-organization JWT, then hand it to the sidecar’s runtime holder.
  // Refresh keeps it current; no device key is minted.
  ipcMain.handle(IPC.MINDSHUB_FINALIZE, async (_e, organizationId?: string, chosenByUser?: boolean) => {
    const token = getAccessToken();
    if (!token) {
      console.error('[mindshub:finalize] no cached access token — login may not have completed');
      return { ok: false, reason: 'No cached MindsHub access token.' };
    }
    // Treat chosenByUser as a strict boolean separate from the ID; a remembered ID is not a new
    // user choice.
    const selected = await selectEntitledOrg(token, {
      preferOrgId: organizationId,
      chosenByUser: chosenByUser === true,
    });
    if (!selected.token) {
      console.error('[mindshub:finalize] could not select an organization:', selected.error);
      return { ok: false, reason: selected.error || 'Could not select a MindsHub organization.' };
    }
    /*
     * Await a prior sign-out restart before handing over another user’s credential.
     * This wait is bounded; commitMindsSignIn still ensures a live sidecar under the lifecycle
     * queue.
     */
    const flushWait = await awaitSignOutSidecarFlush(SIGN_OUT_FLUSH_SIGN_IN_WAIT_MS);
    if (flushWait === 'timeout') {
      console.warn('[mindshub:finalize] sign-out sidecar restart still running; continuing');
    }
    try {
      await commitMindsSignIn();
    } catch (err: any) {
      console.error('[mindshub:finalize] commitMindsSignIn failed:', err);
      return { ok: false, reason: `Failed to save MindsHub settings: ${err?.message || err}` };
    }
    // The organization the presented token names. The ranking asks for one and
    // the entitlement hunt can still move it — but never past an explicit
    // pick — so onboarding names this rather than what it requested.
    return { ok: true, organization: selected.organization };
  });

  // Read organizations in main because Keycloak’s CORS policy does not admit the Cowork renderer.
  ipcMain.handle(IPC.MINDSHUB_LIST_ORGS, () => listMindsOrgs());

  // Move this install to another organization: switch the session, mint and
  // commit a key there, remember the pick, and retire the key left behind.
  ipcMain.handle(IPC.MINDSHUB_SWITCH_ORG, (_e, organizationId: string) =>
    switchMindsOrg(String(organizationId || '')));

  // Returns the in-memory access token if one is cached (e.g. boot-
  // time silent refresh already succeeded). Lets the Onboarding page
  // skip a redundant PKCE round-trip for returning users.
  ipcMain.handle(IPC.MINDSHUB_GET_CACHED_TOKEN, () => {
    return { access_token: getAccessToken() };
  });

  // Store (or clear) a MindsHub key the user supplied by hand and hand it to
  // the sidecar. The renderer sends it here rather than writing it as a
  // setting, so BYOK does not put a long-lived bearer back on disk.
  ipcMain.handle(IPC.MINDSHUB_SET_USER_KEY, async (_evt, rawKey: unknown) => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    try {
      // Report actual sidecar acceptance; otherwise the renderer may believe a key was saved when
      // no store holds it.
      const handedOver = key
        ? await setUserSuppliedMindsKey(key)
        : await clearUserSuppliedMindsKey();
      if (!handedOver) {
        return { ok: false, reason: 'Saved the key, but the local server did not take it. Try again in a moment.' };
      }
      return { ok: true };
    } catch (err: any) {
      console.error('[mindshub:set-user-key] failed:', err);
      return { ok: false, reason: err?.message || 'Could not save the MindsHub key.' };
    }
  });

  // Refresh on a missing/expired in-memory token so startup or sleep does not misreport a persisted
  // session as signed out.
  ipcMain.handle(IPC.AUTH_GET_ACCESS_TOKEN, () => freshAccessToken());

  ipcMain.handle(IPC.AUTH_LOGOUT, performMindsSignOut);

  ipcMain.handle(IPC.INSTALL_CANCEL, async () => {
    if (!activeInstall) return false;
    activeInstall.cancelled = true;
    return true;
  });

  ipcMain.handle(IPC.SETTINGS_READ, async () => {
    return readEnvFile();
  });

  ipcMain.handle(IPC.SERVER_RESTART, async () => {
    console.log('[server] restart requested');
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

  // Legacy keychain preference bridge; token-store.ts owns the current platform-specific storage
  // behavior.
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

  ipcMain.handle(IPC.BOOT_AWAIT_READY, async () => {
    // The renderer holds the loading screen across this await, so a boot update
    // has already reinstalled/reloaded before the UI routes into the app (ENG-749).
    await awaitBootSettled([bootServerSettled, bootUpdateSettled]);
    return { ready: true };
  });

  ipcMain.handle(
    IPC.SETTINGS_VALIDATE,
    async (_event, provider: string, apiKey: string, baseUrl?: string, model?: string) => {
      if (provider === 'anthropic') {
        return validateAnthropic(apiKey, model || 'claude-sonnet-4-6', httpRequest);
      } else if (provider === 'minds') {
        return validateMinds(apiKey, baseUrl || MINDS_API_HOST, httpRequest);
      } else if (provider === 'openai-compatible') {
        return validateOpenAICompatible(apiKey, baseUrl || 'https://api.openai.com/v1', model, httpRequest);
      }
      return { ok: false, error: 'Unknown provider' };
    }
  );

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    const browserUrl = normalizeExternalBrowserUrl(url);
    if (browserUrl) await shell.openExternal(browserUrl);
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

  // Native directory selection for the first-class Code workspace. The
  // renderer receives only the user-selected path; filesystem access and Git
  // orchestration remain in the local sidecar.
  ipcMain.handle(IPC.CODE_PICK_FOLDER, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'window unavailable' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder',
      // `createDirectory` exposes New Folder in the macOS panel;
      // `promptToCreate` provides the equivalent typed-path flow on Windows.
      // The native default confirmation label (Open) matches both platforms.
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    return { ok: true, path: path.resolve(result.filePaths[0]) };
  });

  ipcMain.handle(IPC.CODING_DETECT_CLI, async () => {
    return detectClaudeCode();
  });

  ipcMain.handle(IPC.CODING_TERMINAL_START, async (event, taskId: string, opts: { projectPath: string; message: string; model: string }, cols: number, rows: number) => {
    return startCodingTerminal(taskId, opts, cols, rows, event.sender);
  });

  ipcMain.handle(IPC.CODING_TERMINAL_INPUT, async (_event, taskId: string, data: string) => {
    writeToCodingTerminal(taskId, data);
  });

  ipcMain.handle(IPC.CODING_TERMINAL_RESIZE, async (_event, taskId: string, cols: number, rows: number) => {
    resizeCodingTerminal(taskId, cols, rows);
  });

  ipcMain.handle(IPC.CODING_TERMINAL_IS_RUNNING, async (_event, taskId: string) => {
    return isCodingTerminalRunning(taskId);
  });

  ipcMain.handle(IPC.CODING_TERMINAL_KILL, async (_event, taskId: string) => {
    killCodingTerminal(taskId);
  });

  ipcMain.handle(IPC.CODING_REMOVE_TASK, async (_event, taskId: string, projectPath: string) => {
    await removeCodingTask(taskId, projectPath);
  });

  ipcMain.handle(IPC.APP_UI_VERSION, async () => {
    // Report the OTA version or null; the renderer falls back to its baked version and displays the
    // source.
    const uiVersion = getCachedVersion();
    return {
      app: getAppDisplayVersion(),
      ui: uiVersion,
      source: uiVersion ? 'ota' : 'bundled',
      // Which update ring this install is on — staging-ring builds
      // (preview/stable) legitimately run rc server versions, and without
      // this in the About panel such reports look like corruption.
      buildKind: buildKind(),
    };
  });

  // Register UI/server update IPC handlers unconditionally so the renderer
  // can check/apply in any build (dev, unpackaged, server-down). The gated
  // boot/periodic polling is started separately by initUpdater().
  registerUpdateHandlers(() => mainWindow);
}

// Purge old HTTP cache once per app version to remove credentials cached by older builds.
// Current secret responses use no-store, which cannot remove existing cached entries.
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

  // Refresh after resume because sleep can outlast the token and timer; powerMonitor requires app
  // readiness.
  powerMonitor.on('resume', () => {
    void refreshMindsCredentialAfterResume();
  });

  // Isolate this channel's uv tool install (cowork-server binary + venv) so
  // build kinds on one machine don't share one binary. Must run before the
  // installer's presence check and before the server starts.
  applyChannelUvIsolation();

  // Report channel/API mismatches so a misconfigured non-prod build cannot silently target
  // production.
  {
    const c = checkChannelConsistency(buildKind(), MINDS_API_HOST);
    if (!c.ok) {
      console.warn(
        `[channels] BUILD/ENV MISMATCH: build kind "${c.kind}" expects the ` +
          `"${c.expectedSlug || 'prod'}" backend (${c.expectedApiHost}) but this build ` +
          `points at "${c.actualSlug || 'prod'}" (${c.actualApiHost}). ` +
          `Check the CI minds_api_url / build_kind inputs.`,
      );
    } else {
      console.log(`[channels] build kind "${c.kind}" → ${c.actualApiHost} (consistent)`);
    }
  }

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

  /* Expose Help on every platform; use an app menu on macOS and File/Quit elsewhere. */
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            {
              label: 'About MindsHub Cowork',
              click: async () => {
                // Use the newest UI/server/agent release week as the headline; report shell and
                // component versions separately.
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
            /*
             * Reveal Logs needs an existing path; before the first server start, create and open
             * the logs directory.
             */
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

  // Resolve bootServerSettled after startup succeeds, fails or is skipped, before slower OTA
  // checks.
  let resolveBootServer: () => void = () => {};
  bootServerSettled = new Promise<void>((resolve) => { resolveBootServer = resolve; });
  // Bounded by primeLoginShellPath()'s own timeout — checkInstallStatus and
  // the server spawn below both resolve uv through the PATH it caches.
  await primeLoginShellPath();
  // Boot-update barrier (ENG-749): resolved once the boot poll finishes, or
  // immediately below when no updater runs. `bootUpdateDone` is idempotent.
  let resolveBootUpdate: () => void = () => {};
  bootUpdateSettled = new Promise<void>((resolve) => { resolveBootUpdate = resolve; });
  const bootUpdateDone = () => resolveBootUpdate();
  checkInstallStatus().then(async ({ antonInstalled }) => {
    if (!antonInstalled) {
      console.log('[server] skipped: cowork-server not installed; setup screen will handle.');
      resolveBootServer();
      bootUpdateDone();  // no boot poll on this path — don't strand the gate
      return;
    }
    // Refresh persisted SSO at boot. Only invalid_grant clears auth; transient failures retain
    // tokens and retry.
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
      } else if (outcome.status === 'handoff_pending') {
        // Expected at boot: the sidecar starts below, and its start hook pushes.
        console.log('[auth] boot token refreshed — sidecar gets it when it starts');
      } else if (outcome.status !== 'ok') {
        console.warn(`[auth] boot token refresh skipped (${outcome.status}) — keeping session`);
      }
    }

    let result = await startServer();
    if (!result.ok) {
      // Repair unsupported Python, then broken install signatures; reinstall from the original
      // source and retry start.
      console.error(`[server] start failed (${result.reason}); attempting recovery`);

      const recreated = await recreateVenvIfUnsupportedPython();
      if (recreated) {
        console.log('[server] recreated venv on a supported Python; retrying start');
        result = await startServer();
      }

      // Reinstall only for a broken-environment crash signature, not migration/port/config errors.
      // Skip when interpreter recreation already performed a clean install.
      const failureLog = getServerDiagnostics().recentLog;
      if (!result.ok && !recreated && await repairServerInstall(failureLog)) {
        console.log('[server] repaired the server environment; retrying start');
        result = await startServer();
      }
    }
    if (result.ok) {
      console.log(`[server] running on http://127.0.0.1:${result.port}`);
      // Resume refresh loops for Google OAuth connections already in the
      // vault from prior sessions — fire-and-forget, failures are per-entry.
      startOrphanRefreshLoops().catch(() => {});
    } else {
      console.error(`[server] start failed: ${result.reason}`);
    }
    /*
     * Use the legacy .env key as the migration marker and sign out to revoke/clear it.
     * The sidecar’s settings cannot distinguish stored legacy keys from the runtime credential
     * already handed over.
     */
    const migrating = Boolean(readEnvFile()['ANTON_MINDS_API_KEY']);
    if (migrating) {
      console.log('[minds-auth] this install still holds a minted device key — signing out to migrate');
      try {
        await performMindsSignOut();
        /* Boot must await sign-out’s restart before handing off credentials and releasing routing. */
        await awaitSignOutSidecarFlush(SERVER_START_CAP_MS);
      } catch (err) {
        console.warn('[minds-auth] migration sign-out failed; will retry next launch', err);
      }
      // Verify the legacy .env marker was actually removed; a failed best-effort scrub would repeat
      // sign-out every launch.
      if (readEnvFile()['ANTON_MINDS_API_KEY']) {
        console.error('[minds-auth] migration ran but ANTON_MINDS_API_KEY is still in .env — it will retry next launch');
      }
    }

    // Hand off credentials before releasing bootServerSettled, which routing reads before
    // awaitBootReady.
    // Include BYOK installs without a Keycloak session; bound the refresh/PUT so an unavailable IdP
    // cannot hang boot.
    if (!migrating) {
      await Promise.race([
        establishMindsCredential(refreshTokensOnly),
        new Promise<void>((resolve) => setTimeout(resolve, BOOT_CREDENTIAL_TIMEOUT_MS)),
      ]);
    }
    resolveBootServer();  // Release routing before OTA checks; the updater later re-verifies any constrained cache after
// server updates.

    // Start update checks even when the sidecar failed to boot. A server-down update is recovery,
    // including in manual mode.
    // Healthy installs retain their update preference and failed updates roll back.
    setUpdateNotifier((payload) => {
      mainWindow?.webContents.send(IPC.SERVER_UPDATE_STATUS, payload);
      // Mirror progress onto the UI status channel so the loading screen and
      // in-app overlay show it during a server download (ENG-749).
      const mirrored = serverPhaseToUiStatus(payload);
      if (mirrored) mainWindow?.webContents.send(IPC.UI_UPDATE_STATUS, mirrored);
    });

    const devMode = getDevMode();
    if (app.isPackaged && !devMode && mainWindow) {
      initUpdater(() => mainWindow, rendererReady, getUpdateMode, shellAutoUpdateEnabled(), bootUpdateDone);
    } else if (!app.isPackaged) {
      console.log('[updater] skipped — not a packaged build');
      bootUpdateDone();  // no boot poll → nothing for the loading gate to wait on
    } else if (devMode) {
      console.log(`[updater] skipped — DEV_MODE=${devMode}`);
      bootUpdateDone();
    } else {
      bootUpdateDone();  // no window to update against
    }
  }).catch((err) => {
    console.error('[server] check-and-start failed:', err);
    resolveBootServer();  // never leave checkConfigured() awaiting a stuck boot
    bootUpdateDone();     // ...or the loading gate awaiting a boot that never ran
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
        startRefreshLoop(engine, name, accountEmail, expiresAt, tokenUrl, oauthBlock?.token_auth_style);
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
  // Drain UI/server applies before quit-triggered shell installation swaps files outside the
  // maintenance gate.
  // Bound the wait so a wedged apply cannot prevent quitting.
  const applyDrained = await Promise.race([
    awaitUpdateMaintenanceIdle().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
  ]);
  if (!applyDrained) {
    console.warn('[updater] update-maintenance did not drain before the quit ceiling; an on-quit shell install may overlap an in-flight apply');
  }
  // Bound quit beyond the normal stop escalation; do not let an OS-level delay keep the app open
  // indefinitely.
  const stopped = await Promise.race([
    stopServer().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
  ]);

  // If a start still holds the lifecycle lock, the queued stop may never run before quit. Reap
  // directly, still bounded.
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

// Defer quit until the server drain finishes so its orphan cannot retain the port or a deleted
// bundle cwd.
// Re-enter app.quit afterward; _quitDrained prevents a second deferral.
app.on('before-quit', (event) => {
  if (_quitDrained) return;
  event.preventDefault();
  drainServerForQuit().finally(() => {
    app.quit();
  });
});
