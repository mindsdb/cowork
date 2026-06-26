// Unified update orchestrator for the Electron desktop app.
//
// Coordinates UI bundle (OTA) and server (cowork-server) updates.
// Both respect the auto/manual update mode and are always applied
// together — server first (for API compatibility), then UI, then
// window reload.
//
// Usage from index.ts:
//   import { initUpdater } from './updater';
//   initUpdater(mainWindow);   // after createWindow + server start

import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { checkForUIUpdate, applyUIUpdate, getRendererPath, hasInternet } from './ui-updater';
import { checkForServerUpdate, maybeUpdateServer } from './server-updater';

const UPDATE_POLL_MS = 4 * 60 * 60 * 1000; // 4 hours

type UpdateMode = 'auto' | 'manual';

interface UpdateCheckResult {
  uiAvailable: boolean;
  uiVersion?: string;
  serverAvailable: boolean;
  serverCurrentVersion?: string;
  serverLatestVersion?: string;
}

/** Check both UI and server for available updates. */
async function checkAll(): Promise<UpdateCheckResult | null> {
  const online = await hasInternet();
  if (!online) return null;

  const [ui, server] = await Promise.all([
    checkForUIUpdate(),
    checkForServerUpdate(),
  ]);

  return {
    uiAvailable: ui.updateAvailable,
    uiVersion: ui.newVersion,
    serverAvailable: server.updateAvailable,
    serverCurrentVersion: server.currentVersion,
    serverLatestVersion: server.latestVersion,
  };
}

/** Apply all available updates: server first, then UI, then reload. */
async function applyAll(win: BrowserWindow): Promise<boolean> {
  const serverCheck = await checkForServerUpdate();
  if (serverCheck.updateAvailable) {
    console.log(`[updater] applying server update: ${serverCheck.currentVersion} → ${serverCheck.latestVersion}`);
    const result = await maybeUpdateServer();
    if (result.updated) {
      console.log(`[updater] server updated: ${result.previousVersion} → ${result.newVersion}`);
    } else if (result.error) {
      console.error(`[updater] server update failed: ${result.error}`);
    }
  }

  const uiApplied = await applyUIUpdate();
  if (uiApplied) {
    console.log('[updater] UI update applied');
  }

  // Reload if anything changed — new UI bundle, or new server APIs.
  const anyChanged = uiApplied || serverCheck.updateAvailable;
  if (anyChanged) {
    console.log('[updater] reloading window');
    win.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'reloading' });
    win.loadFile(getRendererPath());
  }

  return anyChanged;
}

function notify(win: BrowserWindow, phase: string, extra?: Record<string, unknown>) {
  win.webContents.send(IPC.UI_UPDATE_STATUS, { phase, ...extra });
}

function log(check: UpdateCheckResult) {
  if (check.uiAvailable) console.log(`[updater] UI update available: ${check.uiVersion}`);
  if (check.serverAvailable) console.log(`[updater] server update available: ${check.serverCurrentVersion} → ${check.serverLatestVersion}`);
}

/**
 * Run a single update check cycle.
 *
 * @param win        — the main BrowserWindow
 * @param mode       — 'auto' or 'manual'
 * @param autoApply  — if true AND mode is 'auto', apply immediately
 */
async function runCheck(win: BrowserWindow, mode: UpdateMode, autoApply: boolean): Promise<void> {
  const check = await checkAll();

  if (!check) {
    console.log('[updater] offline — skipping');
    if (autoApply) notify(win, 'offline');
    return;
  }

  if (!check.uiAvailable && !check.serverAvailable) {
    console.log('[updater] everything up to date');
    if (autoApply) notify(win, 'up-to-date');
    return;
  }

  log(check);

  if (autoApply && mode === 'auto') {
    if (check.serverAvailable) await maybeUpdateServerQuietly();
    if (check.uiAvailable) {
      notify(win, 'downloading', { version: check.uiVersion });
      const applied = await applyUIUpdate();
      if (applied) {
        notify(win, 'reloading');
        win.loadFile(getRendererPath());
        return;
      }
    }
    // Server updated but UI didn't change — still reload for API compat
    if (check.serverAvailable) {
      notify(win, 'reloading');
      win.loadFile(getRendererPath());
    }
  } else {
    notify(win, 'available', {
      version: check.uiVersion,
      serverUpdate: check.serverAvailable,
      serverVersion: check.serverLatestVersion,
    });
  }
}

async function maybeUpdateServerQuietly(): Promise<void> {
  const result = await maybeUpdateServer();
  if (result.updated) {
    console.log(`[updater] server updated: ${result.previousVersion} → ${result.newVersion}`);
  } else if (result.error) {
    console.error(`[updater] server update failed: ${result.error}`);
  }
}

/**
 * Initialize the update system. Call once after the server is running
 * and the renderer has loaded.
 */
export function initUpdater(
  win: BrowserWindow,
  rendererReady: Promise<void>,
  getMode: () => UpdateMode,
) {
  // IPC handler: user clicks "Install"
  const { ipcMain } = require('electron');
  ipcMain.handle(IPC.UI_UPDATE_CHECK, () => checkForUIUpdate());
  ipcMain.handle(IPC.UI_UPDATE_APPLY, async () => {
    console.log('[updater] apply requested via IPC');
    return applyAll(win);
  });

  // Boot check + periodic polling
  rendererReady.then(async () => {
    console.log(`[updater] boot check (mode: ${getMode()})...`);
    await runCheck(win, getMode(), true).catch((err) =>
      console.error('[updater] boot check failed:', err),
    );

    setInterval(async () => {
      console.log(`[updater] periodic check (mode: ${getMode()})...`);
      await runCheck(win, getMode(), false).catch((err) =>
        console.error('[updater] periodic check failed:', err),
      );
    }, UPDATE_POLL_MS);
  });
}
