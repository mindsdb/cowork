// Unified update orchestrator for the Electron desktop app.
// Coordinates UI bundle (OTA) and server (cowork-server) updates.
// Both auto-apply at boot (ENG-858) — the auto/manual mode is now an
// env-only escape hatch (UI_UPDATE_MODE in ~/.anton/.env), not a user
// setting. Applied together — server first, then UI, then window reload.

import { app, BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { checkForUIUpdate, applyUIUpdate, getRendererPath, hasInternet, rollbackUI, isServingOta, verifyServedUiCompat } from './ui-updater';
import type { UpdateCheckResult } from './ui-updater';
import { checkForServerUpdate, maybeUpdateServer } from './server-updater';
import { isServerRunning } from './server-process';
import { decideUpdateApply } from './update-logic';

const UPDATE_POLL_MS = 4 * 60 * 60 * 1000; // 4 hours
// How long a freshly-activated UI bundle has to finish loading before we treat
// it as broken and roll back. Generous — a cold renderer + slow disk is fine.
const UI_RELOAD_HEALTH_MS = 15000;

type GetWindow = () => BrowserWindow | null;

// Returns whether the server is in a good state to proceed with a UI update:
// true if it was updated cleanly or was already current, false if an update was
// attempted and failed (in which case it has rolled back to the old server).
async function applyServerUpdate(): Promise<boolean> {
  const result = await maybeUpdateServer();
  if (result.updated) {
    console.log(`[updater] server updated: ${result.previousVersion} → ${result.newVersion}`);
    return true;
  }
  if (result.error) {
    console.error(`[updater] server update failed: ${result.error}`);
    return false;
  }
  return true; // already current
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

// Load `filePath` and resolve true only if the main frame finishes loading
// within the timeout. A main-frame `did-fail-load` (missing/corrupt bundle
// assets) or a timeout resolves false — the caller rolls back on false. This
// is the post-swap health gate (R4) for a hot-updated UI bundle.
function loadAndVerify(win: BrowserWindow, filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.webContents.removeListener('did-finish-load', onOk);
      win.webContents.removeListener('did-fail-load', onFail);
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onFail = (
      _e: unknown,
      errorCode: number,
      _desc: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      // Only the main frame matters; ERR_ABORTED (-3) is a benign superseded
      // load, not a failure.
      if (!isMainFrame || errorCode === -3) return;
      finish(false);
    };
    const timer = setTimeout(() => finish(false), UI_RELOAD_HEALTH_MS);
    win.webContents.on('did-finish-load', onOk);
    win.webContents.on('did-fail-load', onFail);
    win.loadFile(filePath);
  });
}

// Reload into a freshly-activated UI bundle and verify it loads. If it doesn't,
// roll the bundle back and reload whatever we fall back to (previous cache or
// the app-bundled renderer) — a bad hot-update must never brick the window.
async function reloadWithUiHealthCheck(getWindow: GetWindow): Promise<void> {
  const win = liveWindow(getWindow);
  if (!win) return;
  win.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'reloading' });
  if (await loadAndVerify(win, getRendererPath())) return;

  console.error('[updater] new UI bundle failed to load — rolling back');
  rollbackUI();
  const win2 = liveWindow(getWindow);
  if (!win2) return;
  win2.webContents.send(IPC.UI_UPDATE_STATUS, { phase: 'rolled-back' });
  // Best-effort: the fallback (previous cache / bundled) should always load.
  await loadAndVerify(win2, getRendererPath());
}

// Apply server (if requested) then UI, and reload if either landed. Shared by
// the manual IPC apply and the boot/periodic poll. Args are "apply this",
// already resolved against update mode + server health by the caller.
async function applyUpdates(getWindow: GetWindow, applyServer: boolean, applyUi: boolean): Promise<boolean> {
  const serverOk = applyServer ? await applyServerUpdate() : true;
  // Never activate a UI bundle on top of a server update that failed (and thus
  // rolled back to the old server) — the tandem coupling only holds when the
  // server is current. Defer the UI to the next pass.
  if (applyUi && !serverOk) console.warn('[updater] server update failed — deferring UI update this pass');
  const uiApplied = applyUi && serverOk ? await applyUIUpdate() : false;
  if (uiApplied) {
    // A UI bundle was swapped — verify it loads and roll back if not (R4).
    await reloadWithUiHealthCheck(getWindow);
  } else if (applyServer && serverOk) {
    // Server-only update: reload the same (unchanged) renderer, no rollback.
    reload(getWindow);
  }
  return uiApplied || (applyServer && serverOk);
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

// After the boot poll (server now current), re-verify a constrained OTA cache
// that booted bundled. If it's now compatible, swap it in through the
// health-checked reload (loadAndVerify + rollback-on-failure), so this
// post-verification load is protected the same way an apply-time reload is. If
// still incompatible/unverifiable it stays deferred (bundled) — never rolled
// back here; only a real renderer-load failure quarantines a bundle.
async function settleConstrainedCache(getWindow: GetWindow): Promise<void> {
  if (isServingOta()) return; // already serving an OTA bundle (unconstrained / verified)
  const outcome = await verifyServedUiCompat();
  if (outcome === 'verified' && isServingOta()) {
    console.log('[updater] constrained OTA cache verified against server — activating with health check');
    await reloadWithUiHealthCheck(getWindow);
  }
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
    // hasInternet() probes the OTA manifest host (GitHub Pages). The server
    // update lives on different hosts (git remote / PyPI) with its own
    // fail-safe checks, so a down manifest host must only skip the UI check —
    // never suppress a server update (which may be the fix a user needs).
    const manifestReachable = await hasInternet();
    if (!manifestReachable) console.log('[updater] manifest host unreachable — checking server only');

    const uiSkipped: UpdateCheckResult = { updateAvailable: false, applied: false };
    const [ui, server] = await Promise.all([
      manifestReachable ? checkForUIUpdate() : Promise.resolve(uiSkipped),
      checkForServerUpdate(),
    ]);

    if (!ui.updateAvailable && !server.updateAvailable) {
      console.log('[updater] everything up to date');
      return;
    }

    if (ui.updateAvailable) console.log(`[updater] UI update available: ${ui.newVersion}`);
    if (server.updateAvailable) console.log(`[updater] server update: ${server.currentVersion} → ${server.latestVersion}`);

    // A UI held back only for server-compat is still a candidate when a server
    // update is also pending: the server-first apply brings the server current,
    // and applyUIUpdate re-checks compat against it in the same pass — so a
    // coordinated release doesn't strand the UI until the next restart.
    const uiCandidate = ui.updateAvailable || (!!ui.skippedReason && server.updateAvailable);
    if (ui.skippedReason && server.updateAvailable) {
      console.log(`[updater] UI deferred for compat (${ui.skippedReason}); will retry after the server update`);
    }

    // A down server turns an "available" server update into a recovery action:
    // apply it regardless of mode (a newer build may be what fixes the boot).
    const { applyServer, applyUi } = decideUpdateApply({
      serverUpdateAvailable: server.updateAvailable,
      uiUpdateAvailable: uiCandidate,
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

    // The boot poll has now brought the server current (server-first). Re-verify
    // a constrained OTA cache that booted bundled (fail-closed) and, if it's now
    // compatible, swap it in through the health-checked reload so a corrupt or
    // hanging bundle still self-heals.
    await settleConstrainedCache(getWindow).catch(err => console.error('[updater] compat settle failed:', err));

    const timer = setInterval(() => {
      console.log(`[updater] periodic check (mode: ${getMode()})...`);
      poll(false).catch(err => console.error('[updater] periodic check failed:', err));
    }, UPDATE_POLL_MS);

    // Don't let the interval keep the process alive, and stop polling on quit.
    timer.unref?.();
    app.on('before-quit', () => clearInterval(timer));
  });
}
