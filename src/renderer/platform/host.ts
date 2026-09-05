// cowork/* must access Electron's bridge through this module (enforced by check:cowork-purity).
// Browser equivalents work on web; OS-only operations report unsupported so callers can hide them.

import type { MindsOrg } from '../../shared/minds-orgs';
import type { ServerStartErrorKind } from '../../shared/server-status';
import type { UpdateCheckSummary } from '../../shared/update-types';
import { parseCalVer, compareCalVer } from '../../shared/version';

const ANTON_SERVER_PORT = 26866;

// Hardcoded for older shells that cannot report the release manifest URL over the bridge.
const SHELL_MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

type Bridge = typeof window extends { antontron?: infer T } ? T : never;

const bridge: any =
  typeof window !== 'undefined' ? (window as any).antontron : undefined;

export const isElectron: boolean = typeof bridge === 'object' && bridge !== null;
export const isWeb: boolean = !isElectron;

// Deployment capability only; renderer opt-in is separate and per device. Hosted web does not offer
// Code.
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

// Electron uses main's resolved loopback port, with a legacy-port fallback. Web uses the same
// origin.
export function getApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location?.protocol;
  if (protocol === 'file:' || protocol === 'app:') {
    const port = isElectron && typeof bridge.serverPort === 'number' ? bridge.serverPort : ANTON_SERVER_PORT;
    return `http://127.0.0.1:${port}`;
  }
  return window.location.origin;
}

// Code runtimes need the sidecar address in Vite development, not the renderer's :5173 origin.
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
      }
    }
    const port = typeof bridge.serverPort === 'number' ? bridge.serverPort : ANTON_SERVER_PORT;
    return `http://127.0.0.1:${port}`;
  }
  return getApiOrigin();
}

// Only open server filesystem paths locally when both isElectron and isLocalBackend are true.
// Remote backends require fetching the artifact serveUrl; their paths belong to another machine.
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

// Electron OAuth uses oauthConnect() with a dynamic loopback redirect. Web uses the stable server
// callback.
export function getOAuthRedirectUri(integration: string): string | null {
  if (isElectron) return null;
  return `${getApiOrigin()}/api/v1/oauth/callback/${integration}`;
}

// Server lifecycle: main owns Electron's subprocess; web start/stop are no-ops because FastAPI is
// the host.

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

// Main-window visibility events do not fire on web, which remains visible.
export function onWindowVisibility(cb: (visible: boolean) => void): () => void {
  if (isElectron && typeof bridge.onWindowVisibility === 'function') {
    return bridge.onWindowVisibility(cb);
  }
  return () => {};
}

// ---- File drop / clipboard ---------------------------------------------

// Web File objects lack an OS path; return null so callers upload content instead.
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

/** Effective UI version is ui ?? __APP_VERSION__. */
export async function getVersionInfo(): Promise<VersionInfo> {
  if (isElectron && typeof bridge.getUIVersion === 'function') {
    const v = await bridge.getUIVersion();
    if (v && typeof v === 'object') {
      // Older OTA hosts report ui: "bundled" and omit source; infer OTA only from a real UI
      // version.
      const ui = v.ui != null && v.ui !== 'bundled' ? String(v.ui) : null;
      const source: VersionInfo['source'] =
        v.source === 'ota' || v.source === 'bundled' ? v.source : ui ? 'ota' : 'bundled';
      return { app: String(v.app ?? ''), ui, source, buildKind: normalizeBuildKind(v.buildKind) };
    }
  }
  return { app: '', ui: null, source: 'web', buildKind: null };
}

// Onboarding pages use host.* in both shells; web settings endpoints mirror the Electron IPC
// shapes.

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> || {}) };
  // Web ingress requires the Keycloak Bearer token. Electron main injects its loopback token.
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
    // Preserve status so callers can distinguish expected loopback-gate 403s from real failures.
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Hosted /settings/raw rejects loopback-only access (403) and org-mode access (501).
// Only these expected refusals degrade to DB persistence; propagate other errors.
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
  // Web reads .env per request, so it needs no restart.
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
  orgMode?: boolean;
}> {
  if (isElectron && typeof bridge.checkConfigured === 'function') {
    return bridge.checkConfigured();
  }
  // Use /health config_ready, matching the chat gate. orgMode separately identifies hosted org
  // deployments.
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

// Wait for main's complete boot/update decision to avoid flashing a server-down chat screen.
// Do not race a renderer timeout: it could release the gate during a reinstall.
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

// Electron streams CLI/dependency installation. Web is already installed, so subscribers complete
// synchronously.

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
  // Allow the installing frame to render before completing.
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

// Re-pull main's shell-update notice after OTA remounts lose the original push.
// Older shells lack the bridge, so compare their installed version with the manifest in the
// renderer.
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

// Old shells compare only valid CalVer shell versions; fetch/parse failures report no update.
// Use the downloads site because these shells cannot expose the build kind needed for an installer
// URL.
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

// Detection only; applying UI/server updates or downloading a shell installer is separate. Web
// updates by redeploy.
export async function checkForUpdates(): Promise<UpdateCheckSummary> {
  if (isElectron && typeof bridge.checkForUpdate === 'function') {
    const reply = await bridge.checkForUpdate();
    if (reply && typeof reply === 'object' && 'ok' in reply) {
      return reply;
    }

    // Normalize older UI-only replies and merge the renderer shell check, or manual checks can
    // erase a reinstall notice.
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

// Electron uses main's loopback PKCE flow. Web callers use getOAuthRedirectUri() with server-side
// redirects.
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

// Electron opens Google Picker in the OS browser because Google blocks embedded sign-in.
// Picker grants access to existing drive.file resources without widening OAuth scope.
// fileIds preselect known files; projectName associates new grants with a project.
// cancelDrivePicker also cancels and resolves the web widget; settled calls are safe.
let webPickerCancelPrevious: (() => void) | null = null;

const GOOGLE_API_SRC = 'https://apis.google.com/js/api.js';

// Backstop for silent failures, not a normal interaction deadline.
const PICKER_STUCK_TIMEOUT_MS = 5 * 60 * 1000;

// Keep file-ID validation aligned with main/drive-picker-service.ts.
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

function validDriveFileIds(fileIds: string[] | undefined): boolean {
  if (fileIds === undefined) return true;
  return Array.isArray(fileIds) && fileIds.every((id) => typeof id === 'string' && DRIVE_FILE_ID_RE.test(id));
}

// Local types cover the untyped Google Picker SDK surface used here.
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

// Cache the Picker SDK per page; discard rejected loads so transient failures remain retryable.
let googlePickerSdk: Promise<void> | null = null;

function loadGooglePickerSdk(): Promise<void> {
  if (googlePickerSdk) return googlePickerSdk;
  googlePickerSdk = new Promise<void>((resolve, reject) => {
    const unreachable = () => reject(new Error('Could not reach Google to load the file picker.'));
    const loadPickerModule = () => {
      const gapi = googleApiWindow().gapi;
      if (!gapi) { unreachable(); return; }
      // api.js only bootstraps the loader; fetching the picker module can fail separately.
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

// Persist explicit file grants before reporting success: _picked_files feeds cowork-server's
// project prompts.
// Failure means the grant was not recorded and must not appear successful.
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

// Render Picker in the authenticated page so requests carry Bearer headers without popup handoffs.
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
    // Report load failures here: unlike the former picker page, this widget has no separate error
    // surface.
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

    // A static Google 403 iframe emits no callback, leaving the promise pending.
    // There is no LOADED event to distinguish it from active browsing, so use a generous backstop.
    const stuckTimer = setTimeout(() => {
      try { widget?.setVisible(false); } catch { /* already disposed */ }
      finish({
        ok: false,
        reason: `Google Picker did not respond — the browser’s active Google account may not match ${account}.`,
      });
    }, PICKER_STUCK_TIMEOUT_MS);
    // A new pick supersedes the visible picker.
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
          // Cancel succeeds with no files, matching Electron.
          finish({ ok: true, files: [], newFiles: [] });
        } else if (data.action === picker.Action.ERROR) {
          // Settle widget errors; account/token mismatch commonly produces a 403 without PICKED or
          // CANCEL.
          finish({
            ok: false,
            reason: `Google Picker could not open — the browser’s active Google account may not match ${account}.`,
          });
        }
      });

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

// Cancel the loopback OAuth listener immediately instead of waiting for its five-minute timeout.
export async function oauthCancel(): Promise<void> {
  if (isElectron && typeof bridge.oauthCancel === 'function') {
    await bridge.oauthCancel();
  }
}

// MindsHub PKCE is Electron-only; web uses Keycloak redirect auth.
// See main/index.ts for the login/refresh/finalize split.

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

// Registration uses login's PKCE flow; its promise may remain pending for minutes during email
// verification.
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

/**
 * chosenByUser distinguishes an explicit organization choice from an inferred id; main must
 * preserve that choice.
 */
export async function mindshubFinalize(
  organizationId?: string,
  chosenByUser?: boolean,
): Promise<{ ok: boolean; reason?: string; upgradeRequired?: boolean; organization?: MindsOrg }> {
  // Use the capability-specific method: older shells silently drop the chosenByUser argument to
  // finalize.
  if (isElectron && organizationId && chosenByUser && canPickOrganization()) {
    return bridge.mindshubFinalizeChosen!(organizationId);
  }
  if (isElectron && typeof bridge.mindshubFinalize === 'function') {
    return bridge.mindshubFinalize(organizationId, chosenByUser);
  }
  return { ok: false, reason: 'MindsHub finalize bridge is Electron-only.' };
}

/**
 * OTA renderers may run against older main processes that discard explicit organization choices.
 * Hide the picker unless the shell can preserve chosenByUser.
 */
export function canPickOrganization(): boolean {
  return isElectron && typeof bridge.mindshubFinalizeChosen === 'function';
}

/**
 * Store or clear the MindsHub key in Electron main, which owns keychain and sidecar hand-over.
 * Web reports supported: false so callers can save an ordinary setting.
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
 * Electron must not fall through to Keycloak web organization handling when an older shell lacks
 * the bridge.
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
         * Return the empty resting shape: onboarding has no rejection path and would otherwise
         * strand sign-in.
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
         * Return refusals as values so callers display the error instead of leaving the row
         * apparently untouched.
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

// Electron session-state changes; returns an unsubscribe function. Web is a no-op.
export function onMindsHubAuthChanged(
  cb: (payload: { authenticated: boolean }) => void,
): () => void {
  if (isElectron && typeof bridge.onMindsHubAuthChanged === 'function') {
    return bridge.onMindsHubAuthChanged(cb);
  }
  return () => {};
}

// Electron reports keychain vs plaintext token storage; web has no local store and returns the safe
// default.
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

// Electron clears the refresh token and provider/auth keys, then reloads via main.
// Web ends the Keycloak session and redirects to fresh login.
export async function logout(): Promise<void> {
  if (isElectron && typeof bridge.logout === 'function') {
    await bridge.logout();
    return;
  }
  const { logout: kcLogout } = await import('../lib/keycloak');
  await kcLogout();
}

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
  canPickOrganization,
  mindshubSetUserKey,
  mindshubListOrgs,
  mindshubSwitchOrg,
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
