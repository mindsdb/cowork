interface AntonTronAPI {
  checkInstall: () => Promise<boolean>;
  startInstall: () => Promise<boolean>;
  onInstallLog: (cb: (msg: string) => void) => () => void;
  onInstallProgress: (cb: (steps: any[]) => void) => () => void;
  onInstallDone: (cb: () => void) => () => void;
  onInstallError: (cb: (err: string) => void) => () => void;

  startAnton: (projectName: string, cols: number, rows: number) => Promise<void>;
  isAntonRunning: (projectName: string) => Promise<boolean>;
  sendInput: (projectName: string, data: string) => void;
  resizeTerminal: (projectName: string, cols: number, rows: number) => void;
  killAnton: (projectName: string) => void;
  onAntonData: (cb: (projectName: string, data: string) => void) => () => void;
  onAntonExit: (cb: (projectName: string, code: number) => void) => () => void;

  mindsStatus: () => Promise<{
    connected: boolean;
    url?: string;
    apiKey?: string;
    mindName?: string | null;
    datasource?: string | null;
    engine?: string | null;
  }>;
  mindsList: (url: string, apiKey: string) =>
    Promise<{ ok: boolean; minds?: any[]; error?: string }>;
  mindsGet: (url: string, apiKey: string, mindName: string) =>
    Promise<{ ok: boolean; mind?: any; error?: string }>;
  mindsListDatasources: (url: string, apiKey: string) =>
    Promise<{ ok: boolean; datasources?: any[]; error?: string }>;
  mindsConnect: (url: string, apiKey: string, mindName: string, datasource: string | null, engine: string | null, sslVerify: boolean) =>
    Promise<boolean>;
  mindsDisconnect: () => Promise<boolean>;

  saveClipboardImage: (base64Data: string) => Promise<string>;
  saveSettings: (content: string) => Promise<boolean>;
  checkConfigured: () => Promise<{ configured: boolean; provider: string }>;
  validateProvider: (provider: string, apiKey: string, baseUrl?: string) =>
    Promise<{ ok: boolean; error?: string }>;

  listProjects: () => Promise<{ name: string; path: string }[]>;
  createProject: (name: string) => Promise<{ name: string; path: string } | { error: string }>;
  deleteProject: (name: string) => Promise<boolean>;
  getActiveProject: () => Promise<string>;
  setActiveProject: (name: string) => Promise<boolean>;

  getPlatform: () => string;
}

declare global {
  interface Window {
    antontron: AntonTronAPI;
  }
}

export {};
