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
  trashItem: (path: string) => Promise<{ ok: boolean; reason?: string }>;
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
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    antontron: AntonTronAPI;
  }
}

export {};
