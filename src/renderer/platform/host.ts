// Host platform abstraction for the cowork SPA.
//
// The cowork renderer ships in two shells:
//   - Electron (preload exposes window.antontron — full bridge)
//   - Web (vite SPA served by FastAPI — no bridge)
//
// Every cowork/* file MUST go through this module instead of touching
// `window.antontron` directly. This is enforced by a lint guard
// (`npm run check:cowork-purity`), which runs in CI.
//
// Web fallbacks are intentionally narrow: methods that have a sensible
// browser equivalent (openExternal → window.open) work; OS-level shell
// operations (openPath) return { ok: false, reason: 'unsupported' }
// so call sites can branch / hide affordances.

import type { ServerStartErrorKind } from '../../shared/server-status';

const ANTON_SERVER_PORT = 26866;

type Bridge = typeof window extends { antontron?: infer T } ? T : never;

const bridge: any =
  typeof window !== 'undefined' ? (window as any).antontron : undefined;

export const isElectron: boolean = typeof bridge === 'object' && bridge !== null;
export const isWeb: boolean = !isElectron;

// ---- Platform identity --------------------------------------------------

export type PlatformId = 'darwin' | 'win32' | 'linux' | 'web';

export function getPlatform(): PlatformId {
  if (isElectron && typeof bridge.getPlatform === 'function') {
    const p = bridge.getPlatform();
    if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  }
  return 'web';
}

export function isMac(): boolean {
  return getPlatform() === 'darwin';
}

// ---- API origin / OAuth redirect ---------------------------------------

// Where the cowork SPA addresses its FastAPI backend.
//   Electron (file:// or app://) → loopback at the port main resolved for
//     THIS OS user and handed us via preload (ENG-439). Falls back to the
//     legacy fixed port only if the bridge didn't supply one.
//   Web (http(s)://...)          → same origin (FastAPI serves the SPA).
export function getApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location?.protocol;
  if (protocol === 'file:' || protocol === 'app:') {
    const port = isElectron && typeof bridge.serverPort === 'number' ? bridge.serverPort : ANTON_SERVER_PORT;
    return `http://127.0.0.1:${port}`;
  }
  return window.location.origin;
}

// True when the FastAPI backend the SPA talks to lives on THIS machine
// (loopback). The deciding factor for "can I open a server-side file
// path locally?" — a server-returned filesystem path is only openable
// via the OS shell when the server is the local one. When the desktop
// app is pointed at a REMOTE Anton server, those paths live on that box,
// so callers must fetch the file over HTTP (the artifact `serveUrl`)
// instead of `openPath`. (Web's window.location.origin can itself be
// localhost in dev — callers still gate on `isElectron` since the web
// shell has no `openPath` regardless.)
export function isLocalApiOrigin(): boolean {
  try {
    const origin = getApiOrigin();
    if (!origin) return false;
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

// In Electron, OAuth runs through a loopback server spawned by main —
// there is no fixed redirect URI to register, so this returns null and
// callers should use oauthConnect() for the IPC PKCE flow instead.
//
// In web, OAuth must use a server-side redirect — this returns the
// stable callback URL the FastAPI backend exposes for that integration.
export function getOAuthRedirectUri(integration: string): string | null {
  if (isElectron) return null;
  return `${getApiOrigin()}/api/v1/oauth/callback/${integration}`;
}

// ---- Server lifecycle ---------------------------------------------------
//
// In Electron, main owns the FastAPI subprocess and exposes start/stop/info.
// In web, the FastAPI process IS the host — start/stop are meaningless;
// info reports the live origin so UI can render "running" state correctly.

export interface ServerInfo {
  running: boolean;
  starting: boolean;
  port: number | null;
  origin: string;
}

export async function serverInfo(): Promise<ServerInfo> {
  if (isElectron && typeof bridge.serverInfo === 'function') {
    const info = await bridge.serverInfo();
    return {
      running: !!info?.running,
      starting: !!info?.starting,
      port: info?.port ?? null,
      origin: info?.origin || `http://127.0.0.1:${info?.port ?? ANTON_SERVER_PORT}`,
    };
  }
  return {
    running: true,
    starting: false,
    port: window.location.port ? Number(window.location.port) : null,
    origin: window.location.origin,
  };
}

export async function serverStart(): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.serverStart === 'function') {
    return bridge.serverStart();
  }
  return { ok: false, reason: 'unsupported' };
}

export async function serverStop(): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.serverStop === 'function') {
    return bridge.serverStop();
  }
  return { ok: false, reason: 'unsupported' };
}

export interface ServerDiagnostics {
  running: boolean;
  starting: boolean;
  port: number | null;
  lastError: string | null;
  /** Discriminant for the failure the panel explains; null when healthy. */
  lastErrorKind: ServerStartErrorKind | null;
  /** PID holding the port after a failed start, when one was found. */
  portHolderPid: number | null;
  lastExitCode: number | null;
  lastStartAt: number | null;
  recentLog: string;
  /** True when the backend went down because the user asked it to. */
  lastStopIntentional: boolean | null;
}

export async function serverDiagnostics(): Promise<ServerDiagnostics> {
  if (isElectron && typeof bridge.serverDiagnostics === 'function') {
    return bridge.serverDiagnostics();
  }
  return {
    running: true,
    starting: false,
    port: window.location.port ? Number(window.location.port) : null,
    lastError: null,
    lastErrorKind: null,
    portHolderPid: null,
    lastExitCode: null,
    lastStartAt: null,
    recentLog: '',
    lastStopIntentional: null,
  };
}

// ---- OS shell -----------------------------------------------------------

export async function openExternal(url: string): Promise<void> {
  if (isElectron && typeof bridge.openExternal === 'function') {
    await bridge.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPath(path: string): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.openPath === 'function') {
    return bridge.openPath(path);
  }
  return { ok: false, reason: 'unsupported' };
}

export async function showItemInFolder(path: string): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.showItemInFolder === 'function') {
    return bridge.showItemInFolder(path);
  }
  return { ok: false, reason: 'unsupported' };
}

// ---- File drop / clipboard ---------------------------------------------

// In Electron, dropped files expose an OS path via webUtils. In web, the
// File object never has a real filesystem path — return null so callers
// can fall back to upload-by-content.
export function getPathForFile(file: File): string | null {
  if (isElectron && typeof bridge.getPathForFile === 'function') {
    try {
      return bridge.getPathForFile(file) || null;
    } catch {
      return null;
    }
  }
  return null;
}

// ---- App metadata -------------------------------------------------------

export async function getUIVersion(): Promise<string> {
  if (isElectron && typeof bridge.getUIVersion === 'function') {
    const v = await bridge.getUIVersion();
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return String(v.ui ?? v.app ?? 'unknown');
    return 'unknown';
  }
  return 'web';
}

export interface VersionInfo {
  /** Installed Electron shell (App) version — changes only on reinstall. */
  app: string;
  /** OTA-activated UI bundle version, or null when running the bundled UI. */
  ui: string | null;
  /** Where the running renderer came from. */
  source: 'bundled' | 'ota' | 'web';
}

/** Structured version facts for the unified version display (ENG-213). The
 *  renderer resolves the effective UI version as `ui ?? __APP_VERSION__`. */
export async function getVersionInfo(): Promise<VersionInfo> {
  if (isElectron && typeof bridge.getUIVersion === 'function') {
    const v = await bridge.getUIVersion();
    if (v && typeof v === 'object') {
      // Normalize across shell versions (an OTA renderer can run on an older
      // installed shell). Legacy shells return `ui: 'bundled'` (a sentinel,
      // not a version) and omit `source`. Treat that sentinel as null, and
      // when `source` is absent infer OTA only if a real UI version is present.
      const ui = v.ui != null && v.ui !== 'bundled' ? String(v.ui) : null;
      const source: VersionInfo['source'] =
        v.source === 'ota' || v.source === 'bundled' ? v.source : ui ? 'ota' : 'bundled';
      return { app: String(v.app ?? ''), ui, source };
    }
  }
  return { app: '', ui: null, source: 'web' };
}

// ---- Onboarding -------------------------------------------------------
//
// The cowork SPA mounts the same arcade onboarding screens (TermsScreen
// → SetupScreen → OnboardingScreen) under both shells. Electron handlers live in main and
// touch ~/.anton/.env directly. Web handlers are FastAPI endpoints in
// `server/routes/settings.py` that mirror the IPC shapes 1:1, so the
// React pages are shell-agnostic once they go through `host.*`.

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> || {}) };
  // Web: attach the Keycloak token as a Bearer header so the ingress auth
  // subrequest validates the caller (mirrors cowork/api.js authFetch). Electron
  // injects the loopback token in main, so nothing is added there.
  if (isWeb) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${getApiOrigin()}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch {}
    // Preserve the HTTP status on the error so callers can distinguish the
    // expected loopback-gate 403 (ENG-817) from real failures (4xx/5xx/network).
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function readSettings(): Promise<Record<string, string>> {
  if (isElectron && typeof bridge.readSettings === 'function') {
    return bridge.readSettings();
  }
  // Web: /settings/raw returns unmasked secrets and is loopback-gated
  // (ENG-457). In the console-hosted deployment the browser's request reaches
  // cowork-server from the docker bridge, not loopback, so the gate returns
  // 403 (ENG-817). The DB is authoritative, so for THAT expected 403 we degrade
  // to empty rather than aborting boot/onboarding. Any other failure (network,
  // 4xx/5xx, malformed) is a real error and must propagate. (Electron reads via
  // the IPC bridge above, unaffected.)
  try {
    return await fetchJson('/api/v1/settings/raw');
  } catch (e) {
    if ((e as { status?: number }).status === 403) return {};
    throw e;
  }
}

export async function saveSettings(content: string): Promise<boolean> {
  if (isElectron && typeof bridge.saveSettings === 'function') {
    return bridge.saveSettings(content);
  }
  // Web: the .env write (/settings/raw) is loopback-gated (ENG-457/ENG-817), so
  // the expected 403 from the gate is best-effort — return false for it instead
  // of aborting (the DB write via PUT /settings/:key is the authoritative store).
  // Any OTHER failure (network, 4xx/5xx) is a real persistence error and must
  // propagate, so onboarding can't report success over a failed write.
  try {
    await fetchJson('/api/v1/settings/raw', { method: 'POST', body: JSON.stringify({ content }) });
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 403) return false;
    throw e;
  }
}

export async function restartServer(): Promise<void> {
  if (isElectron && typeof bridge.restartServer === 'function') {
    await bridge.restartServer();
  }
  // Web deployments don't need a restart — the server reads .env on
  // each request in that context.
}

export interface InstallStatus {
  antonInstalled: boolean;
  serverDepsReady: boolean;
}

export async function checkInstall(): Promise<InstallStatus> {
  if (isElectron && typeof bridge.checkInstall === 'function') {
    return bridge.checkInstall();
  }
  return fetchJson('/api/v1/settings/install-status');
}

export async function checkConfigured(): Promise<{ configured: boolean; provider: string }> {
  if (isElectron && typeof bridge.checkConfigured === 'function') {
    return bridge.checkConfigured();
  }
  // Web: read config_ready from /health — the SAME signal the in-app chat gate
  // uses — so onboarding-vs-app routing can't disagree with the chat gate.
  const h = await fetchJson('/api/v1/health/') as { config_ready?: boolean; provider?: string };
  return { configured: Boolean(h.config_ready), provider: h.provider ?? '' };
}

export async function validateProvider(
  provider: string,
  apiKey: string,
  baseUrl?: string,
  model?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (isElectron && typeof bridge.validateProvider === 'function') {
    return bridge.validateProvider(provider, apiKey, baseUrl, model);
  }
  return fetchJson('/api/v1/settings/validate-provider', {
    method: 'POST',
    body: JSON.stringify({ provider, apiKey, baseUrl, model }),
  });
}

// ---- Setup-screen install lifecycle (Electron-only) -------------------
//
// The Setup page subscribes to a streaming install of the anton CLI +
// python deps. On web there is no install — the FastAPI host running
// this code IS the install — so each subscriber fires synthetic
// "done" events synchronously and start/cancel are no-ops.

export interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'warning';
}

export async function startInstall(): Promise<void> {
  if (isElectron && typeof bridge.startInstall === 'function') {
    await bridge.startInstall();
  }
}

export async function cancelInstall(): Promise<void> {
  if (isElectron && typeof bridge.cancelInstall === 'function') {
    await bridge.cancelInstall();
  }
}

export function onInstallProgress(cb: (steps: InstallStep[]) => void): () => void {
  if (isElectron && typeof bridge.onInstallProgress === 'function') {
    return bridge.onInstallProgress(cb);
  }
  // Web: synthesise a single completed step so the steps panel renders
  // something meaningful instead of staying empty during the brief
  // pass-through.
  queueMicrotask(() => cb([{ id: 'server', label: 'Server is running', status: 'done' }]));
  return () => {};
}

export function onInstallLog(cb: (msg: string) => void): () => void {
  if (isElectron && typeof bridge.onInstallLog === 'function') {
    return bridge.onInstallLog(cb);
  }
  queueMicrotask(() => cb('Server is running.\n'));
  return () => {};
}

export function onInstallDone(cb: () => void): () => void {
  if (isElectron && typeof bridge.onInstallDone === 'function') {
    return bridge.onInstallDone(cb);
  }
  // Brief delay so the "installing" frame has a chance to render — the
  // user sees a beat of motion instead of the page snapping past Setup.
  const id = setTimeout(cb, 600);
  return () => clearTimeout(id);
}

export function onInstallError(cb: (err: string) => void): () => void {
  if (isElectron && typeof bridge.onInstallError === 'function') {
    return bridge.onInstallError(cb);
  }
  return () => {};
}

export function onInstallCancelled(cb: () => void): () => void {
  if (isElectron && typeof bridge.onInstallCancelled === 'function') {
    return bridge.onInstallCancelled(cb);
  }
  return () => {};
}

// ---- OTA updates (Electron-only) ---------------------------------------

export interface UpdateStatus {
  phase: string;
  version?: string;
}

// Subscribes to update-status pushes from the main process. Returns
// an unsubscribe function. Web returns a no-op unsubscriber.
export function onUpdateStatus(cb: (status: UpdateStatus) => void): () => void {
  if (isElectron && typeof bridge.onUpdateStatus === 'function') {
    return bridge.onUpdateStatus(cb);
  }
  return () => {};
}

export async function applyUpdate(): Promise<boolean> {
  if (isElectron && typeof bridge.applyUpdate === 'function') {
    return bridge.applyUpdate();
  }
  return false;
}

// ---- OAuth (Electron-only PKCE flow) -----------------------------------

export type OAuthConnectOpts =
  | { engine: string; name?: string }
  | { authUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scopes: string[]; extraAuthParams?: Record<string, string>; redirectPort?: number };

export interface OAuthConnectResult {
  ok: boolean;
  reason?: string;
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

// Electron: spawns a loopback PKCE flow via the main process and
// returns the resulting tokens.
// Web: not supported — callers should use getOAuthRedirectUri() and a
// server-side redirect flow instead.
export async function oauthConnect(opts: OAuthConnectOpts): Promise<OAuthConnectResult> {
  if (isElectron && typeof bridge.oauthConnect === 'function') {
    return bridge.oauthConnect(opts);
  }
  return { ok: false, reason: 'OAuth IPC flow is Electron-only — use redirect-based OAuth in web.' };
}

export async function keychainRevoke(engine: string, name: string, accountEmail: string): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.keychainRevoke === 'function') {
    return bridge.keychainRevoke({ engine, name, accountEmail });
  }
  return { ok: false, reason: 'keychainRevoke is Electron-only.' };
}

export interface DrivePickerFile {
  id: string;
  name: string;
  mimeType?: string;
  iconUrl?: string;
  url?: string;
  resourceKey?: string | null;
  /** Project(s) this file was explicitly added to — empty/absent when
   *  only ever picked from connection-details (no project context). */
  projects?: string[];
}

export interface FailedDrivePick {
  id: string;
  name: string;
  reason: string;
}

export interface DrivePickerResult {
  ok: boolean;
  reason?: string;
  /** The connection's full accumulated grant — every file ever picked. */
  files?: DrivePickerFile[];
  /** Only the file(s) the user selected in THIS picker session. */
  newFiles?: DrivePickerFile[];
  failed?: FailedDrivePick[];
}

// Electron-only: opens the Google Picker in the OS default browser (not
// embedded — Google's sign-in step gets blocked inside Electron the same
// way raw OAuth would) and resolves once the user picks files there or
// cancels. Needed because drive.file alone only grants the app access to
// files it created itself — the Picker is how a user grants access to
// existing files without widening the OAuth scope. `fileIds`, when
// known (e.g. from a pasted Drive link), pre-navigates the picker to
// those files for faster consent. `projectName`, when passed, tags any
// newly-picked files as belonging to that project (see DrivePickerFile);
// omit it for connection-details' "Pick files" button, which has no
// project context.
export async function pickDriveFiles(engine: string, name: string, accountEmail: string, fileIds?: string[], projectName?: string): Promise<DrivePickerResult> {
  if (isElectron && typeof bridge.oauthPickDriveFiles === 'function') {
    return bridge.oauthPickDriveFiles({ engine, name, accountEmail, fileIds, projectName });
  }
  return { ok: false, reason: 'Google Picker is Electron-only for now.' };
}

export async function cancelDrivePicker(): Promise<void> {
  if (isElectron && typeof bridge.oauthCancelPicker === 'function') {
    await bridge.oauthCancelPicker();
  }
}

export function onOAuthRefreshError(
  cb: (payload: { engine: string; name: string; accountEmail: string; permanent: boolean }) => void,
): () => void {
  if (isElectron && typeof bridge.onOAuthRefreshError === 'function') {
    return bridge.onOAuthRefreshError(cb);
  }
  return () => {};
}

// Tears down any in-flight loopback OAuth listener so the renderer's
// "Cancel login" button can abort the flow without waiting for the
// 5-minute server timeout.
export async function oauthCancel(): Promise<void> {
  if (isElectron && typeof bridge.oauthCancel === 'function') {
    await bridge.oauthCancel();
  }
}

// ── MindsHub onboarding bridge ──────────────────────────────────
// See main/index.ts for the rationale on the login/refresh/finalize
// split. Web shells return failure — MindsHub PKCE only runs in
// Electron; the web shell uses Keycloak redirect auth instead.

export interface MindsHubLoginResult {
  ok: boolean;
  reason?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function mindshubLogin(): Promise<MindsHubLoginResult> {
  if (isElectron && typeof bridge.mindshubLogin === 'function') {
    return bridge.mindshubLogin();
  }
  return { ok: false, reason: 'MindsHub login bridge is Electron-only.' };
}

// Sign-up through Keycloak's registration form, same loopback PKCE flow
// as mindshubLogin (ENG-917). The promise stays pending through the
// email-verification pause — resolve may arrive many minutes after call.
export async function mindshubSignup(): Promise<MindsHubLoginResult> {
  if (isElectron && typeof bridge.mindshubSignup === 'function') {
    return bridge.mindshubSignup();
  }
  return { ok: false, reason: 'MindsHub sign-up bridge is Electron-only.' };
}

export async function mindshubRefresh(): Promise<{ ok: boolean; reason?: string; access_token?: string }> {
  if (isElectron && typeof bridge.mindshubRefresh === 'function') {
    return bridge.mindshubRefresh();
  }
  return { ok: false, reason: 'MindsHub refresh bridge is Electron-only.' };
}

export async function mindshubFinalize(): Promise<{ ok: boolean; reason?: string; upgradeRequired?: boolean; apiKey?: string }> {
  if (isElectron && typeof bridge.mindshubFinalize === 'function') {
    return bridge.mindshubFinalize();
  }
  return { ok: false, reason: 'MindsHub finalize bridge is Electron-only.' };
}

export async function mindshubGetCachedToken(): Promise<string | null> {
  if (isElectron && typeof bridge.mindshubGetCachedToken === 'function') {
    const result = await bridge.mindshubGetCachedToken();
    return result?.access_token ?? null;
  }
  return null;
}

// Subscribe to MindsHub session-state changes pushed from the main
// process (login, silent refresh, logout, session death). Returns an
// unsubscribe function; no-op in the web shell.
export function onMindsHubAuthChanged(
  cb: (payload: { authenticated: boolean }) => void,
): () => void {
  if (isElectron && typeof bridge.onMindsHubAuthChanged === 'function') {
    return bridge.onMindsHubAuthChanged(cb);
  }
  return () => {};
}

// Where the refresh token is stored: macOS keychain (true) or a plaintext
// file under ~/.cowork (false). Electron-only — the web shell has no local
// token store, so both wrappers no-op to a safe default.
export async function getKeychainPref(): Promise<boolean> {
  if (isElectron && typeof bridge.getKeychainPref === 'function') {
    return (await bridge.getKeychainPref()).enabled;
  }
  return false;
}

export async function setKeychainPref(enabled: boolean): Promise<boolean> {
  if (isElectron && typeof bridge.setKeychainPref === 'function') {
    return (await bridge.setKeychainPref(enabled)).ok;
  }
  return false;
}

export async function getAccessToken(): Promise<string | null> {
  if (isElectron && typeof bridge.getAccessToken === 'function') {
    return bridge.getAccessToken();
  }
  const { getAccessToken: kcGetToken } = await import('../lib/keycloak');
  return kcGetToken();
}

// Signs the user out: clears the persisted refresh token and strips
// provider/auth keys from ~/.anton/.env. Caller is responsible for
// re-routing the UI — usually a full window.location.reload(), which
// puts App.tsx back through its boot path and (with the env keys gone)
// lands on onboarding.
export async function logout(): Promise<void> {
  if (isElectron && typeof bridge.logout === 'function') {
    await bridge.logout();
  }
}

// Re-export a single namespace for ergonomic call sites (`host.openPath(...)`).
export const host = {
  isWeb,
  isElectron,
  getPlatform,
  isMac,
  getApiOrigin,
  isLocalApiOrigin,
  getOAuthRedirectUri,
  serverInfo,
  serverStart,
  serverStop,
  serverDiagnostics,
  openExternal,
  openPath,
  showItemInFolder,
  getPathForFile,
  getUIVersion,
  getVersionInfo,
  readSettings,
  saveSettings,
  restartServer,
  checkInstall,
  checkConfigured,
  validateProvider,
  startInstall,
  cancelInstall,
  onInstallProgress,
  onInstallLog,
  onInstallDone,
  onInstallError,
  onInstallCancelled,
  onUpdateStatus,
  applyUpdate,
  oauthConnect,
  oauthCancel,
  mindshubLogin,
  mindshubSignup,
  mindshubRefresh,
  mindshubFinalize,
  mindshubGetCachedToken,
  onMindsHubAuthChanged,
  getKeychainPref,
  setKeychainPref,
  getAccessToken,
  logout,
  keychainRevoke,
  onOAuthRefreshError,
  pickDriveFiles,
  cancelDrivePicker,
};

export default host;
