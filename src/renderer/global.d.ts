interface AntonTronAPI {
  checkInstall: () => Promise<boolean>;
  startInstall: () => Promise<boolean>;
  cancelInstall: () => Promise<boolean>;
  onInstallLog: (cb: (msg: string) => void) => () => void;
  onInstallProgress: (cb: (steps: any[]) => void) => () => void;
  onInstallDone: (cb: () => void) => () => void;
  onInstallError: (cb: (err: string) => void) => () => void;
  onInstallCancelled: (cb: () => void) => () => void;

  startAnton: (projectName: string, cols: number, rows: number) => Promise<void>;
  isAntonRunning: (projectName: string) => Promise<boolean>;
  sendInput: (projectName: string, data: string) => void;
  resizeTerminal: (projectName: string, cols: number, rows: number) => void;
  killAnton: (projectName: string) => void;
  onAntonData: (cb: (projectName: string, data: string) => void) => () => void;
  onAntonExit: (cb: (projectName: string, code: number) => void) => () => void;
  getLatestExplainability: (projectName: string) => Promise<{
    turn: number;
    created_at: string;
    user_message: string;
    answer_text: string;
    summary: string;
    data_sources: { name: string; engine?: string | null }[];
    sql_queries: {
      datasource: string;
      sql: string;
      engine?: string | null;
      status: string;
      error_message?: string | null;
    }[];
    scratchpad_steps: string[];
  } | null>;

  mindsStatus: () => Promise<{
    connected: boolean;
    url?: string;
    apiKey?: string;
    mindName?: string | null;
    datasource?: string | null;
    engine?: string | null;
  }>;
  mindsList: (url: string, apiKey: string, sslVerify: boolean) =>
    Promise<{ ok: boolean; minds?: any[]; error?: string }>;
  mindsGet: (url: string, apiKey: string, mindName: string, sslVerify: boolean) =>
    Promise<{ ok: boolean; mind?: any; error?: string }>;
  mindsListDatasources: (url: string, apiKey: string, sslVerify: boolean) =>
    Promise<{ ok: boolean; datasources?: any[]; error?: string }>;
  mindsConnect: (url: string, apiKey: string, mindName: string, datasource: string | null, engine: string | null, sslVerify: boolean) =>
    Promise<boolean>;
  mindsDisconnect: () => Promise<boolean>;
  onMindsStatusChanged: (cb: (status: {
    connected: boolean;
    url?: string;
    apiKey?: string;
    mindName?: string | null;
    datasource?: string | null;
    engine?: string | null;
  }) => void) => () => void;

  vaultList: () => Promise<{ engine: string; name: string; created_at: string }[]>;
  vaultLoad: (engine: string, name: string) => Promise<{ engine: string; name: string; created_at: string; fields: Record<string, string> } | null>;
  vaultSave: (engine: string, name: string, fields: Record<string, string>) => Promise<boolean>;
  vaultDelete: (engine: string, name: string) => Promise<boolean>;
  onVaultChanged: (cb: () => void) => () => void;

  saveClipboardImage: (base64Data: string) => Promise<string>;
  readSettings: () => Promise<Record<string, string>>;
  saveSettings: (content: string) => Promise<boolean>;
  checkConfigured: () => Promise<{ configured: boolean; provider: string }>;
  validateProvider: (provider: string, apiKey: string, baseUrl?: string, model?: string) =>
    Promise<{ ok: boolean; error?: string }>;

  listProjects: () => Promise<{ name: string; path: string }[]>;
  createProject: (name: string) => Promise<{ name: string; path: string } | { error: string }>;
  renameProject: (oldName: string, newName: string) => Promise<{ name: string; path: string } | { error: string }>;
  deleteProject: (name: string) => Promise<boolean>;
  getActiveProject: () => Promise<string>;
  setActiveProject: (name: string) => Promise<boolean>;

  getPlatform: () => string;
  getUIVersion: () => Promise<{ app: string; ui: string }>;
  openExternal: (url: string) => Promise<void>;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    antontron: AntonTronAPI;
  }
}

export {};
