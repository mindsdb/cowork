/// <reference types="vite/client" />

interface AntonTronAPI {
  checkInstall: () => Promise<{ antonInstalled: boolean; serverDepsReady: boolean }>;
  startInstall: () => Promise<boolean>;
  cancelInstall: () => Promise<boolean>;
  onInstallLog: (cb: (msg: string) => void) => () => void;
  onInstallProgress: (cb: (steps: any[]) => void) => () => void;
  onInstallDone: (cb: () => void) => () => void;
  onInstallError: (cb: (err: string) => void) => () => void;
  onInstallCancelled: (cb: () => void) => () => void;

  readSettings: () => Promise<Record<string, string>>;
  saveSettings: (content: string) => Promise<boolean>;
  restartServer: () => Promise<void>;
  checkConfigured: () => Promise<{ configured: boolean; provider: string }>;
  validateProvider: (provider: string, apiKey: string, baseUrl?: string, model?: string) =>
    Promise<{ ok: boolean; error?: string }>;

  // UI Updates
  checkForUpdate: () => Promise<import('../shared/update-types').UpdateCheckSummary>;
  applyUpdate: () => Promise<boolean>;
  onUpdateStatus: (cb: (status: { phase: string; version?: string; currentVersion?: string; downloadUrl?: string }) => void) => () => void;
  getShellUpdate: () => Promise<{ available: boolean; currentVersion?: string; latestVersion?: string; downloadUrl?: string | null }>;
  getShellAutoUpdate: () => Promise<ShellAutoUpdateSnapshot>;
  checkShellAutoUpdate: () => Promise<ShellAutoUpdateSnapshot>;
  downloadShellAutoUpdate: () => Promise<ShellAutoUpdateSnapshot>;
  installShellAutoUpdate: () => Promise<boolean>;
  onShellAutoUpdate: (cb: (snapshot: ShellAutoUpdateSnapshot) => void) => () => void;

  getPlatform: () => string;
  getUIVersion: () => Promise<{ app: string; ui: string | null; source: 'ota' | 'bundled'; buildKind?: string }>;
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<{ ok: boolean; reason?: string }>;
  showItemInFolder: (path: string) => Promise<{ ok: boolean; reason?: string }>;
  serverInfo: () => Promise<{ running: boolean; starting: boolean; port: number }>;
  serverStart: () => Promise<{ ok: boolean; port?: number; reason?: string }>;
  serverStop: () => Promise<void>;
  serverDiagnostics: () => Promise<{
    running: boolean;
    starting: boolean;
    port: number;
    lastError: string | null;
    lastErrorKind: 'spawn-error' | 'exited' | 'timeout' | 'not-installed' | null;
    portHolderPid: number | null;
    lastExitCode: number | null;
    lastStartAt: number | null;
    recentLog: string;
    lastStopIntentional: boolean | null;
  }>;
  oauthConnect: (opts:
    | { engine: string; name?: string }
    | { authUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scopes: string[]; extraAuthParams?: Record<string, string>; redirectPort?: number }
  ) => Promise<{
    ok: boolean;
    reason?: string;
    name?: string;
    account_email?: string;
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }>;
  oauthCancel: () => Promise<boolean>;
  keychainRevoke: (opts: { engine: string; name: string; accountEmail: string }) => Promise<{ ok: boolean; reason?: string }>;
  onOAuthRefreshError: (cb: (payload: { engine: string; name: string; accountEmail: string; permanent: boolean }) => void) => () => void;
  oauthPickDriveFiles: (opts: { engine: string; name: string; accountEmail: string; fileIds?: string[]; projectName?: string }) => Promise<{
    ok: boolean;
    reason?: string;
    files?: Array<{ id: string; name: string; mimeType?: string; iconUrl?: string; url?: string; resourceKey?: string | null; projects?: string[] }>;
    newFiles?: Array<{ id: string; name: string; mimeType?: string; iconUrl?: string; url?: string; resourceKey?: string | null; projects?: string[] }>;
    failed?: Array<{ id: string; name: string; reason: string }>;
  }>;
  oauthCancelPicker: () => Promise<boolean>;
  mindshubLogin: () => Promise<{
    ok: boolean;
    reason?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>;
  mindshubSignup: () => Promise<{
    ok: boolean;
    reason?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>;
  mindshubRefresh: () => Promise<{ ok: boolean; reason?: string; access_token?: string }>;
  mindshubFinalize: () => Promise<{ ok: boolean; reason?: string; upgradeRequired?: boolean; apiKey?: string }>;
  mindshubGetCachedToken: () => Promise<{ access_token: string | null }>;
  onMindsHubAuthChanged: (cb: (payload: { authenticated: boolean }) => void) => () => void;
  getAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  getKeychainPref: () => Promise<{ enabled: boolean }>;
  setKeychainPref: (enabled: boolean) => Promise<{ ok: boolean }>;
  getPathForFile: (file: File) => string;
}

interface ShellAutoUpdateSnapshot {
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

declare global {
  /** App display version injected by Vite at build time. */
  const __APP_VERSION__: string;
  /** Short git commit hash at build time, or '' outside a repo. */
  const __GIT_HASH__: string;
  /** ISO 8601 timestamp of when the bundle was built. */
  const __BUILD_TIME__: string;
  interface Window {
    antontron: AntonTronAPI;
  }

  namespace React {
    interface CSSProperties {
      WebkitAppRegion?: string;
      WebkitBackdropFilter?: string;
    }
  }
}

export {};
