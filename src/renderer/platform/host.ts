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

import type { MindsOrg } from '../../shared/minds-orgs';
import type { ServerStartErrorKind } from '../../shared/server-status';
import type { UpdateCheckSummary } from '../../shared/update-types';
import { parseCalVer, compareCalVer } from '../../shared/version';

const ANTON_SERVER_PORT = 26866;

// The release manifest (same URL main's ui-updater defaults to). Hardcoded on
// purpose: the renderer-side shell check exists precisely for shells too old to
// tell us the manifest URL over the bridge (ENG-1103).
const SHELL_MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

type Bridge = typeof window extends { antontron?: infer T } ? T : never;

const bridge: any =
  typeof window !== 'undefined' ? (window as any).antontron : undefined;

export const isElectron: boolean = typeof bridge === 'object' && bridge !== null;
export const isWeb: boolean = !isElectron;

// Static deployment capability. The user's opt-in is intentionally owned by
// the renderer and stored per device; this flag only answers whether this
// shell is allowed to offer Code at all. Web has no bridge, so hosted Cowork
// remains unavailable until a future cloud capability is deliberately added.
export const codeModeAvailable: boolean =
  isElectron && bridge.codeModeAvailable === true;

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
//   Electron (file:// or app://) → a custom server's full origin, when one is
//     configured (see custom-server.ts) — otherwise loopback at the port
//     main resolved for THIS OS user and handed us via preload (ENG-439),
//     falling back to the legacy fixed port only if the bridge didn't
//     supply one.
//   Web (http(s)://...)          → same origin (FastAPI serves the SPA).
export function getApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location?.protocol;
  if (protocol === 'file:' || protocol === 'app:') {
    if (isElectron && typeof bridge.customServerUrl === 'string' && bridge.customServerUrl) {
      return bridge.customServerUrl.replace(/\/+$/, '');
    }
    const port = isElectron && typeof bridge.serverPort === 'number' ? bridge.serverPort : ANTON_SERVER_PORT;
    return `http://127.0.0.1:${port}`;
  }
  return window.location.origin;
}

// Endpoint an outbound Code runtime connects to. In packaged Electron this
// matches getApiOrigin(); in Vite development the renderer itself lives on
// :5173, so use the actual sidecar port instead of handing a runtime the UI
// dev-server address. Hosted Code uses the current HTTPS origin.
export function getCodeControlPlaneOrigin(): string {
  if (isElectron) {
    if (typeof bridge.codeControlPlaneOrigin === 'string') {
      try {
        const configured = new URL(bridge.codeControlPlaneOrigin);
        if (
          (configured.protocol === 'http:' || configured.protocol === 'https:')
          && !configured.username
          && !configured.password
          && (configured.pathname === '/' || configured.pathname === '')
          && !configured.search
          && !configured.hash
        ) {
          return configured.origin;
        }
      } catch {
        // Fall through to the private local sidecar. The connection UI will
        // explain that loopback cannot be reached by another computer.
      }
    }
    const port = typeof bridge.serverPort === 'number' ? bridge.serverPort : ANTON_SERVER_PORT;
    return `http://127.0.0.1:${port}`;
  }
  return getApiOrigin();
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

export interface ServerControlResult {
  running: boolean;
  port?: number | null;
  error?: string;
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

export async function serverStart(): Promise<ServerControlResult> {
  if (isElectron && typeof bridge.serverStart === 'function') {
    return bridge.serverStart();
  }
  return { running: false, error: 'unsupported' };
}

export async function serverStop(): Promise<ServerControlResult> {
  if (isElectron && typeof bridge.serverStop === 'function') {
    return bridge.serverStop();
  }
  return { running: false, error: 'unsupported' };
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

export async function pickCodeFolder(): Promise<{
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  reason?: string;
}> {
  if (isElectron && typeof bridge.pickCodeFolder === 'function') {
    return bridge.pickCodeFolder();
  }
  return { ok: false, reason: 'Folder selection is available in the desktop app.' };
}

// ---- Coding mode (MVP) ---------------------------------------------------

export async function detectClaudeCode(): Promise<{ installed: boolean; path: string | null }> {
  if (isElectron && typeof bridge.detectClaudeCode === 'function') {
    return bridge.detectClaudeCode();
  }
  return { installed: false, path: null };
}

export async function startCodingTerminal(
  taskId: string,
  opts: { projectPath: string; message: string; model: string },
  cols: number,
  rows: number,
): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.startCodingTerminal === 'function') {
    return bridge.startCodingTerminal(taskId, opts, cols, rows);
  }
  return { ok: false, reason: 'unsupported' };
}

export function sendCodingTerminalInput(taskId: string, data: string): void {
  if (isElectron && typeof bridge.sendCodingTerminalInput === 'function') {
    bridge.sendCodingTerminalInput(taskId, data);
  }
}

export function resizeCodingTerminal(taskId: string, cols: number, rows: number): void {
  if (isElectron && typeof bridge.resizeCodingTerminal === 'function') {
    bridge.resizeCodingTerminal(taskId, cols, rows);
  }
}

export async function isCodingTerminalRunning(taskId: string): Promise<boolean> {
  if (isElectron && typeof bridge.isCodingTerminalRunning === 'function') {
    return bridge.isCodingTerminalRunning(taskId);
  }
  return false;
}

export function killCodingTerminal(taskId: string): void {
  if (isElectron && typeof bridge.killCodingTerminal === 'function') {
    bridge.killCodingTerminal(taskId);
  }
}

/** Stops a Claude-Code task's PTY (if running) and removes its git worktree
 *  and branch under `<projectPath>/.claude_tasks/<taskId>/` — call when the
 *  task itself is deleted. */
export async function removeCodingTask(taskId: string, projectPath: string): Promise<void> {
  if (isElectron && typeof bridge.removeCodingTask === 'function') {
    await bridge.removeCodingTask(taskId, projectPath);
  }
}

export function onCodingTerminalData(cb: (taskId: string, data: string) => void): () => void {
  if (isElectron && typeof bridge.onCodingTerminalData === 'function') {
    return bridge.onCodingTerminalData(cb);
  }
  return () => {};
}

export function onCodingTerminalExit(cb: (taskId: string, exitCode: number) => void): () => void {
  if (isElectron && typeof bridge.onCodingTerminalExit === 'function') {
    return bridge.onCodingTerminalExit(cb);
  }
  return () => {};
}

// Main-window hide/minimize (false) and show/restore/focus (true). The web
// build has no window to hide, so it never fires and stays visible.
export function onWindowVisibility(cb: (visible: boolean) => void): () => void {
  if (isElectron && typeof bridge.onWindowVisibility === 'function') {
    return bridge.onWindowVisibility(cb);
  }
  return () => {};
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
  /** The shell's build kind (update ring). Null on web and on legacy shells
   *  that predate the field — an OTA renderer can run on an older shell. */
  buildKind: 'dev' | 'preview' | 'stable' | 'prod' | null;
}

const BUILD_KINDS = ['dev', 'preview', 'stable', 'prod'] as const;

function normalizeBuildKind(value: unknown): VersionInfo['buildKind'] {
  return (BUILD_KINDS as readonly string[]).includes(value as string)
    ? (value as VersionInfo['buildKind'])
    : null;
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
      return { app: String(v.app ?? ''), ui, source, buildKind: normalizeBuildKind(v.buildKind) };
    }
  }
  return { app: '', ui: null, source: 'web', buildKind: null };
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
    if (token) {
      const { expectedOrganizationHeaders } = await import('../cowork/lib/organizationRequestBoundary');
      headers.Authorization = `Bearer ${token}`;
      Object.assign(headers, expectedOrganizationHeaders(token));
    }
  }
  const res = await fetch(`${getApiOrigin()}${path}`, {
    ...init,
    headers,
  });
  if (isWeb) {
    const { handleOrganizationBoundaryResponse } = await import('../cowork/lib/organizationRequestBoundary');
    if (handleOrganizationBoundaryResponse(res)) {
      throw new Error('The active organization changed; reload required');
    }
  }
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

// A hosted browser can never use `/settings/raw`: it's restricted to loopback
// (403) and refused outright in org mode (501). Both are expected, and the DB is
// the authoritative store, so reads/writes degrade instead of aborting boot.
// Any other status is a real error and must propagate.
function isExpectedRawGateStatus(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  return status === 403 || status === 501;
}

export async function readSettings(): Promise<Record<string, string>> {
  if (isElectron && typeof bridge.readSettings === 'function') {
    return bridge.readSettings();
  }
  try {
    return await fetchJson('/api/v1/settings/raw');
  } catch (e) {
    if (isExpectedRawGateStatus(e)) return {};
    throw e;
  }
}

export async function saveSettings(content: string): Promise<boolean> {
  if (isElectron && typeof bridge.saveSettings === 'function') {
    return bridge.saveSettings(content);
  }
  // `false` means "not persisted to the dotenv", not "onboarding failed".
  try {
    await fetchJson('/api/v1/settings/raw', { method: 'POST', body: JSON.stringify({ content }) });
    return true;
  } catch (e) {
    if (isExpectedRawGateStatus(e)) return false;
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

export async function checkConfigured(): Promise<{
  configured: boolean;
  provider: string;
  // Electron is desktop by definition, so the bridge path leaves this false.
  orgMode?: boolean;
}> {
  if (isElectron && typeof bridge.checkConfigured === 'function') {
    return bridge.checkConfigured();
  }
  // Web: read config_ready from /health — the SAME signal the in-app chat gate
  // uses — so onboarding-vs-app routing can't disagree with the chat gate.
  // `orgMode` separates a hosted org deployment from an authenticated
  // standalone one; config_ready can't express that.
  const h = await fetchJson('/api/v1/health/') as {
    config_ready?: boolean;
    provider?: string;
    org_mode?: boolean;
  };
  return {
    configured: Boolean(h.config_ready),
    provider: h.provider ?? '',
    orgMode: Boolean(h.org_mode),
  };
}

// Hold here until main reports the boot sequence has settled — the sidecar start
// decision plus the boot-time update poll (ENG-749). The caller stays on the
// loading screen across this await, so a boot update can't first flash the chat
// UI in a server-down state. The renderer deliberately races no timeout of its
// own: main resolves on the poll's real completion (see boot-gate.ts), and a
// shorter renderer cap could release the gate mid-reinstall. Web has no bridge →
// resolves at once; `.catch` guards an IPC-level rejection.
export async function awaitBootReady(): Promise<void> {
  if (!(isElectron && typeof bridge.awaitBootReady === 'function')) return;
  await Promise.resolve(bridge.awaitBootReady()).catch(() => {});
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

// installBackend defaults to true (main-process side) when omitted — pass
// false for the setup wizard's "Install backend server" checkbox unchecked.
export async function startInstall(installBackend?: boolean): Promise<void> {
  if (isElectron && typeof bridge.startInstall === 'function') {
    await bridge.startInstall(installBackend);
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
  // Set on the shell (installer) update notice (phase 'shell-available',
  // ENG-849): the running shell version and the installer download URL.
  currentVersion?: string;
  downloadUrl?: string;
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

export interface ShellUpdate {
  version: string; // newest published shell (installer) CalVer
  currentVersion?: string;
  downloadUrl?: string;
}

// Resolve the shell (installer) update notice.
//
// New shells (ENG-849): pull the last-known status from main. The notice is
// normally pushed via onUpdateStatus('shell-available'), but an OTA reload
// re-mounts the renderer and drops that push; re-pulling on mount re-surfaces a
// pending reinstall.
//
// Old shells (ENG-1103): a shell that predates the getShellUpdate bridge never
// pushes or serves the notice, so a user stranded on it would never be told a
// newer app version exists — even while their UI keeps hot-updating over OTA.
// This code rides that OTA bundle, so on those shells we fall back to a
// renderer-side check: fetch the manifest ourselves and compare shellVersion
// against the installed app version. New shells never take this path (they have
// the bridge), so there's no double-notify. Web has no shell → null.
export async function getShellUpdate(): Promise<ShellUpdate | null> {
  if (isElectron && typeof bridge.getShellUpdate === 'function') {
    const s = await bridge.getShellUpdate();
    return s?.available && s.latestVersion
      ? { version: s.latestVersion, currentVersion: s.currentVersion, downloadUrl: s.downloadUrl ?? undefined }
      : null;
  }
  if (isElectron) return shellUpdateFromManifest();
  return null;
}

// Renderer-side shell-update check for old shells (ENG-1103). Fetches the
// release manifest directly (the CSP in index.html allows the manifest host)
// and reports a reinstall only when the published shell is strictly newer by
// CalVer than the installed app version — failing closed on any fetch error,
// missing/absent shellVersion, or a non-CalVer version (e.g. a dev/SemVer
// build). No installer URL is returned: computing the exact per-platform link
// needs the build kind, which an old shell doesn't expose, so the Download
// action falls back to the downloads site.
async function shellUpdateFromManifest(): Promise<ShellUpdate | null> {
  try {
    const res = await fetch(SHELL_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data?.shellVersion ?? data?.shell_version
      ?? (data?.shell && typeof data.shell === 'object' ? data.shell.version : undefined);
    if (typeof latest !== 'string' || !latest) return null;
    const { app: installed } = await getVersionInfo();
    const l = parseCalVer(latest);
    const i = parseCalVer(installed);
    if (!l || !i || compareCalVer(l, i) <= 0) return null;
    return { version: latest, currentVersion: installed };
  } catch {
    return null;
  }
}

function mergeShellUpdate(
  summary: UpdateCheckSummary,
  shell: ShellUpdate | null,
): UpdateCheckSummary {
  if (!shell) return summary;
  return {
    ...summary,
    ok: true,
    offline: false,
    updateAvailable: true,
    shellUpdateAvailable: true,
    shellVersion: shell.version,
    ...(shell.downloadUrl ? { shellDownloadUrl: shell.downloadUrl } : {}),
  };
}

export interface ShellAutoUpdateSnapshot {
  phase: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' |
    'ready-to-install' | 'installing' | 'complete' | 'failed';
  mode: 'auto' | 'manual';
  channel: 'prod' | 'stable' | 'preview';
  currentVersion: string;
  targetVersion?: string;
  progress?: { transferred: number; total: number; percent: number; bytesPerSecond?: number };
  recoverable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  disabledReason?: string;
}

const DISABLED_SHELL_AUTO_UPDATE: ShellAutoUpdateSnapshot = {
  phase: 'disabled',
  mode: 'manual',
  channel: 'preview',
  currentVersion: '',
  disabledReason: 'unavailable',
};

export async function getShellAutoUpdate(): Promise<ShellAutoUpdateSnapshot> {
  if (isElectron && typeof bridge.getShellAutoUpdate === 'function') {
    return bridge.getShellAutoUpdate();
  }
  return DISABLED_SHELL_AUTO_UPDATE;
}

export function onShellAutoUpdate(cb: (snapshot: ShellAutoUpdateSnapshot) => void): () => void {
  if (isElectron && typeof bridge.onShellAutoUpdate === 'function') {
    return bridge.onShellAutoUpdate(cb);
  }
  return () => {};
}

export async function checkShellAutoUpdate(): Promise<ShellAutoUpdateSnapshot> {
  if (isElectron && typeof bridge.checkShellAutoUpdate === 'function') {
    return bridge.checkShellAutoUpdate();
  }
  return DISABLED_SHELL_AUTO_UPDATE;
}

export async function downloadShellAutoUpdate(): Promise<ShellAutoUpdateSnapshot> {
  if (isElectron && typeof bridge.downloadShellAutoUpdate === 'function') {
    return bridge.downloadShellAutoUpdate();
  }
  return DISABLED_SHELL_AUTO_UPDATE;
}

export async function installShellAutoUpdate(): Promise<boolean> {
  if (isElectron && typeof bridge.installShellAutoUpdate === 'function') {
    return bridge.installShellAutoUpdate();
  }
  return false;
}

// On-demand check for a newer UI, server, or shell version. Detection only —
// never applies; call applyUpdate() (UI/server) or download the installer
// (shell). Electron-only: the web app has no updater (hosted instances update
// via redeploy, ENG-852), so it resolves to a benign "up to date" and the
// Settings control is hidden there.
export async function checkForUpdates(): Promise<UpdateCheckSummary> {
  if (isElectron && typeof bridge.checkForUpdate === 'function') {
    const reply = await bridge.checkForUpdate();
    if (reply && typeof reply === 'object' && 'ok' in reply) {
      return reply;
    }

    // An OTA-updated renderer can still be hosted by an older Electron shell,
    // whose UI_UPDATE_CHECK reply predates the unified UI/server/shell summary.
    // Normalize that UI-only shape so Settings does not mistake a missing `ok`
    // field for a failed check. The old reply cannot report shell updates, so
    // merge the renderer-side manifest result as well; otherwise a manual check
    // would override the mount-time notice and incorrectly say "up to date."
    const uiUpdateAvailable = !!reply?.updateAvailable;
    const summary: UpdateCheckSummary = {
      ok: true,
      offline: false,
      updateAvailable: uiUpdateAvailable,
      uiUpdateAvailable,
      serverUpdateAvailable: false,
      shellUpdateAvailable: false,
      ...(typeof reply?.newVersion === 'string' ? { uiVersion: reply.newVersion } : {}),
    };
    return mergeShellUpdate(summary, await getShellUpdate());
  }
  const summary: UpdateCheckSummary = {
    ok: true,
    offline: false,
    updateAvailable: false,
    uiUpdateAvailable: false,
    serverUpdateAvailable: false,
    shellUpdateAvailable: false,
  };
  return isElectron
    ? mergeShellUpdate(summary, await getShellUpdate())
    : summary;
}

// ---- OAuth (Electron-only PKCE flow) -----------------------------------

export type OAuthConnectOpts =
  | { engine: string; name?: string }
  | { authUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scopes: string[]; extraAuthParams?: Record<string, string>; redirectPort?: number; tokenAuthStyle?: 'body' | 'basic' };

export interface OAuthConnectResult {
  ok: boolean;
  code?: 'oauth_credentials_missing';
  reason?: string;
  name?: string;
  account_email?: string;
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
// Web: cancels the in-flight pick (hides its widget and resolves it) — a
// settled call's finish() already no-ops, so calling this is always safe.
let webPickerCancelPrevious: (() => void) | null = null;

const GOOGLE_API_SRC = 'https://apis.google.com/js/api.js';

// How long a picker may sit without reporting anything before it is treated
// as stuck. Deliberately far above any real pick: it can only ever be a
// backstop, never a deadline (see its use below).
const PICKER_STUCK_TIMEOUT_MS = 5 * 60 * 1000;

// Same shape check Electron runs before its own pick
// (drive-picker-service.ts's DRIVE_FILE_ID_RE) — kept in step so one public
// pickDriveFiles() does not validate on one shell and not the other.
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

function validDriveFileIds(fileIds: string[] | undefined): boolean {
  if (fileIds === undefined) return true;
  return Array.isArray(fileIds) && fileIds.every((id) => typeof id === 'string' && DRIVE_FILE_ID_RE.test(id));
}

// Narrow shapes for the parts of Google's Picker SDK this file touches. The
// SDK ships no types of its own and is reached through `window`, so without
// these every call below would be `any` — and this module's one sanctioned
// `any` is the platform-bridge cast at the top of the file.
interface GooglePickerDoc {
  id: string;
  name: string;
  mimeType?: string;
  iconUrl?: string;
  url?: string;
  resourceKey?: string | null;
}
interface GooglePickerCallbackData {
  action: string;
  docs?: GooglePickerDoc[];
}
interface GooglePickerDocsView {
  setFileIds(ids: string[]): GooglePickerDocsView;
  setOwnedByMe(owned: boolean): GooglePickerDocsView;
  setEnableDrives(enabled: boolean): GooglePickerDocsView;
}
interface GooglePickerBuilder {
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(appId: string): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  enableFeature(feature: unknown): GooglePickerBuilder;
  addView(view: GooglePickerDocsView): GooglePickerBuilder;
  setCallback(cb: (data: GooglePickerCallbackData) => void): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
interface GooglePickerApi {
  PickerBuilder: new () => GooglePickerBuilder;
  DocsView: new (viewId: unknown) => GooglePickerDocsView;
  ViewId: { DOCS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES: unknown };
  Action: { PICKED: string; CANCEL: string; ERROR: string };
}
interface GoogleApiWindow {
  gapi?: { load(module: string, opts: { callback: () => void; onerror?: () => void }): void };
  google?: { picker: GooglePickerApi };
}

function googleApiWindow(): GoogleApiWindow {
  return window as unknown as GoogleApiWindow;
}

// Google's Picker SDK, loaded once into the SPA's own page. Cached per page
// load; a REJECTED load is deliberately NOT cached, so a transient network
// failure can be retried by picking again instead of poisoning the picker for
// the rest of the session.
let googlePickerSdk: Promise<void> | null = null;

function loadGooglePickerSdk(): Promise<void> {
  if (googlePickerSdk) return googlePickerSdk;
  googlePickerSdk = new Promise<void>((resolve, reject) => {
    const unreachable = () => reject(new Error('Could not reach Google to load the file picker.'));
    const loadPickerModule = () => {
      const gapi = googleApiWindow().gapi;
      if (!gapi) { unreachable(); return; }
      // api.js only bootstraps the loader — the picker module itself is a
      // second, separate fetch that can fail on its own.
      gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Google Picker could not be loaded.')),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_API_SRC}"]`);
    if (existing) {
      if (googleApiWindow().gapi) loadPickerModule();
      else {
        existing.addEventListener('load', loadPickerModule, { once: true });
        existing.addEventListener('error', unreachable, { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = GOOGLE_API_SRC;
    script.async = true;
    script.addEventListener('load', loadPickerModule, { once: true });
    script.addEventListener('error', unreachable, { once: true });
    document.head.appendChild(script);
  }).catch((err) => {
    googlePickerSdk = null;
    throw err;
  });
  return googlePickerSdk;
}

// Persist the grant. The drive.file scope only covers files this app created
// itself, so a connection's `_picked_files` list is the record of what else
// the user explicitly granted — and it is what the agent's own prompt is
// built from (cowork-server's picked_files_by_project). Mirrors Electron's
// savePickedFiles (main/picked-files.ts), including its rule: a failure here
// means NOTHING was persisted, so the caller must not report the pick as
// successful or the UI shows files as granted that the server never recorded.
async function persistPickedFiles(
  engine: string, name: string, files: DrivePickerFile[], projectName?: string,
): Promise<DrivePickerFile[]> {
  const body = files.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    iconUrl: f.iconUrl,
    url: f.url,
    resourceKey: f.resourceKey ?? null,
    projects: projectName ? [projectName] : [],
  }));
  const merged = await fetchJson(
    `/api/v1/connectors/connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}/picked-files`,
    { method: 'PATCH', body: JSON.stringify({ files: body }) },
  );
  return (merged?.files as DrivePickerFile[]) || files;
}

// Web equivalent of the Electron flow above. The Picker renders as an in-page
// overlay in this same, already-authenticated document — it is never a
// top-level navigation to a Google domain — so everything here is a normal
// fetch() carrying the caller's own Bearer header. That removes every failure
// mode the previous popup handoff had: a browser-blocked popup, a click
// activation that expired during an await, and a header-less navigation whose
// token had to be smuggled through an opaque server-side ticket.
async function pickDriveFilesWeb(
  engine: string, name: string, accountEmail: string, fileIds?: string[], projectName?: string,
): Promise<DrivePickerResult> {
  if (!validDriveFileIds(fileIds)) {
    return { ok: false, reason: 'Invalid Google Drive file id.' };
  }
  let creds: { access_token: string; api_key: string; app_id: string; account_email?: string };
  try {
    creds = await fetchJson(`/api/v1/connectors/oauth/${encodeURIComponent(engine)}/picker/token`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message || 'Could not start the file picker.' };
  }

  try {
    await loadGooglePickerSdk();
  } catch (err) {
    // Deliberately ok:false, where Electron and the replaced picker page both
    // reported a load failure as ok:true with no files. That is not a change
    // of intent — both of those rendered a visible "Could not load Google
    // Picker" card of their own first, so the user still saw the failure and
    // the ok:true only avoided reporting it twice. This flow has no page of
    // its own to show anything on, so ok:true here would mean the user clicks
    // "add files" and silently nothing happens. Returning the reason is what
    // preserves the old behaviour the user actually experienced.
    return { ok: false, reason: (err as Error)?.message || 'Could not load the file picker.' };
  }

  const picker = googleApiWindow().google!.picker;
  const account = creds.account_email || accountEmail;
  const picked = await new Promise<DrivePickerResult>((resolve) => {
    let settled = false;
    const finish = (result: DrivePickerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(stuckTimer);
      resolve(result);
    };

    // Backstop for the one failure the callback below cannot see. When the
    // widget's iframe renders a static Google 403 (usually an active-account
    // mismatch) there is no picker JS inside it, so PICKED/CANCEL/ERROR never
    // fire and this promise would otherwise never settle. The popup flow this
    // replaces survived that only because the user could close the window;
    // in-page there is nothing to close, so the wait has to be bounded here.
    // There is no Action.LOADED, so a widget the user is simply still
    // browsing is indistinguishable from a stuck one — hence a bound far
    // longer than any real pick rather than a tight one.
    const stuckTimer = setTimeout(() => {
      try { widget?.setVisible(false); } catch { /* already disposed */ }
      finish({
        ok: false,
        reason: `Google Picker did not respond — the browser’s active Google account may not match ${account}.`,
      });
    }, PICKER_STUCK_TIMEOUT_MS);
    // A newer pick supersedes one still on screen — same intent the popup
    // flow had, without the window bookkeeping.
    webPickerCancelPrevious?.();
    let widget: { setVisible(visible: boolean): void } | undefined;
    webPickerCancelPrevious = () => {
      try { widget?.setVisible(false); } catch { /* already disposed */ }
      finish({ ok: false, reason: 'cancelled' });
    };

    const builder = new picker.PickerBuilder()
      .setOAuthToken(creds.access_token)
      .setDeveloperKey(creds.api_key)
      .setAppId(creds.app_id)
      .setTitle(`Choose files from ${account}`)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const files: DrivePickerFile[] = (data.docs || []).map((doc) => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            iconUrl: doc.iconUrl,
            url: doc.url,
            resourceKey: doc.resourceKey || null,
          }));
          finish({ ok: true, files, newFiles: files });
        } else if (data.action === picker.Action.CANCEL) {
          // Matches Electron's own /result handler: a Cancel click is a
          // successful pick of nothing, never an error.
          finish({ ok: true, files: [], newFiles: [] });
        } else if (data.action === picker.Action.ERROR) {
          // Without this branch an in-widget error settles nothing and the
          // pick hangs forever. Overwhelmingly this is an active-account
          // mismatch: the widget renders under whichever Google account is
          // ambient in the browser, not the one this token is scoped to, and
          // 403s. Same diagnosis the replaced picker page reported.
          finish({
            ok: false,
            reason: `Google Picker could not open — the browser’s active Google account may not match ${account}.`,
          });
        }
      });

    // Pre-navigate to specific files when the caller already knows them (e.g.
    // a pasted Drive link) — the caller's own value, no server round trip.
    if (fileIds && fileIds.length > 0) {
      builder.addView(new picker.DocsView(picker.ViewId.DOCS).setFileIds(fileIds));
    }
    builder.addView(new picker.DocsView(picker.ViewId.DOCS));
    builder.addView(new picker.DocsView(picker.ViewId.DOCS).setOwnedByMe(false));
    builder.addView(new picker.DocsView(picker.ViewId.DOCS).setEnableDrives(true));

    widget = builder.build();
    widget.setVisible(true);
  });

  if (!picked.ok || !picked.newFiles?.length) return picked;

  // Persisted BEFORE success is reported — see persistPickedFiles.
  try {
    const merged = await persistPickedFiles(engine, name, picked.newFiles, projectName);
    return { ok: true, files: merged, newFiles: picked.newFiles };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message || 'Could not save the picked files.' };
  }
}

export async function pickDriveFiles(engine: string, name: string, accountEmail: string, fileIds?: string[], projectName?: string): Promise<DrivePickerResult> {
  if (isElectron && typeof bridge.oauthPickDriveFiles === 'function') {
    return bridge.oauthPickDriveFiles({ engine, name, accountEmail, fileIds, projectName });
  }
  if (isWeb) {
    return pickDriveFilesWeb(engine, name, accountEmail, fileIds, projectName);
  }
  return { ok: false, reason: 'Google Picker is Electron-only for now.' };
}

export async function cancelDrivePicker(): Promise<void> {
  if (isElectron && typeof bridge.oauthCancelPicker === 'function') {
    await bridge.oauthCancelPicker();
  }
  webPickerCancelPrevious?.();
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

export async function mindshubFinalize(
  organizationId?: string,
): Promise<{ ok: boolean; reason?: string; upgradeRequired?: boolean; organization?: MindsOrg }> {
  if (isElectron && typeof bridge.mindshubFinalize === 'function') {
    return bridge.mindshubFinalize(organizationId);
  }
  return { ok: false, reason: 'MindsHub finalize bridge is Electron-only.' };
}

/**
 * Hand a user-supplied MindsHub key to the main process, or clear it with ''.
 *
 * Electron only, and the caller has to know that: main is where the OS keychain
 * and the sidecar hand-over live, so there is nothing on web to route it to.
 * `supported: false` is how a web caller learns to fall back to writing the key
 * as an ordinary setting, which is still what the web deployment does.
 */
export async function mindshubSetUserKey(
  key: string,
): Promise<{ ok: boolean; supported: boolean; reason?: string }> {
  if (isElectron && typeof bridge.mindshubSetUserKey === 'function') {
    const result = await bridge.mindshubSetUserKey(key);
    return { ok: Boolean(result?.ok), supported: true, reason: result?.reason };
  }
  return { ok: false, supported: false };
}

// ---- MindsHub organizations ---------------------------------------------
//
/**
 * Which MindsHub organization this session presents. Electron delegates to the
 * installed main process; web uses the existing Keycloak browser session. An
 * Electron renderer must never fall through to the web implementation because
 * renderer bundles update over the air while `src/main/**` only arrives in a
 * new installer.
 */

export type { MindsOrg } from '../../shared/minds-orgs';

export interface MindsOrgList {
  orgs: MindsOrg[];
  activeOrgId: string | null;
  /** False only when a web network read did not settle and is worth retrying. */
  reachable?: boolean;
}

type SettledMindsOrgSwitch = {
  activeOrgId: string | null;
  orgs: MindsOrg[];
  reloadRequired?: false;
  clearTenantState?: false;
};

type ReloadingMindsOrgSwitch = {
  activeOrgId: string | null;
  orgs: MindsOrg[];
  /** The tenant may have changed, so the old renderer must not remain usable. */
  reloadRequired: true;
  /** False only for a pre-dispatch adapter-healing reload. */
  clearTenantState: boolean;
};

export type SwitchMindsOrgResult =
  | (SettledMindsOrgSwitch & { ok: true })
  | (SettledMindsOrgSwitch & { ok: false; error: string })
  | (ReloadingMindsOrgSwitch & { ok: true })
  | (ReloadingMindsOrgSwitch & { ok: false; error: string });

const NO_ORGS: MindsOrgList = { orgs: [], activeOrgId: null };

export async function mindshubListOrgs(): Promise<MindsOrgList> {
  if (isElectron) {
    if (typeof bridge.mindshubListOrgs === 'function') {
      try {
        const result = await bridge.mindshubListOrgs();
        return {
          orgs: Array.isArray(result?.orgs) ? result.orgs : [],
          activeOrgId: result?.activeOrgId ?? null,
        };
      } catch (error) {
        /**
         * The resting shape, not a throw. Every caller treats "no organizations"
         * as the state before the read lands, and the one on the onboarding path
         * has no error branch to fall into — a rejection there strands sign-in on
         * the validating screen with nothing on it.
         */
        console.warn('[host] could not read the MindsHub organizations', error);
      }
    }
    return NO_ORGS;
  }

  const { listWebOrganizations } = await import('../lib/keycloak');
  const result = await listWebOrganizations();
  if (!result.ok) {
    console.warn('[host] could not read the MindsHub organizations', result.reason);
    return { ...NO_ORGS, reachable: false };
  }
  return { orgs: result.orgs, activeOrgId: result.activeOrgId, reachable: true };
}

export async function mindshubSwitchOrg(organizationId: string): Promise<SwitchMindsOrgResult> {
  if (isElectron) {
    if (typeof bridge.mindshubSwitchOrg === 'function') {
      try {
        return await bridge.mindshubSwitchOrg(organizationId);
      } catch (error) {
        /**
         * A refusal is something the menu renders, so it has to arrive as a
         * value. Throwing past the toast leaves the row looking untouched.
         */
        console.warn('[host] could not change the MindsHub organization', error);
        return { ok: false, activeOrgId: null, orgs: [], error: 'We could not change organization. Please try again.' };
      }
    }
    return { ok: false, activeOrgId: null, orgs: [], error: 'Changing organization needs a newer desktop app.' };
  }

  const { switchWebOrganization } = await import('../lib/keycloak');
  const result = await switchWebOrganization(organizationId);
  if (result.ok) {
    return {
      ok: true,
      activeOrgId: result.activeOrgId,
      orgs: [],
      reloadRequired: result.reloadRequired,
      clearTenantState: result.clearTenantState,
    };
  }
  if (result.reloadRequired) {
    return {
      ok: false,
      activeOrgId: null,
      orgs: [],
      error: result.reason,
      reloadRequired: true,
      clearTenantState: result.clearTenantState,
    };
  }
  return {
    ok: false,
    activeOrgId: null,
    orgs: [],
    error: result.reason,
    reloadRequired: false,
    clearTenantState: false,
  };
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

// A cowork-server this app didn't spawn (Settings → Backend → Advanced).
// Electron-only — the web shell always talks same-origin, so both wrappers
// no-op to "nothing configured" / failure.
export async function getCustomServer(): Promise<{ url: string | null; token: string | null }> {
  if (isElectron && typeof bridge.getCustomServer === 'function') {
    return bridge.getCustomServer();
  }
  return { url: null, token: null };
}

export async function setCustomServer(config: { url: string | null; token: string | null }): Promise<boolean> {
  if (isElectron && typeof bridge.setCustomServer === 'function') {
    return (await bridge.setCustomServer(config)).ok;
  }
  return false;
}

// Applying a custom-server change (or reverting to the local one) needs a
// full restart — the origin is fixed at window-creation time (ENG-439-style
// additionalArguments), not hot-reloadable. No-op on web.
export async function restartApp(): Promise<void> {
  if (isElectron && typeof bridge.restartApp === 'function') {
    await bridge.restartApp();
  }
}

// Local server auth toggle (Settings → Backend). Unlike the custom-server
// restart above, toggling only restarts the sidecar — main does that itself
// as part of the same IPC call, so there's nothing further for the caller to
// do besides re-reading diagnostics. No-op on web (server-side auth there is
// whatever the hosting deployment configured, not this app's concern).
export async function getLocalAuth(): Promise<{ enabled: boolean; token: string | null }> {
  if (isElectron && typeof bridge.getLocalAuth === 'function') {
    return bridge.getLocalAuth();
  }
  return { enabled: false, token: null };
}

export async function setLocalAuth(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; token: string | null }> {
  if (isElectron && typeof bridge.setLocalAuth === 'function') {
    return bridge.setLocalAuth(enabled);
  }
  return { ok: false, enabled: false, token: null };
}

export async function getAccessToken(): Promise<string | null> {
  if (isElectron && typeof bridge.getAccessToken === 'function') {
    return bridge.getAccessToken();
  }
  const { getAccessToken: kcGetToken } = await import('../lib/keycloak');
  return kcGetToken();
}

// Signs the user out. On Electron: clears the persisted refresh token and
// strips provider/auth keys from ~/.anton/.env (the main process re-routes the
// UI via webContents.reload()). On web: ends the Keycloak browser session via
// its end-session endpoint, which redirects the tab and — with
// onLoad:'login-required' — forces a fresh login. The keycloak import stays
// behind host.ts so cowork/ never touches the bridge directly (check:cowork-purity).
export async function logout(): Promise<void> {
  if (isElectron && typeof bridge.logout === 'function') {
    await bridge.logout();
    return;
  }
  const { logout: kcLogout } = await import('../lib/keycloak');
  await kcLogout();
}

// Re-export a single namespace for ergonomic call sites (`host.openPath(...)`).
export const host = {
  isWeb,
  isElectron,
  codeModeAvailable,
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
  pickCodeFolder,
  detectClaudeCode,
  startCodingTerminal,
  sendCodingTerminalInput,
  resizeCodingTerminal,
  isCodingTerminalRunning,
  killCodingTerminal,
  removeCodingTask,
  onCodingTerminalData,
  onCodingTerminalExit,
  onWindowVisibility,
  getPathForFile,
  getUIVersion,
  getVersionInfo,
  readSettings,
  saveSettings,
  restartServer,
  checkInstall,
  checkConfigured,
  awaitBootReady,
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
  checkForUpdates,
  getShellUpdate,
  getShellAutoUpdate,
  onShellAutoUpdate,
  checkShellAutoUpdate,
  downloadShellAutoUpdate,
  installShellAutoUpdate,
  oauthConnect,
  oauthCancel,
  mindshubLogin,
  mindshubSignup,
  mindshubRefresh,
  mindshubFinalize,
  mindshubSetUserKey,
  mindshubListOrgs,
  mindshubSwitchOrg,
  mindshubGetCachedToken,
  onMindsHubAuthChanged,
  getKeychainPref,
  setKeychainPref,
  getCustomServer,
  setCustomServer,
  restartApp,
  getLocalAuth,
  setLocalAuth,
  getAccessToken,
  logout,
  keychainRevoke,
  onOAuthRefreshError,
  pickDriveFiles,
  cancelDrivePicker,
};

export default host;
