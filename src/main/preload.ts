import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('antontron', {
  // Installer
  checkInstall: () => ipcRenderer.invoke(IPC.INSTALL_CHECK),
  startInstall: () => ipcRenderer.invoke(IPC.INSTALL_START),
  cancelInstall: () => ipcRenderer.invoke(IPC.INSTALL_CANCEL),

  // Anton python server lifecycle
  serverInfo:   () => ipcRenderer.invoke('server:get-info'),
  serverStart:  () => ipcRenderer.invoke('server:start'),
  serverStop:   () => ipcRenderer.invoke('server:stop'),
  serverToggle: () => ipcRenderer.invoke('server:toggle'),
  // Diagnostics — last start error + tail of stdout/stderr. Used
  // by the renderer's "why is the backend offline?" help modal.
  serverDiagnostics: () => ipcRenderer.invoke('server:get-diagnostics'),
  // PKCE OAuth — main spawns a loopback server + opens the
  // browser, returns the resulting tokens (or an error reason).
  oauthConnect: (opts: {
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    extraAuthParams?: Record<string, string>;
  }) => ipcRenderer.invoke('oauth:connect', opts),
  oauthCancel: () => ipcRenderer.invoke(IPC.OAUTH_CANCEL),

  // MindsHub onboarding — see main/index.ts for the rationale on
  // why these are split out from the generic oauth:connect bridge.
  mindshubLogin: () => ipcRenderer.invoke(IPC.MINDSHUB_LOGIN),
  mindshubRefresh: () => ipcRenderer.invoke(IPC.MINDSHUB_REFRESH),
  mindshubFinalize: () => ipcRenderer.invoke(IPC.MINDSHUB_FINALIZE),
  mindshubGetCachedToken: () => ipcRenderer.invoke(IPC.MINDSHUB_GET_CACHED_TOKEN),

  // Open a local file/folder in the OS default handler.
  openPath:     (p: string) => ipcRenderer.invoke('shell:open-path', p),
  showItemInFolder: (p: string) => ipcRenderer.invoke(IPC.SHOW_ITEM_IN_FOLDER, p),
  onInstallLog: (cb: (msg: string) => void) => {
    const listener = (_: any, msg: string) => cb(msg);
    ipcRenderer.on(IPC.INSTALL_LOG, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_LOG, listener);
  },
  onInstallProgress: (cb: (steps: any[]) => void) => {
    const listener = (_: any, steps: any[]) => cb(steps);
    ipcRenderer.on(IPC.INSTALL_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_PROGRESS, listener);
  },
  onInstallDone: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.INSTALL_DONE, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_DONE, listener);
  },
  onInstallError: (cb: (err: string) => void) => {
    const listener = (_: any, err: string) => cb(err);
    ipcRenderer.on(IPC.INSTALL_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_ERROR, listener);
  },
  onInstallCancelled: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.INSTALL_CANCELLED, listener);
    return () => ipcRenderer.removeListener(IPC.INSTALL_CANCELLED, listener);
  },

  // Auth (Electron-only)
  getAccessToken: () => ipcRenderer.invoke(IPC.AUTH_GET_ACCESS_TOKEN),
  logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),

  // Settings / Onboarding
  readSettings: () => ipcRenderer.invoke(IPC.SETTINGS_READ),
  saveSettings: (content: string) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, content),
  checkConfigured: () => ipcRenderer.invoke(IPC.SETTINGS_CHECK_CONFIGURED),
  validateProvider: (provider: string, apiKey: string, baseUrl?: string, model?: string) =>
    ipcRenderer.invoke(IPC.SETTINGS_VALIDATE, provider, apiKey, baseUrl, model),

  // Server
  restartServer: () => ipcRenderer.invoke(IPC.SERVER_RESTART),

  // UI Updates
  checkForUpdate: () => ipcRenderer.invoke(IPC.UI_UPDATE_CHECK),
  applyUpdate: () => ipcRenderer.invoke(IPC.UI_UPDATE_APPLY),
  onUpdateStatus: (cb: (status: { phase: string; version?: string }) => void) => {
    const listener = (_: any, status: { phase: string; version?: string }) => cb(status);
    ipcRenderer.on(IPC.UI_UPDATE_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC.UI_UPDATE_STATUS, listener);
  },

  // App
  getPlatform: () => process.platform,
  getUIVersion: () => ipcRenderer.invoke(IPC.APP_UI_VERSION),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
