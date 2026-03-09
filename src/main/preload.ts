import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('antontron', {
  // Installer
  checkInstall: () => ipcRenderer.invoke(IPC.INSTALL_CHECK),
  startInstall: () => ipcRenderer.invoke(IPC.INSTALL_START),
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
  saveSettings: (content: string) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, content),
  checkConfigured: () => ipcRenderer.invoke(IPC.SETTINGS_CHECK_CONFIGURED),
  validateProvider: (provider: string, apiKey: string, baseUrl?: string) =>
    ipcRenderer.invoke(IPC.SETTINGS_VALIDATE, provider, apiKey, baseUrl),

  // Clipboard
  saveClipboardImage: (base64Data: string) =>
    ipcRenderer.invoke(IPC.CLIPBOARD_SAVE_IMAGE, base64Data),

  // Projects
  listProjects: () => ipcRenderer.invoke(IPC.PROJECTS_LIST),
  createProject: (name: string) => ipcRenderer.invoke(IPC.PROJECTS_CREATE, name),
  deleteProject: (name: string) => ipcRenderer.invoke(IPC.PROJECTS_DELETE, name),
  getActiveProject: () => ipcRenderer.invoke(IPC.PROJECTS_GET_ACTIVE),
  setActiveProject: (name: string) => ipcRenderer.invoke(IPC.PROJECTS_SET_ACTIVE, name),

  // App
  getPlatform: () => process.platform,
});
