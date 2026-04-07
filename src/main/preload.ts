import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('antontron', {
  // Installer
  checkInstall: () => ipcRenderer.invoke(IPC.INSTALL_CHECK),
  startInstall: () => ipcRenderer.invoke(IPC.INSTALL_START),
  cancelInstall: () => ipcRenderer.invoke(IPC.INSTALL_CANCEL),
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

  // Anton process
  startAnton: (projectName: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC.ANTON_START, projectName, cols, rows),
  isAntonRunning: (projectName: string) =>
    ipcRenderer.invoke(IPC.ANTON_IS_RUNNING, projectName),
  sendInput: (projectName: string, data: string) =>
    ipcRenderer.send(IPC.ANTON_INPUT, projectName, data),
  resizeTerminal: (projectName: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC.ANTON_RESIZE, projectName, cols, rows),
  killAnton: (projectName: string) =>
    ipcRenderer.send(IPC.ANTON_KILL, projectName),
  onAntonData: (cb: (projectName: string, data: string) => void) => {
    const listener = (_: any, projectName: string, data: string) => cb(projectName, data);
    ipcRenderer.on(IPC.ANTON_DATA, listener);
    return () => ipcRenderer.removeListener(IPC.ANTON_DATA, listener);
  },
  onAntonExit: (cb: (projectName: string, code: number) => void) => {
    const listener = (_: any, projectName: string, code: number) => cb(projectName, code);
    ipcRenderer.on(IPC.ANTON_EXIT, listener);
    return () => ipcRenderer.removeListener(IPC.ANTON_EXIT, listener);
  },

  // Settings / Onboarding
  readSettings: () => ipcRenderer.invoke(IPC.SETTINGS_READ),
  saveSettings: (content: string) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, content),
  checkConfigured: () => ipcRenderer.invoke(IPC.SETTINGS_CHECK_CONFIGURED),
  validateProvider: (provider: string, apiKey: string, baseUrl?: string, model?: string) =>
    ipcRenderer.invoke(IPC.SETTINGS_VALIDATE, provider, apiKey, baseUrl, model),

  // Data Vault
  vaultList: () => ipcRenderer.invoke(IPC.VAULT_LIST),
  vaultLoad: (engine: string, name: string) => ipcRenderer.invoke(IPC.VAULT_LOAD, engine, name),
  vaultSave: (engine: string, name: string, fields: Record<string, string>) =>
    ipcRenderer.invoke(IPC.VAULT_SAVE, engine, name, fields),
  vaultDelete: (engine: string, name: string) => ipcRenderer.invoke(IPC.VAULT_DELETE, engine, name),
  onVaultChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.VAULT_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.VAULT_CHANGED, listener);
  },

  // Minds
  mindsStatus: () => ipcRenderer.invoke(IPC.MINDS_STATUS),
  mindsList: (url: string, apiKey: string, sslVerify: boolean) =>
    ipcRenderer.invoke(IPC.MINDS_LIST, url, apiKey, sslVerify),
  mindsGet: (url: string, apiKey: string, mindName: string, sslVerify: boolean) =>
    ipcRenderer.invoke(IPC.MINDS_GET, url, apiKey, mindName, sslVerify),
  mindsListDatasources: (url: string, apiKey: string, sslVerify: boolean) =>
    ipcRenderer.invoke(IPC.MINDS_LIST_DATASOURCES, url, apiKey, sslVerify),
  mindsConnect: (url: string, apiKey: string, mindName: string, datasource: string | null, engine: string | null, sslVerify: boolean) =>
    ipcRenderer.invoke(IPC.MINDS_CONNECT, url, apiKey, mindName, datasource, engine, sslVerify),
  mindsDisconnect: () => ipcRenderer.invoke(IPC.MINDS_DISCONNECT),
  onMindsStatusChanged: (cb: (status: any) => void) => {
    const listener = (_: any, status: any) => cb(status);
    ipcRenderer.on(IPC.MINDS_STATUS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.MINDS_STATUS_CHANGED, listener);
  },

  // Clipboard
  saveClipboardImage: (base64Data: string) =>
    ipcRenderer.invoke(IPC.CLIPBOARD_SAVE_IMAGE, base64Data),

  // Projects
  listProjects: () => ipcRenderer.invoke(IPC.PROJECTS_LIST),
  createProject: (name: string) => ipcRenderer.invoke(IPC.PROJECTS_CREATE, name),
  renameProject: (oldName: string, newName: string) => ipcRenderer.invoke(IPC.PROJECTS_RENAME, oldName, newName),
  deleteProject: (name: string) => ipcRenderer.invoke(IPC.PROJECTS_DELETE, name),
  getActiveProject: () => ipcRenderer.invoke(IPC.PROJECTS_GET_ACTIVE),
  setActiveProject: (name: string) => ipcRenderer.invoke(IPC.PROJECTS_SET_ACTIVE, name),

  // App
  getPlatform: () => process.platform,
  getUIVersion: () => ipcRenderer.invoke(IPC.APP_UI_VERSION),
});
