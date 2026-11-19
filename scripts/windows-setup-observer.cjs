// Session preloads run before the app's preload. Observe the real installer before
// the bundled setup screen mounts; never start installation from this observer.
if (process.isMainFrame) {
  const { contextBridge, ipcRenderer } = require('electron');
  const documentId = require('node:crypto').randomUUID();
  const state = { documentId, steps: [], done: false, error: '', cancelled: false, returned: null, log: '', startCalls: 0 };
  ipcRenderer.on('install:log', (_event, line) => { state.log += line; });
  ipcRenderer.on('install:progress', (_event, steps) => { state.steps = steps; });
  ipcRenderer.on('install:done', () => { state.done = true; });
  ipcRenderer.on('install:error', (_event, error) => { state.error = error; });
  ipcRenderer.on('install:cancelled', () => { state.cancelled = true; });

  const invoke = ipcRenderer.invoke.bind(ipcRenderer);
  ipcRenderer.invoke = async (channel, ...args) => {
    // Route the credential-free profile to setup. This changes only the renderer's
    // onboarding decision, not saved settings, installation checks, or installer IPC.
    if (channel === 'settings:check-configured' && state.startCalls === 0) return { configured: true, provider: '' };
    if (channel !== 'install:start') return invoke(channel, ...args);
    state.startCalls += 1;
    try {
      const value = await invoke(channel, ...args);
      state.returned = value;
      return value;
    } catch (error) {
      state.error = String(error);
      state.returned = false;
      throw error;
    }
  };
  contextBridge.exposeInMainWorld('__setupSmoke', { snapshot: () => state });
}
