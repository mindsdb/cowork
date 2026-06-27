// Unified update orchestrator for the Electron desktop app.
// Coordinates UI bundle (OTA) and server (cowork-server) updates.
// Both respect the auto/manual update mode and are always applied
// together — server first, then UI, then window reload.

import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { checkForUIUpdate, applyUIUpdate, getRendererPath, hasInternet } from './ui-updater';
import { checkForServerUpdate, maybeUpdateServer } from './server-updater';

const UPDATE_POLL_MS = 4 * 60 * 60 * 1000; // 4 hours

async function applyServerUpdate(): Promise<void> {
  const result = await maybeUpdateServer();
  if (result.updated) console.log(`[updater] server updated: ${result.previousVersion} → ${result.newVersion}`);
  else if (result.error) console.error(`[updater] server update failed: ${result.error}`);
}

function reload(win: BrowserWindow) {
  win.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'reloading' });
  win.loadFile(getRendererPath());
}

export function initUpdater(
  win: BrowserWindow,
  rendererReady: Promise<void>,
  getMode: () => 'auto' | 'manual',
) {
  const { ipcMain } = require('electron');

  ipcMain.handle(IPC.UI_UPDATE_CHECK, () => checkForUIUpdate());
  ipcMain.handle(IPC.UI_UPDATE_APPLY, async () => {
    const server = await checkForServerUpdate();
    if (server.updateAvailable) await applyServerUpdate();
    const uiApplied = await applyUIUpdate();
    if (uiApplied || server.updateAvailable) reload(win);
    return uiApplied || server.updateAvailable;
  });

  async function poll(autoApply: boolean) {
    if (!await hasInternet()) {
      console.log('[updater] offline — skipping');
      return;
    }

    const [ui, server] = await Promise.all([checkForUIUpdate(), checkForServerUpdate()]);

    if (!ui.updateAvailable && !server.updateAvailable) {
      console.log('[updater] everything up to date');
      return;
    }

    if (ui.updateAvailable) console.log(`[updater] UI update available: ${ui.newVersion}`);
    if (server.updateAvailable) console.log(`[updater] server update: ${server.currentVersion} → ${server.latestVersion}`);

    if (autoApply && getMode() === 'auto') {
      if (server.updateAvailable) await applyServerUpdate();
      const uiApplied = ui.updateAvailable ? await applyUIUpdate() : false;
      if (uiApplied || server.updateAvailable) reload(win);
    } else {
      win.webContents.send(IPC.UI_UPDATE_STATUS, {
        phase: 'available',
        version: ui.newVersion,
        serverUpdate: server.updateAvailable,
        serverVersion: server.latestVersion,
      });
    }
  }

  rendererReady.then(async () => {
    console.log(`[updater] boot check (mode: ${getMode()})...`);
    await poll(true).catch(err => console.error('[updater] boot check failed:', err));

    setInterval(async () => {
      console.log(`[updater] periodic check (mode: ${getMode()})...`);
      await poll(false).catch(err => console.error('[updater] periodic check failed:', err));
    }, UPDATE_POLL_MS);
  });
}
