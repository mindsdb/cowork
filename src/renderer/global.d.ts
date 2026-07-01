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
  checkForUpdate: () => Promise<{ updateAvailable: boolean; applied: boolean; newVersion?: string }>;
  applyUpdate: () => Promise<boolean>;
  onUpdateStatus: (cb: (status: { phase: string; version?: string }) => void) => () => void;

  getPlatform: () => string;
  getUIVersion: () => Promise<{ app: string; ui: string }>;
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
    lastExitCode: number | null;
    lastStartAt: number | null;
    recentLog: string;
  }>;
  oauthConnect: (opts: {
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    extraAuthParams?: Record<string, string>;
  }) => Promise<{
    ok: boolean;
    reason?: string;
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }>;
  oauthCancel: () => Promise<boolean>;
  mindshubLogin: () => Promise<{
    ok: boolean;
    reason?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>;
  mindshubRefresh: () => Promise<{ ok: boolean; reason?: string; access_token?: string }>;
  mindshubFinalize: () => Promise<{ ok: boolean; reason?: string; upgradeRequired?: boolean; apiKey?: string }>;
  mindshubGetCachedToken: () => Promise<{ access_token: string | null }>;
  getAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  getPathForFile: (file: File) => string;
}

declare global {
  /** Injected by Vite at build time from package.json `version`. */
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
