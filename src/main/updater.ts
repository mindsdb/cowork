// Unified update orchestrator for the Electron desktop app.
// Coordinates UI bundle (OTA) and server (cowork-server) updates.
// Both auto-apply at boot (ENG-858) — the auto/manual mode is now an
// env-only escape hatch (UI_UPDATE_MODE in the Cowork home's .env), not a user
// setting. Applied together — server first, then UI, then window reload.
//
// It also holds the one update coordinator (src/shared/update-coordinator.ts):
// every status this module, the server updater and the shell updater emit is
// fed into it, and the renderer renders the loading screen, the sidebar banner
// and Settings from the state it pushes on UPDATE_STATE. The three legacy
// status channels keep emitting for renderers older than that channel.

import { app, BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { checkForUIUpdate, applyUIUpdate, getRendererPath, hasInternet, rollbackUI, isServingOta, verifyServedUiCompat, fetchManifest, getCachedVersion, lastUiApplyAttempt } from './ui-updater';
import type { UpdateCheckResult } from './ui-updater';
import { checkForServerUpdate, maybeUpdateServer, type ServerUpdateCheckResult } from './server-updater';
import { isServerRunning } from './server-process';
import { countRunningTasks } from './running-tasks';
import { decideUpdateApply, summarizeUpdateCheck, shellUpdateIsNewer, shellDownloadUrl, shellAutoUpdateIsActive, shellManualNoticeIsFallback } from './update-logic';
import type { UpdateCheckSummary } from '../shared/update-types';
import type { RestartRequestResult } from '../shared/restart-confirmation';
import {
  createUpdateCoordinator,
  resolveApplyAction,
  serverLabel as serverLabelFor,
  type OtaStatus,
  type ServerStatus,
  type UpdateAction,
} from '../shared/update-coordinator';
import { buildKindStrict } from './cowork-home';
import { getAppDisplayVersion } from './server-source';
import {
  checkShellAutoUpdate,
  configureShellAutoUpdate,
  downloadShellAutoUpdate,
  getShellAutoUpdateSnapshot,
  onShellAutoUpdateSnapshot,
  registerShellAutoUpdateHandlers,
  requestShellInstall,
  startShellAutoUpdatePolling,
} from './shell-auto-update-runtime';
import type { ShellUpdateSnapshot } from './shell-update-state';
import { withUpdateMaintenance } from './update-maintenance';
import { recordUpdatePhase, serverOutcomeRecord, uiOutcomeRecord, type UiReloadOutcome, type UpdateJournalTrigger } from './update-journal';

const UPDATE_POLL_MS = 4 * 60 * 60 * 1000; // 4 hours
// How long a freshly-activated UI bundle has to finish loading before we treat
// it as broken and roll back. Generous — a cold renderer + slow disk is fine.
const UI_RELOAD_HEALTH_MS = 15000;

type GetWindow = () => BrowserWindow | null;

/** The one aggregate update state. Exported for the IPC handlers and tests. */
export const updateCoordinator = createUpdateCoordinator();

// Where status pushes go. Set by registerUpdateHandlers and initUpdater, so a
// manual check (which has no window of its own) can push like the poll does.
let windowRef: GetWindow = () => null;

// Cached so the renderer can recover the notice after an OTA reload.
let lastShellStatus: ShellUpdateStatus = { available: false };

// The UI bundle the last check offered, or null. A manual apply always asks
// for the UI, so this is how its journal entry knows whether a UI apply that
// landed nothing was a failure or just a server-only update, and which
// version the failed or skipped attempt was for.
let lastUiOffer: string | null = null;

function rememberUiOffer(result: UpdateCheckResult): void {
  lastUiOffer = result.updateAvailable ? result.newVersion ?? '' : null;
}

// The most recent server check, from any poll, manual check or apply. The apply
// handler reads it to decide whether a restart will stop the sidecar BEFORE it
// goes to the network (ENG-3291): the confirmation dialog must open within
// seconds, and the remote check can take ten. A forced apply that follows the
// dialog reuses a check this fresh instead of running it again.
let lastServerCheck: { result: ServerUpdateCheckResult; at: number } | null = null;
/** How long an apply may reuse the server check that preceded its dialog. */
export const APPLY_SERVER_CHECK_REUSE_MS = 60_000;

async function checkServer(): Promise<ServerUpdateCheckResult> {
  const result = await checkForServerUpdate();
  lastServerCheck = { result, at: Date.now() };
  return result;
}

function serverUpdatePending(result: ServerUpdateCheckResult | undefined): boolean {
  return !!result && result.updateAvailable && !result.repair;
}

// Returns whether the server is in a good state to proceed with a UI update:
// true if it was updated cleanly or was already current, false if an update was
// attempted and failed (in which case it has rolled back to the old server).
async function applyServerUpdate(trigger: UpdateJournalTrigger): Promise<boolean> {
  const startedAt = Date.now();
  const result = await maybeUpdateServer();
  const record = serverOutcomeRecord(result, trigger, Date.now() - startedAt);
  if (record) recordUpdatePhase(record);
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

/** Every OTA status goes through here: into the coordinator first, then onto
 *  the legacy channel for renderers that predate UPDATE_STATE. */
function sendStatus(getWindow: GetWindow, payload: OtaStatus) {
  updateCoordinator.feed({ ota: payload });
  liveWindow(getWindow)?.webContents.send(IPC.UI_UPDATE_STATUS, payload);
}

// Map a server-updater notification onto the OTA status shape, so a server
// download shows progress on the loading screen and the in-app overlay
// (ENG-749). Only "busy" phases are mirrored: errors keep their own layer and
// must never leave the UI stuck in a spinner. Exported for app.ts's test.
export function serverPhaseToUiStatus(payload: Record<string, unknown>): OtaStatus | null {
  const phase = typeof payload.phase === 'string' ? payload.phase : '';
  const version = typeof payload.to === 'string' ? payload.to : undefined;
  if (phase === 'downloading') return { phase: 'downloading', ...(version ? { version } : {}) };
  if (phase === 'restarting') return { phase: 'reloading' };
  return null;
}

// How many applies hold the maintenance lock right now (0 or 1). The server
// progress mirror below is only meaningful inside one: the apply's finally
// settles whatever the mirror pushed, and nothing else would.
let applyDepth = 0;

// Restart requests that have announced `downloading` but have not finished:
// they are re-checking the server or waiting for the maintenance lock before
// `applyDepth` counts them, and they still own the status they pushed.
let applyRequestsPending = 0;

// The subset of those still waiting for the maintenance lock: another apply
// (the boot apply, say) holds it. That apply's settle must not clear the
// progress such a request announced; the request settles its own once it ran.
let queuedApplyRequests = 0;

/** A Restart request's place in the queue, handed to the apply it starts. */
interface ApplyRequestTicket { entered: boolean }

function leaveQueue(ticket: ApplyRequestTicket): void {
  if (ticket.entered) return;
  ticket.entered = true;
  queuedApplyRequests -= 1;
}

/** Clear the OTA status only if it still says an apply is in flight, and no
 *  queued request owns it. */
function inFlightOtaCleared(ota: OtaStatus | null): { ota?: null } {
  if (queuedApplyRequests > 0) return {};
  return ota?.phase === 'downloading' || ota?.phase === 'reloading' ? { ota: null } : {};
}

/** The server updater's progress (app.ts wires it in). The coordinator takes
 *  it raw for the server layer, and its busy phases are mirrored onto the OTA
 *  status, through the coordinator and the legacy channel alike, so `applying`
 *  reaches `reloading` during a server reinstall and the loading screen and
 *  overlay keep their copy. */
export function feedServerUpdateStatus(payload: Record<string, unknown>): void {
  const phase = payload.phase;
  if (phase !== 'downloading' && phase !== 'restarting' && phase !== 'error' && phase !== 'idle') return;
  const status: ServerStatus = {
    phase,
    ...(typeof payload.to === 'string' ? { to: payload.to } : {}),
    ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
    ...(payload.critical === true ? { critical: true } : {}),
  };
  updateCoordinator.feed({ server: status });
  const mirrored = serverPhaseToUiStatus(payload);
  if (!mirrored) return;
  if (applyDepth > 0) {
    sendStatus(windowRef, mirrored);
  } else {
    // No apply to settle it: keep the legacy renderer's progress line without
    // leaving the coordinator stuck in `applying`.
    liveWindow(windowRef)?.webContents.send(IPC.UI_UPDATE_STATUS, mirrored);
  }
}

/** The window is loading a renderer. The status that announced the apply
 *  belonged to the page being torn down: the coordinator lives in main and
 *  would otherwise hand `applying` to the fresh renderer, which would keep
 *  the overlay up and hide every later offer. A server reinstall that reached
 *  this point is over too (the server updater reports no completion of its
 *  own), unless it ended in an error worth keeping. */
function settleApplyStatus(): void {
  const { ota, server } = updateCoordinator.getInput();
  // Only what announced the apply is over. A `rolled-back` (or `error`)
  // pushed before the fallback load is the fresh renderer's to show.
  updateCoordinator.feed({
    ...inFlightOtaCleared(ota),
    ...(server?.phase === 'error' ? {} : { server: null }),
  });
  replayDeferredOffer();
}

/** False once the window or its webContents is gone. */
function contentsAlive(win: BrowserWindow): boolean {
  try {
    return !win.isDestroyed() && !win.webContents.isDestroyed();
  } catch {
    return false;
  }
}

// An offer a check found while an apply was in flight. Pushing it then would
// flip the coordinator out of `applying`: the overlay drops, the banner reads
// "Update ready" and a second click queues another apply behind the first. It
// waits until the apply settles and is replayed only if it still applies.
let deferredOffer: OtaStatus | null = null;

/** An apply holds the lock, a Restart request is on its way to it, or a
 *  reload has not committed yet. */
function applyInFlight(): boolean {
  return applyDepth > 0 || applyRequestsPending > 0 || pendingNavigationSettle !== null;
}

/** Push what a check found, unless an apply is in flight; then hold it. An
 *  `idle` (the check found nothing) is simply dropped while applying: the
 *  settle clears the in-flight status itself. */
function pushOffer(getWindow: GetWindow, status: OtaStatus): void {
  if (!applyInFlight()) {
    deferredOffer = null;
    sendStatus(getWindow, status);
    return;
  }
  deferredOffer = status.phase === 'available' ? status : null;
}

/** After an apply settles: an offer found mid-apply still stands unless the
 *  apply landed the very UI it named, or left a failure the banner is already
 *  showing. */
function replayDeferredOffer(): void {
  // A reload commits (and settles) while its apply still waits for the page
  // to finish loading. Leave the offer for the apply's own final settle.
  if (applyInFlight()) return;
  const offer = deferredOffer;
  deferredOffer = null;
  if (!offer) return;
  if (updateCoordinator.getInput().ota) return;
  if (offer.uiUpdate && offer.uiVersion && offer.uiVersion === servedUiVersion()) return;
  sendStatus(windowRef, offer);
}

// A reload is in flight and the settle above is waiting for the navigation to
// commit. Until it does, the old page is still on screen and must keep its
// overlay: settling early pushes `applying: null` to it, and it drops to bare
// UI for the moment before the new document loads.
let pendingNavigationSettle: { cancel: () => void } | null = null;

/** Settle the apply status once `win`'s next main-frame navigation commits,
 *  or fails, or the health window elapses. Called right before `loadFile`.
 *  A newer reload supersedes an older one still waiting. */
function settleWhenNavigated(win: BrowserWindow): void {
  pendingNavigationSettle?.cancel();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (pendingNavigationSettle === entry) pendingNavigationSettle = null;
    if (timer) clearTimeout(timer);
    // The window can close before the navigation commits (macOS keeps main
    // alive); the health timer then fires against a destroyed webContents.
    if (!contentsAlive(win)) return;
    win.webContents.removeListener('did-navigate', done);
    win.webContents.removeListener('did-fail-load', onFail);
  };
  const done = () => {
    if (pendingNavigationSettle !== entry) return;
    cleanup();
    settleApplyStatus();
  };
  const onFail = (_e: unknown, errorCode: number, _desc: string, _url: string, isMainFrame: boolean) => {
    if (!isMainFrame || errorCode === -3) return;
    done();
  };
  const entry = { cancel: cleanup };
  pendingNavigationSettle = entry;
  timer = setTimeout(done, UI_RELOAD_HEALTH_MS);
  timer.unref?.();
  win.webContents.on('did-navigate', done);
  win.webContents.on('did-fail-load', onFail);
}

/** An apply has finished, on any path: reloaded, failed, nothing to do, or
 *  no window to load into. Whatever it still reports as in flight is over.
 *  A server error is kept (it is what Settings shows), and so is an offer
 *  or failure the apply left behind on purpose. A reload that has not
 *  committed yet settles itself when it does. */
function settleInFlightStatus(): void {
  if (pendingNavigationSettle) return;
  const { ota, server } = updateCoordinator.getInput();
  updateCoordinator.feed({
    ...inFlightOtaCleared(ota),
    ...(server?.phase === 'downloading' || server?.phase === 'restarting' ? { server: null } : {}),
  });
  replayDeferredOffer();
}

function reload(getWindow: GetWindow) {
  const win = liveWindow(getWindow);
  if (!win) return;
  sendStatus(getWindow, { phase: 'reloading' });
  settleWhenNavigated(win);
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
      if (contentsAlive(win)) {
        win.webContents.removeListener('did-finish-load', onOk);
        win.webContents.removeListener('did-fail-load', onFail);
      }
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
// Returns what happened, for the journal.
async function reloadWithUiHealthCheck(getWindow: GetWindow): Promise<UiReloadOutcome> {
  const win = liveWindow(getWindow);
  // The bundle is already activated and serves at the next boot; there is just
  // nothing to load it into now.
  if (!win) return 'unverified';
  sendStatus(getWindow, { phase: 'reloading' });
  settleWhenNavigated(win);
  if (await loadAndVerify(win, getRendererPath())) return 'applied';

  console.error('[updater] new UI bundle failed to load — rolling back');
  // Don't let an exhausted-retry rollback error skip the fallback reload below —
  // the user would be stranded on a broken renderer with no status (Medium 4).
  let outcome: UiReloadOutcome = 'rolled-back';
  try {
    await rollbackUI();
  } catch (err) {
    outcome = 'rollback-failed';
    console.error('[updater] UI rollback failed — falling back anyway', err);
  }
  const win2 = liveWindow(getWindow);
  if (!win2) return outcome;
  sendStatus(getWindow, { phase: 'rolled-back' });
  settleWhenNavigated(win2);
  // Best-effort: the fallback (previous cache / bundled) should always load.
  await loadAndVerify(win2, getRendererPath());
  return outcome;
}

/** The UI version in service right now: the OTA slot, else the bundled
 *  renderer. */
function servedUiVersion(): string {
  return getCachedVersion() ?? getAppDisplayVersion();
}

/** Swap in the staged bundle through the health-checked reload and journal
 *  the outcome against the version it replaced. */
async function activateUiAndJournal(getWindow: GetWindow, from: string, trigger: UpdateJournalTrigger, startedAt: number): Promise<void> {
  const to = getCachedVersion();
  const outcome = await reloadWithUiHealthCheck(getWindow);
  recordUpdatePhase(uiOutcomeRecord(outcome, { from, to }, trigger, Date.now() - startedAt));
}

// Apply server (if requested) then UI, and reload if either landed. Shared by
// the manual IPC apply and the boot/periodic poll. Args are "apply this",
// already resolved against update mode + server health by the caller.
async function applyUpdatesUnlocked(
  getWindow: GetWindow,
  applyServer: boolean,
  applyUi: boolean,
  trigger: UpdateJournalTrigger,
): Promise<boolean> {
  // Surface progress before the multi-second, server-down reinstall so the UI
  // shows "Updating…" instead of a bare config-not-ready state (ENG-749).
  // Keep the version the manual apply already announced (or the one the
  // coordinator derives from the pending layers), so the overlay never drops
  // to a bare "Updating…" until the server updater reports its own.
  if (applyServer) {
    const version = updateCoordinator.getState().version;
    sendStatus(getWindow, { phase: 'downloading', ...(version ? { version } : {}) });
  }
  const serverOk = applyServer ? await applyServerUpdate(trigger) : true;
  // Never activate a UI bundle on top of a server update that failed (and thus
  // rolled back to the old server) — the tandem coupling only holds when the
  // server is current. Defer the UI to the next pass.
  const uiFrom = servedUiVersion();
  if (applyUi && !serverOk) {
    console.warn('[updater] server update failed — deferring UI update this pass');
    if (lastUiOffer !== null) recordUpdatePhase({ channel: 'ui', phase: 'skipped', trigger, errorCode: 'server-update-failed', from: uiFrom, to: lastUiOffer || null });
  }
  const uiStartedAt = Date.now();
  const uiApplied = applyUi && serverOk ? await applyUIUpdate() : false;
  if (applyUi && serverOk && !uiApplied) {
    // Credit the outcome to the version the apply actually tried: it re-reads
    // the manifest, so a release published since the check is what it
    // downloads. A download that ran and failed (download, checksum,
    // extraction or activation; ui-updater logged which) is a failure of that
    // version. An offer the apply never downloaded (withdrawn, quarantined, or
    // held for server compat) is a skip of the offered version.
    const attempted = lastUiApplyAttempt();
    const durationMs = Date.now() - uiStartedAt;
    if (attempted) {
      recordUpdatePhase({ channel: 'ui', phase: 'failed', trigger, errorCode: 'not-applied', from: uiFrom, to: attempted, durationMs });
    } else if (lastUiOffer !== null) {
      recordUpdatePhase({ channel: 'ui', phase: 'skipped', trigger, errorCode: 'not-attempted', from: uiFrom, to: lastUiOffer || null, durationMs });
    }
  }
  // One offer, one attempt, one entry: the next check decides again whether
  // a UI is pending, so a later apply in the same session (a server-only
  // restart, say) is not journaled as a failed UI update.
  if (applyUi && serverOk) lastUiOffer = null;
  if (uiApplied) {
    // A UI bundle was swapped — verify it loads and roll back if not (R4).
    await activateUiAndJournal(getWindow, uiFrom, trigger, uiStartedAt);
  } else if (applyServer && serverOk) {
    // Server-only update: reload the same (unchanged) renderer, no rollback.
    reload(getWindow);
  }
  return uiApplied || (applyServer && serverOk);
}

function applyUpdates(
  getWindow: GetWindow,
  applyServer: boolean,
  applyUi: boolean,
  trigger: UpdateJournalTrigger,
  ticket?: ApplyRequestTicket,
): Promise<boolean> {
  return withUpdateMaintenance(async () => {
    // A reload from an earlier apply that never committed is superseded by
    // this one; its settle must not fire over this apply's status.
    pendingNavigationSettle?.cancel();
    if (ticket && !ticket.entered) {
      leaveQueue(ticket);
      // The apply it waited behind may have pushed over its progress (a
      // reload, an error). Say again that this one is under way.
      const ota = updateCoordinator.getInput().ota;
      if (ota?.phase !== 'downloading' && ota?.phase !== 'reloading') {
        sendStatus(getWindow, { phase: 'downloading', version: updateCoordinator.getState().version });
      }
    }
    applyDepth += 1;
    try {
      return await applyUpdatesUnlocked(getWindow, applyServer, applyUi, trigger);
    } finally {
      applyDepth -= 1;
      // Every path, not only the reload: a failed boot server install and an
      // apply with no live window both end without one, and the status they
      // pushed would otherwise hold the overlay up and hide every offer.
      settleInFlightStatus();
    }
  });
}

/** The `available` status for a pending UI and/or server update. Names each
 *  layer explicitly for the coordinator; `version` keeps the legacy "whichever
 *  we have" value so older renderers never render a blank banner. */
export function availableStatus(
  ui: { updateAvailable: boolean; newVersion?: string },
  server: { updateAvailable: boolean; latestVersion?: string; component?: 'cowork-server' | 'anton-agent' },
): OtaStatus {
  // An anton-only server update (ENG-1094) shares cowork-server's version,
  // so a bare version number would read as blank/wrong — name the component
  // that's actually changing, by the one rule the banner uses too.
  const serverLabel = server.updateAvailable
    ? serverLabelFor({ status: 'ready', version: server.latestVersion, component: server.component })
    : undefined;
  return {
    phase: 'available',
    version: (ui.updateAvailable ? ui.newVersion : undefined) ?? serverLabel,
    uiUpdate: ui.updateAvailable,
    uiVersion: ui.updateAvailable ? ui.newVersion : undefined,
    serverUpdate: server.updateAvailable,
    serverVersion: server.updateAvailable ? server.latestVersion : undefined,
    serverComponent: server.updateAvailable ? server.component : undefined,
  };
}

// Detection only. Each channel reports its own errors so a confirmed update can
// still win when another channel is inconclusive.
export async function checkForUpdates(): Promise<UpdateCheckSummary> {
  const [ui, server, shell, shellAuto] = await Promise.all([
    checkForUIUpdate().then((result) => { rememberUiOffer(result); return result; }),
    checkServer(),
    checkForShellUpdate().catch(() => ({ available: false as const })),
    // The stateful shell updater owns background download/install. This call
    // coalesces the user's manual trigger with any boot/periodic check already
    // in flight; its snapshot is folded into the summary below so a manual
    // check can't report "up to date" while it is downloading or ready.
    checkShellAutoUpdate('manual').catch(() => undefined),
  ]);
  // On stable the legacy prod-only checkForShellUpdate() always reports nothing,
  // so the auto-updater is the only signal that a shell update is in flight.
  const shellAutoActive = !!shellAuto && shellAutoUpdateIsActive(shellAuto.phase);
  // A pending stream repair is boot-only; the manual check must not offer it.
  const surfaceServer = server.updateAvailable && !server.repair;
  const summary = summarizeUpdateCheck({
    ui: { updateAvailable: ui.updateAvailable, newVersion: ui.newVersion, error: ui.error },
    server: { updateAvailable: surfaceServer, latestVersion: server.latestVersion, error: server.error, component: server.component },
    shell: shell.available
      ? { updateAvailable: true, version: shell.latestVersion, downloadUrl: shell.downloadUrl ?? undefined }
      : shellAutoActive
        ? { updateAvailable: true, version: shellAuto?.targetVersion }
        : { updateAvailable: false },
  });
  // What the check found is what the one banner shows: a manual check that
  // finds a UI or server update feeds the same state the poll does, and one
  // that finds the install current clears a stale offer.
  // An apply in flight keeps its status; what the check found waits for it
  // (pushOffer), so the overlay cannot drop mid-apply.
  if (summary.ok) {
    if (summary.uiUpdateAvailable || summary.serverUpdateAvailable) {
      pushOffer(windowRef, availableStatus(ui, { updateAvailable: surfaceServer, latestVersion: server.latestVersion, component: server.component }));
    } else if (updateCoordinator.getInput().ota?.phase === 'available') {
      pushOffer(windowRef, { phase: 'idle' });
    }
  }
  // The installer notice is the fallback for when the auto-updater is off or
  // terminally failed, the same gate the poll applies (ENG-1739). A healthy
  // auto-updater whose feed merely lags latest.json must not raise a Download
  // banner for an update it will install itself.
  const autoSnap = shellAuto ?? getShellAutoUpdateSnapshot();
  rememberShellManual(shellManualNoticeIsFallback(autoSnap.phase, autoSnap.recoverable) ? shell : { available: false });
  return summary;
}

/** The manual installer check is the authority on its notice whenever it
 *  runs: a notice it no longer reports is cleared, for the coordinator and
 *  for older renderers that pull it. */
function rememberShellManual(shell: ShellUpdateStatus): void {
  lastShellStatus = shell;
  updateCoordinator.feed({
    shellManual: shell.available && shell.latestVersion
      ? { version: shell.latestVersion, currentVersion: shell.currentVersion, downloadUrl: shell.downloadUrl ?? null }
      : null,
  });
}

let statePushWired = false;

// Register unconditionally; each updater self-gates for unsupported builds.
export function registerUpdateHandlers(getWindow: GetWindow) {
  const { ipcMain } = require('electron');
  windowRef = getWindow;

  ipcMain.handle(IPC.UI_UPDATE_CHECK, () => checkForUpdates());
  ipcMain.handle(IPC.UI_SHELL_UPDATE_GET, () => lastShellStatus);
  ipcMain.handle(IPC.UI_UPDATE_APPLY, (_event: unknown, options?: { force?: boolean }) => (
    handleApplyRequest(getWindow, options)
  ));
  ipcMain.handle(IPC.UPDATE_STATE_GET, () => updateCoordinator.getState());
  ipcMain.handle(IPC.UPDATE_APPLY, (_event: unknown, options?: { force?: boolean; action?: UpdateAction }) => (
    handleUnifiedApply(getWindow, options)
  ));
  if (!statePushWired) {
    statePushWired = true;
    updateCoordinator.subscribe((state) => {
      liveWindow(getWindow)?.webContents.send(IPC.UPDATE_STATE, state);
    });
  }
  registerShellAutoUpdateHandlers();
}

/** The renderer's apply request (ENG-3291). Exported for its test; the
 *  UI_UPDATE_APPLY handler is a one-line delegate. */
export async function handleApplyRequest(
  getWindow: GetWindow,
  options?: { force?: boolean },
): Promise<boolean | { confirm: true; runningTasks: number | null }> {
  // A server update stops the sidecar, which ends every running turn. Unless
  // the renderer has already asked, report the count back and let it ask
  // (ENG-3291). A UI-only apply reloads the window and leaves turns running.
  // The last check already says whether a server update is pending (it is
  // what put the Restart in front of the user), so ask BEFORE the remote
  // re-check below: that check can take ten seconds, and the dialog must
  // open within three.
  const asked = !options?.force;
  let confirmed = false;
  if (asked && isServerRunning() && serverUpdatePending(lastServerCheck?.result)) {
    const runningTasks = await countRunningTasks();
    if (runningTasks === null || runningTasks > 0) return { confirm: true, runningTasks };
    confirmed = true;
  }
  // The click has been answered: say the restart is going ahead now, before
  // the remote re-check below, which can take ten seconds. Until this push
  // the banner still reads "Update ready" and a second click is dropped.
  const offer = updateCoordinator.getInput().ota;
  // A check that lands while this request runs holds its offer (pushOffer);
  // it is newer than the one the click answered, so it wins on the way back.
  const restoreOffer = () => {
    const next = deferredOffer ?? offer;
    deferredOffer = null;
    sendStatus(getWindow, next ?? { phase: 'idle' });
  };
  sendStatus(getWindow, { phase: 'downloading', version: updateCoordinator.getState().version });
  // From here this request owns the status until it returns. The re-check
  // below and the wait for the maintenance lock come before `applyDepth`
  // counts the apply, so count the request itself.
  applyRequestsPending += 1;
  queuedApplyRequests += 1;
  const ticket: ApplyRequestTicket = { entered: false };
  try {
    return await runApplyRequest(getWindow, options, { asked, confirmed, offer, restoreOffer, ticket });
  } finally {
    // A request that returned before its apply ran (a dialog, a throw) is
    // out of the queue too.
    leaveQueue(ticket);
    applyRequestsPending -= 1;
    replayDeferredOffer();
  }
}

/** The rest of a Restart request, once it has announced `downloading`. */
async function runApplyRequest(
  getWindow: GetWindow,
  options: { force?: boolean } | undefined,
  ctx: { asked: boolean; confirmed: boolean; offer: OtaStatus | null; restoreOffer: () => void; ticket: ApplyRequestTicket },
): Promise<boolean | { confirm: true; runningTasks: number | null }> {
  const { asked, confirmed, offer, restoreOffer, ticket } = ctx;
  // A manual apply re-checks the server so it can't drift from the UI,
  // unless a check fresh enough preceded this call (the one the dialog
  // interrupted). A pending stream repair is excluded: it applies at boot,
  // and a user restarting for a UI update must not trigger a server
  // downgrade.
  const reusable = lastServerCheck && Date.now() - lastServerCheck.at <= APPLY_SERVER_CHECK_REUSE_MS
    ? lastServerCheck.result
    : null;
  let server: ServerUpdateCheckResult;
  try {
    server = options?.force && reusable ? reusable : await checkServer();
  } catch (error) {
    restoreOffer();
    throw error;
  }
  const applyServer = serverUpdatePending(server);
  // The re-check can find a server update the last poll did not know about.
  // That restart was never offered as one, so it still has to ask. The offer
  // goes back first, so the dialog never opens over "Updating…".
  if (applyServer && asked && !confirmed && isServerRunning()) {
    const runningTasks = await countRunningTasks();
    if (runningTasks === null || runningTasks > 0) {
      restoreOffer();
      return { confirm: true, runningTasks };
    }
  }
  let applied = false;
  try {
    applied = await applyUpdates(getWindow, applyServer, true, 'manual', ticket);
  } catch (error) {
    // The apply itself threw. The banner must not go silent until the next
    // poll: name the failure, with the version, so it reads "Update failed"
    // and offers Try again.
    console.error('[updater] manual apply failed:', error);
    sendStatus(getWindow, { phase: 'error', version: offer?.version ?? updateCoordinator.getState().version });
    return false;
  }
  // Nothing landed and no reload followed. Put the offer back as it was, so
  // the banner reads "Update ready" again rather than going silent until the
  // next poll; Settings says the attempt failed beside it.
  if (!applied) restoreOffer();
  return applied;
}

/** The one apply: whatever is pending, resolved by the minimal
 *  sufficient step. A ready shell download installs and relaunches, which
 *  also applies any pending OTA at the next boot; otherwise the OTA applies
 *  with a reload. Both routes inherit the running-tasks confirmation
 *  and answer with the same `{ confirm, runningTasks }` report. */
export async function handleUnifiedApply(
  getWindow: GetWindow,
  options?: { force?: boolean; action?: UpdateAction },
): Promise<RestartRequestResult> {
  // The renderer names the action it rendered. It runs only if the state it
  // lands on still offers it: the banner can lag main by a push, and a
  // Download or Retry click must never install and relaunch. A renderer
  // older than this names nothing and gets what is offered now.
  const step = resolveApplyAction(updateCoordinator.getState(), options?.action);
  if (step === 'stale') return 'stale';
  const force = options?.force ? { force: true } : {};
  switch (step) {
    case 'relaunch':
      return requestShellInstall(force);
    case 'reload':
      return handleApplyRequest(getWindow, force);
    case 'retry': {
      const snapshot = await checkShellAutoUpdate('retry');
      return snapshot.phase !== 'failed';
    }
    case 'download': {
      const snapshot = await downloadShellAutoUpdate();
      return snapshot.phase === 'downloading' || snapshot.phase === 'ready-to-install';
    }
    default:
      // `open-download-page` is the renderer's own action (it opens the
      // browser); nothing pending answers false.
      return false;
  }
}

// After the boot poll (server now current), re-verify a constrained OTA cache
// that booted bundled. If it's now compatible, swap it in through the
// health-checked reload (loadAndVerify + rollback-on-failure), so this
// post-verification load is protected the same way an apply-time reload is. If
// still incompatible/unverifiable it stays deferred (bundled) — never rolled
// back here; only a real renderer-load failure quarantines a bundle.
async function settleConstrainedCache(getWindow: GetWindow): Promise<void> {
  if (isServingOta()) return; // already serving an OTA bundle (unconstrained / verified)
  const from = servedUiVersion();
  const startedAt = Date.now();
  const outcome = await verifyServedUiCompat();
  if (outcome === 'verified' && isServingOta()) {
    console.log('[updater] constrained OTA cache verified against server — activating with health check');
    await activateUiAndJournal(getWindow, from, 'boot', startedAt);
  }
}

export interface ShellUpdateStatus {
  available: boolean;
  currentVersion?: string; // installed shell (Electron app) CalVer
  latestVersion?: string;  // newest published shell CalVer
  downloadUrl?: string | null; // platform/channel installer URL, null if none
}

// Detection only and prod-only: non-prod builds must never receive a prod
// installer URL. Missing manifests or malformed versions fail closed.
export async function checkForShellUpdate(): Promise<ShellUpdateStatus> {
  let kind: string | null = null;
  try { kind = buildKindStrict(); } catch { kind = null; }
  if (kind !== 'prod') return { available: false };

  const manifest = await fetchManifest();
  const latestVersion = manifest?.shellVersion;
  if (!latestVersion) return { available: false };

  const currentVersion = getAppDisplayVersion();
  if (!shellUpdateIsNewer(latestVersion, currentVersion)) return { available: false };

  return { available: true, currentVersion, latestVersion, downloadUrl: shellDownloadUrl(process.platform, kind, process.arch) };
}

/** What one boot or periodic poll needs. Production wires the real
 *  transports (initUpdater); tests inject the three checkers and read the
 *  coordinator state the poll leaves behind. */
export interface UpdatePollDeps {
  hasInternet(): Promise<boolean>;
  checkUi(): Promise<UpdateCheckResult>;
  checkServer(): Promise<ServerUpdateCheckResult>;
  checkShellManual(): Promise<ShellUpdateStatus>;
  getShellSnapshot(): Pick<ShellUpdateSnapshot, 'phase' | 'recoverable'>;
  isServerRunning(): boolean;
  getMode(): 'auto' | 'manual';
  /** Apply what the poll decided; `trigger` is the journal's boot/periodic label. */
  applyUpdates(applyServer: boolean, applyUi: boolean, trigger: UpdateJournalTrigger): Promise<boolean>;
  /** An OTA status push: into the coordinator and onto the legacy channel. */
  pushStatus(status: OtaStatus): void;
  /** The manual installer notice was found. */
  onShellManual(status: ShellUpdateStatus): void;
}

/** One poll: detect on every channel, then auto-apply (boot) or offer
 *  (periodic). The decision table is `decideUpdateApply`; this is the
 *  orchestration around it, kept free of module state so it can run under a
 *  scenario table. */
export async function runUpdatePoll(deps: UpdatePollDeps, autoApply: boolean): Promise<void> {
  // hasInternet() probes the OTA manifest host (GitHub Pages). The server
  // update lives on different hosts (git remote / PyPI) with its own
  // fail-safe checks, so a down manifest host must only skip the UI check —
  // never suppress a server update (which may be the fix a user needs).
  const manifestReachable = await deps.hasInternet();
  if (!manifestReachable) console.log('[updater] manifest host unreachable — checking server only');

  const uiSkipped: UpdateCheckResult = { updateAvailable: false, applied: false };
  const [ui, server] = await Promise.all([
    manifestReachable ? deps.checkUi() : Promise.resolve(uiSkipped),
    deps.checkServer(),
  ]);
  // The journal credits a failed or skipped UI apply to the version this
  // check offered; a manual apply re-reads the manifest and has no other
  // record of it.
  rememberUiOffer(ui);

  // Shell notices are independent of OTA and never auto-applied. Poll the
  // ENG-849 manifest only when it's the fallback path — auto-update disabled
  // or terminally failed. When ENG-850 auto-update is enabled and healthy it
  // owns the shell update and its own poll+banner cover it, so this would be
  // a second redundant boot+4h check on prod (ENG-1739).
  const autoSnap = deps.getShellSnapshot();
  if (manifestReachable && shellManualNoticeIsFallback(autoSnap.phase, autoSnap.recoverable)) {
    const shell = await deps.checkShellManual().catch(() => ({ available: false as const }));
    deps.onShellManual(shell);
    if (shell.available) {
      console.log(`[updater] shell update available: ${shell.currentVersion} → ${shell.latestVersion}`);
      deps.pushStatus({
        phase: 'shell-available',
        version: shell.latestVersion,
        currentVersion: shell.currentVersion,
        downloadUrl: shell.downloadUrl ?? undefined,
      });
    }
  }

  if (!ui.updateAvailable && !server.updateAvailable) {
    console.log('[updater] everything up to date');
    return;
  }

  if (ui.updateAvailable) console.log(`[updater] UI update available: ${ui.newVersion}`);
  if (server.updateAvailable) console.log(`[updater] server update (${server.component ?? 'cowork-server'}): ${server.currentVersion} → ${server.latestVersion}`);

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
    serverDown: !deps.isServerRunning(),
    isBootCheck: autoApply,
    mode: deps.getMode(),
    repairOnly: !!server.repair,
  });

  if (applyServer || applyUi) {
    if (applyServer && !deps.isServerRunning()) console.log('[updater] server is down — applying server update to recover');
    await deps.applyUpdates(applyServer, applyUi, autoApply ? 'boot' : 'periodic');
    return;
  }
  // The stream repair is boot-only: a downgrade pill mid-session reads as
  // the app being confused, so a pending repair is never surfaced here.
  const surfaceServer = server.updateAvailable && !server.repair;
  if (!ui.updateAvailable && !surfaceServer) {
    console.log('[updater] stream repair pending — applies at the next boot, not surfaced mid-session');
    return;
  }
  deps.pushStatus(availableStatus(ui, { updateAvailable: surfaceServer, latestVersion: server.latestVersion, component: server.component }));
}

// Start update polling: a boot check (may auto-apply in auto mode) plus a
// periodic re-check every 4h (banner only, never auto-applies). Gated by the
// caller to packaged, non-DEV builds.
export function initUpdater(
  getWindow: GetWindow,
  rendererReady: Promise<void>,
  getMode: () => 'auto' | 'manual',
  shellAutoUpdateEnabled = false,
  // Called once the boot poll settles; the renderer's loading gate awaits it so
  // it never routes into the app mid-update (ENG-749). Idempotent.
  onBootPollComplete: () => void = () => {},
) {
  windowRef = getWindow;
  configureShellAutoUpdate({
    enabled: shellAutoUpdateEnabled,
    getWindow,
    getMode,
  });
  // The shell updater's snapshot is one of the coordinator's inputs; the
  // renderer reads the result, not the snapshot, for its banner and overlay.
  onShellAutoUpdateSnapshot((snapshot) => updateCoordinator.feed({ shell: snapshot }));
  // The loading gate also waits on the shell boot check, so a stranded update
  // installs before the app is shown (ENG-2764). That install quits the app,
  // so it waits for the OTA boot apply below to settle first: a shell swap
  // landing on a half-written server reinstall is worse than a later install.
  let otaBootDone!: () => void;
  const otaBootSettled = new Promise<void>(resolve => { otaBootDone = resolve; });
  const shellBootSettled = startShellAutoUpdatePolling(rendererReady, otaBootSettled);

  const deps: UpdatePollDeps = {
    hasInternet,
    checkUi: checkForUIUpdate,
    checkServer,
    checkShellManual: checkForShellUpdate,
    getShellSnapshot: getShellAutoUpdateSnapshot,
    isServerRunning,
    getMode,
    applyUpdates: (applyServer, applyUi, trigger) => applyUpdates(getWindow, applyServer, applyUi, trigger),
    // The poll's offer waits out an apply in flight rather than flipping it.
    pushStatus: (status) => pushOffer(getWindow, status),
    onShellManual: rememberShellManual,
  };
  const poll = (autoApply: boolean) => runUpdatePoll(deps, autoApply);

  rendererReady.then(async () => {
    try {
      console.log(`[updater] boot check (mode: ${getMode()})...`);
      await poll(true).catch(err => console.error('[updater] boot check failed:', err));

      // The boot poll has now brought the server current (server-first). Re-verify
      // a constrained OTA cache that booted bundled (fail-closed) and, if it's now
      // compatible, swap it in through the health-checked reload so a corrupt or
      // hanging bundle still self-heals.
      await settleConstrainedCache(getWindow).catch(err => console.error('[updater] compat settle failed:', err));
    } finally {
      otaBootDone();
      await shellBootSettled.catch(err => console.error('[updater] shell boot check failed:', err));
      onBootPollComplete(); // release the loading gate, whatever the poll did
    }

    const timer = setInterval(() => {
      console.log(`[updater] periodic check (mode: ${getMode()})...`);
      poll(false).catch(err => console.error('[updater] periodic check failed:', err));
    }, UPDATE_POLL_MS);

    // Don't let the interval keep the process alive, and stop polling on quit.
    timer.unref?.();
    app.on('before-quit', () => clearInterval(timer));
  });
}
