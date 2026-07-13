// Unified update orchestrator for the Electron desktop app.
// Coordinates UI bundle (OTA) and server (cowork-server) updates.
// Both respect the auto/manual update mode and are always applied
// together — server first, then UI, then window reload.

import { app, BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { checkForUIUpdate, applyUIUpdate, getRendererPath, hasInternet } from './ui-updater';
import { checkForServerUpdate, maybeUpdateServer } from './server-updater';
import { isServerRunning } from './server-process';
import { decideUpdateApply } from './update-logic';

const UPDATE_POLL_MS = 4 * 60 * 60 * 1000; // 4 hours

type GetWindow = () => BrowserWindow | null;

async function applyServerUpdate(): Promise<void> {
  const result = await maybeUpdateServer();
  if (result.updated) console.log(`[updater] server updated: ${result.previousVersion} → ${result.newVersion}`);
  else if (result.error) console.error(`[updater] server update failed: ${result.error}`);
}

// Resolve a live window at the moment of use. The window can be closed
// and later recreated (on macOS, closing keeps the app alive and dock
// re-activate reassigns mainWindow), so we must never hold a captured
// reference across awaits or across the long-lived poll interval — a
// stale/destroyed handle throws "Object has been destroyed" on send/reload.
function liveWindow(getWindow: GetWindow): BrowserWindow | null {
  const win = getWindow();
  return win && !win.isDestroyed() ? win : null;
}

function sendStatus(getWindow: GetWindow, payload: Record<string, unknown>) {
  liveWindow(getWindow)?.webContents.send(IPC.UI_UPDATE_STATUS, payload);
}

function reload(getWindow: GetWindow) {
  const win = liveWindow(getWindow);
  if (!win) return;
  win.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'reloading' });
  win.loadFile(getRendererPath());
}

// Apply server (if requested) then UI, and reload if either landed. Shared by
// the manual IPC apply and the boot/periodic poll. Args are "apply this",
// already resolved against update mode + server health by the caller.
async function applyUpdates(getWindow: GetWindow, applyServer: boolean, applyUi: boolean): Promise<boolean> {
  if (applyServer) await applyServerUpdate();
  const uiApplied = applyUi ? await applyUIUpdate() : false;
  if (uiApplied || applyServer) reload(getWindow);
  return uiApplied || applyServer;
}

// Register the update IPC handlers. Called unconditionally at startup so the
// renderer can always check/apply (e.g. a manual "Check for updates" action) —
// independent of packaging, DEV_MODE, or whether the server booted. Both
// checkForUIUpdate() and applyUIUpdate() self-guard (OTA disable + manifest),
// so they're safe to expose in every build.
export function registerUpdateHandlers(getWindow: GetWindow) {
  const { ipcMain } = require('electron');

  ipcMain.handle(IPC.UI_UPDATE_CHECK, () => checkForUIUpdate());
  ipcMain.handle(IPC.UI_UPDATE_APPLY, async () => {
    // A manual apply always re-checks the server so it can't drift from the UI.
    const server = await checkForServerUpdate();
    return applyUpdates(getWindow, server.updateAvailable, true);
  });
}

// Start update polling: a boot check (may auto-apply in auto mode) plus a
// periodic re-check every 4h (banner only, never auto-applies). Gated by the
// caller to packaged, non-DEV builds.
export function initUpdater(
  getWindow: GetWindow,
  rendererReady: Promise<void>,
  getMode: () => 'auto' | 'manual',
) {
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

    // A down server turns an "available" server update into a recovery action:
    // apply it regardless of mode (a newer build may be what fixes the boot).
    const { applyServer, applyUi } = decideUpdateApply({
      serverUpdateAvailable: server.updateAvailable,
      uiUpdateAvailable: ui.updateAvailable,
      serverDown: !isServerRunning(),
      isBootCheck: autoApply,
      mode: getMode(),
    });

    if (applyServer || applyUi) {
      if (applyServer && !isServerRunning()) console.log('[updater] server is down — applying server update to recover');
      await applyUpdates(getWindow, applyServer, applyUi);
    } else {
      sendStatus(getWindow, {
        phase: 'available',
        // Interim: surface whichever version we have so the banner never
        // renders blank. Longer term this collapses to one unified version.
        version: ui.newVersion ?? server.latestVersion,
        serverUpdate: server.updateAvailable,
        serverVersion: server.latestVersion,
      });
    }
  }

  rendererReady.then(async () => {
    console.log(`[updater] boot check (mode: ${getMode()})...`);
    await poll(true).catch(err => console.error('[updater] boot check failed:', err));

    const timer = setInterval(() => {
      console.log(`[updater] periodic check (mode: ${getMode()})...`);
      poll(false).catch(err => console.error('[updater] periodic check failed:', err));
    }, UPDATE_POLL_MS);

    // Don't let the interval keep the process alive, and stop polling on quit.
    timer.unref?.();
    app.on('before-quit', () => clearInterval(timer));
  });
}
