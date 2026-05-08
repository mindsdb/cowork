// Host platform abstraction for the cowork SPA.
//
// The cowork renderer ships in two shells:
//   - Electron (preload exposes window.antontron — full bridge)
//   - Web (vite SPA served by FastAPI — no bridge)
//
// Every cowork/* file MUST go through this module instead of touching
// `window.antontron` directly. This is enforced by a lint guard
// (`pnpm check:cowork-purity`).
//
// Web fallbacks are intentionally narrow: methods that have a sensible
// browser equivalent (openExternal → window.open) work; OS-level shell
// operations (openPath, trashItem) return { ok: false, reason: 'unsupported' }
// so call sites can branch / hide affordances.

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
//   Electron (file:// or app://) → loopback at the fixed dev port.
//   Web (http(s)://...)          → same origin (FastAPI serves the SPA).
export function getApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location?.protocol;
  return protocol === 'file:' || protocol === 'app:'
    ? `http://127.0.0.1:${ANTON_SERVER_PORT}`
    : window.location.origin;
}

// In Electron, OAuth runs through a loopback server spawned by main —
// there is no fixed redirect URI to register, so this returns null and
// callers should use oauthConnect() for the IPC PKCE flow instead.
//
// In web, OAuth must use a server-side redirect — this returns the
// stable callback URL the FastAPI backend exposes for that integration.
export function getOAuthRedirectUri(integration: string): string | null {
  if (isElectron) return null;
  return `${getApiOrigin()}/v1/oauth/callback/${integration}`;
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
  lastExitCode: number | null;
  lastStartAt: number | null;
  recentLog: string;
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
    lastExitCode: null,
    lastStartAt: null,
    recentLog: '',
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

export async function trashItem(path: string): Promise<{ ok: boolean; reason?: string }> {
  if (isElectron && typeof bridge.trashItem === 'function') {
    return bridge.trashItem(path);
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

export interface OAuthConnectOpts {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
}

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

// Re-export a single namespace for ergonomic call sites (`host.openPath(...)`).
export const host = {
  isWeb,
  isElectron,
  getPlatform,
  isMac,
  getApiOrigin,
  getOAuthRedirectUri,
  serverInfo,
  serverStart,
  serverStop,
  serverDiagnostics,
  openExternal,
  openPath,
  showItemInFolder,
  trashItem,
  getPathForFile,
  getUIVersion,
  onUpdateStatus,
  applyUpdate,
  oauthConnect,
};

export default host;
