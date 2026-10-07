import { app, type BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IPC } from '../shared/ipc-channels';
import { sendEvent } from './analytics';
import { resolveShellUpdateFeed } from '../shared/shell-update-feed';
import { compareUpdaterSemVer } from '../shared/version';
import { buildKindStrict } from './cowork-home';
import {
  createDefaultElectronUpdaterAdapter,
  createShellAutoUpdater,
  type ShellAutoUpdater,
} from './shell-auto-updater';
import type {
  ShellInstallSource,
  ShellUpdateChannel,
  ShellUpdateMode,
  ShellUpdateSnapshot,
  ShellUpdateTrigger,
} from './shell-update-state';
import { decideBootShellInstall } from './update-logic';
import { withUpdateMaintenance } from './update-maintenance';
import { withServerMaintenance } from './server-process';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** While an update is downloaded and waiting for a restart, re-check more often:
 *  the pending artifact is what the user will actually install, so the fresher
 *  it is, the less chance of a restart landing on an already-superseded build. */
const PENDING_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const EVIDENCE_FILE = 'shell-update-target.json';
/** How long the boot gate waits on the shell check to tell a stranded update
 *  from a fresh download. Past this, the update is left to the banner. */
const BOOT_INSTALL_WINDOW_MS = 10_000;

interface DownloadedTargetEvidence {
  targetVersion: string;
  channel: ShellUpdateChannel;
  downloadedAt: string;
  /** Written before a boot auto-install, so a launch still on the old version
   *  knows that attempt failed and does not retry it (ENG-2764). */
  bootInstallAttemptedTarget?: string;
  /** Who asked for the most recent install of this target. Kept apart from
   *  the marker above: the marker stays after a failed boot install to stop a
   *  retry loop, while a later Restart click must still report as `user`. */
  installSource?: ShellInstallSource;
  /** The relaunch verdict for this target has been handed to a renderer once.
   *  Set when a failed install's evidence is rewritten at launch, so later
   *  launches on the old version do not report `relaunched` again. */
  relaunchReported?: boolean;
}

type GetWindow = () => BrowserWindow | null;

let controller: ShellAutoUpdater | null = null;
// Target of a boot auto-install that already failed. Kept until the target
// changes or installs, and carried into every evidence write for it.
let priorBootInstallTarget: string | null = null;
// The most recent install attempt the evidence records, boot or user. An
// attempted target is never stranded: that install already failed and fell
// back to the banner, where the user decides.
let attemptedInstall: { target: string; source: ShellInstallSource } | null = null;
// Target whose relaunch verdict was already reported; carried into evidence
// writes for it so a later launch on the old version stays quiet.
let reportedTarget: string | null = null;
// Target an earlier launch downloaded but this launch is not running, and not
// yet tried as a boot install. Only then is a boot install possible, so only
// then does the boot gate wait on the shell check.
let strandedTarget: string | null = null;
let currentSnapshot: ShellUpdateSnapshot = {
  phase: 'disabled',
  mode: 'auto',
  channel: 'preview',
  currentVersion: 'unknown',
  disabledReason: 'not-initialized',
};

function evidencePath(): string {
  return path.join(app.getPath('userData'), EVIDENCE_FILE);
}

function readEvidence(): DownloadedTargetEvidence | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(evidencePath(), 'utf8')) as Partial<DownloadedTargetEvidence>;
    if (
      typeof parsed.targetVersion !== 'string'
      || (parsed.channel !== 'prod' && parsed.channel !== 'stable')
      || typeof parsed.downloadedAt !== 'string'
      || (parsed.bootInstallAttemptedTarget !== undefined
        && typeof parsed.bootInstallAttemptedTarget !== 'string')
      || (parsed.installSource !== undefined
        && parsed.installSource !== 'user' && parsed.installSource !== 'boot')
      || (parsed.relaunchReported !== undefined && typeof parsed.relaunchReported !== 'boolean')
    ) return null;
    return parsed as DownloadedTargetEvidence;
  } catch {
    return null;
  }
}

let lastEvidenceVersion: string | null = null;

/** Write the evidence file, reporting whether it actually landed. */
function persistEvidence(evidence: DownloadedTargetEvidence): boolean {
  try {
    fs.writeFileSync(evidencePath(), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.warn('[shell-updater] could not persist downloaded target:', error);
    return false;
  }
}

/** Exported for tests; only `onSnapshot` calls it in production. */
export function writeEvidence(snapshot: ShellUpdateSnapshot): void {
  if (!snapshot.targetVersion) return;
  // An install is starting: record who asked, so the relaunch verdict can
  // credit the right path. The anti-loop marker is carried, not replaced.
  if (snapshot.phase === 'installing') {
    persistEvidence({
      targetVersion: snapshot.targetVersion,
      channel: snapshot.channel,
      downloadedAt: new Date().toISOString(),
      ...(priorBootInstallTarget === snapshot.targetVersion
        ? { bootInstallAttemptedTarget: priorBootInstallTarget }
        : {}),
      installSource: snapshot.installSource ?? 'user',
    });
    attemptedInstall = { target: snapshot.targetVersion, source: snapshot.installSource ?? 'user' };
    reportedTarget = null;
    return;
  }
  if (snapshot.phase !== 'ready-to-install') return;
  // Background refreshes republish the snapshot twice per poll with the same
  // pending target; only a changed target is worth rewriting to disk.
  if (snapshot.targetVersion === lastEvidenceVersion) return;
  const persisted = persistEvidence({
    targetVersion: snapshot.targetVersion,
    channel: snapshot.channel,
    downloadedAt: new Date().toISOString(),
    ...(priorBootInstallTarget === snapshot.targetVersion
      ? { bootInstallAttemptedTarget: priorBootInstallTarget }
      : {}),
    // A re-found download of a target that already failed an install keeps
    // that record, so the next launch does not treat it as stranded or
    // report its relaunch verdict twice.
    ...(attemptedInstall?.target === snapshot.targetVersion ? { installSource: attemptedInstall.source } : {}),
    ...(reportedTarget === snapshot.targetVersion ? { relaunchReported: true } : {}),
  });
  // Only a target actually on disk may be skipped next time.
  if (persisted) lastEvidenceVersion = snapshot.targetVersion;
}

/** Record a boot auto-install before attempting it. False if the record did
 *  not land, in which case the attempt must not be made. */
function markBootInstallAttempt(snapshot: ShellUpdateSnapshot): boolean {
  if (!snapshot.targetVersion) return false;
  if (!persistEvidence({
    targetVersion: snapshot.targetVersion,
    channel: snapshot.channel,
    downloadedAt: new Date().toISOString(),
    bootInstallAttemptedTarget: snapshot.targetVersion,
    installSource: 'boot',
  })) return false;
  priorBootInstallTarget = snapshot.targetVersion;
  lastEvidenceVersion = snapshot.targetVersion;
  return true;
}

function clearEvidence(): void {
  lastEvidenceVersion = null;
  try { fs.unlinkSync(evidencePath()); } catch (error: any) {
    if (error?.code !== 'ENOENT') console.warn('[shell-updater] could not clear target evidence:', error);
  }
}

export function reconcileDownloadedTarget(
  currentVersion: string,
  evidence: DownloadedTargetEvidence | null,
): Pick<ShellUpdateSnapshot, 'phase' | 'targetVersion' | 'recoverable' | 'errorCode' | 'errorMessage' | 'lastInstall'> {
  if (!evidence) return { phase: 'idle' };
  const comparison = compareUpdaterSemVer(currentVersion, evidence.targetVersion);
  const applied = comparison !== null && comparison >= 0;
  // The recorded source wins. The marker alone cannot tell a boot install
  // from a later Restart click, because it stays after a failed boot install
  // to stop a retry loop; without a recorded source it is the best guess.
  const source: ShellInstallSource = evidence.installSource
    ?? (evidence.bootInstallAttemptedTarget === evidence.targetVersion ? 'boot' : 'user');
  // One relaunch verdict per install attempt: a launch that already handed it
  // to a renderer rewrote the evidence with `relaunchReported`.
  const lastInstall = evidence.relaunchReported
    ? undefined
    : { applied, version: currentVersion, expected: evidence.targetVersion, source };
  if (applied) return { phase: 'complete', lastInstall };
  return {
    phase: 'failed',
    lastInstall,
    targetVersion: evidence.targetVersion,
    recoverable: true,
    errorCode: 'install-not-applied',
    errorMessage: `Relaunched on ${currentVersion}; expected ${evidence.targetVersion}`,
  };
}

function liveWindow(getWindow: GetWindow): BrowserWindow | null {
  const win = getWindow();
  return win && !win.isDestroyed() ? win : null;
}

export function configureShellAutoUpdate(options: {
  enabled: boolean;
  getWindow: GetWindow;
  getMode: () => ShellUpdateMode;
}): ShellUpdateSnapshot {
  let buildKind: string | null = null;
  try { buildKind = buildKindStrict(); } catch { buildKind = null; }
  const feed = resolveShellUpdateFeed(buildKind, process.platform);
  const mode = options.getMode();
  const currentVersion = app.getVersion();

  if (!options.enabled || !app.isPackaged || !feed) {
    currentSnapshot = {
      phase: 'disabled',
      mode,
      channel: buildKind === 'prod' || buildKind === 'stable' ? buildKind : 'preview',
      currentVersion,
      disabledReason: !options.enabled
        ? 'rollout-disabled'
        : !app.isPackaged
          ? 'not-packaged'
          : 'unsupported-channel-or-platform',
    };
    return currentSnapshot;
  }

  const evidence = readEvidence();
  // Stable and prod may share an Electron userData directory. Never reconcile
  // durable evidence from another feed as if it belonged to this channel.
  const channelEvidence = evidence?.channel === feed.channel ? evidence : null;
  const reconciled = reconcileDownloadedTarget(currentVersion, channelEvidence);
  priorBootInstallTarget = channelEvidence?.bootInstallAttemptedTarget ?? null;
  attemptedInstall = channelEvidence?.installSource
    ? { target: channelEvidence.targetVersion, source: channelEvidence.installSource }
    : null;
  reportedTarget = null;
  // A target that already failed an install, by a boot install or a Restart
  // click, is not stranded: it fell back to the banner and stays there.
  const attemptedTarget = priorBootInstallTarget ?? attemptedInstall?.target ?? null;
  strandedTarget = reconciled.phase === 'failed' && reconciled.targetVersion !== attemptedTarget
    ? reconciled.targetVersion ?? null
    : null;
  // Stranded evidence stays on disk until the boot check has answered, so a
  // crash in between does not lose the record (settleStrandedEvidence).
  if (evidence && !strandedTarget) clearEvidence();
  // A failed install must be remembered even through a launch that never
  // reaches ready-to-install (offline, say), so rewrite its record now. The
  // relaunch verdict goes to the renderer this launch, so mark it reported.
  if (channelEvidence && attemptedTarget && reconciled.phase === 'failed') {
    reportedTarget = channelEvidence.targetVersion;
    persistEvidence({ ...channelEvidence, relaunchReported: true });
  }

  currentSnapshot = {
    ...reconciled,
    mode,
    channel: feed.channel,
    currentVersion,
  };

  controller = createShellAutoUpdater({
    adapter: createDefaultElectronUpdaterAdapter(mode === 'auto'),
    initialSnapshot: currentSnapshot,
    onSnapshot(snapshot) {
      currentSnapshot = snapshot;
      writeEvidence(snapshot);
      liveWindow(options.getWindow)?.webContents.send(IPC.SHELL_UPDATE_STATUS, snapshot);
    },
    onFailure(report) {
      // Full detail, stack included, to the app log ONLY — never the UI (which
      // shows the classified message) and never the analytics endpoint (no PII).
      const target = report.targetVersion ? ` → ${report.targetVersion}` : '';
      console.error(
        `[shell-updater] ${report.phase} failed (${report.code}, trigger=${report.trigger ?? 'unknown'}, `
        + `recoverable=${report.recoverable}) on ${feed.channel} ${report.currentVersion}${target}:`,
        report.error,
      );
      // A benign check failure no longer raises a banner, so a persistently
      // broken feed would otherwise be invisible. Emit a structured, PII-free
      // signal (codes and versions only) so ops can spot it without a user
      // report. pending_update separates a real download/install failure from a
      // check that never found an update.
      sendEvent('ANTONAPP_SHELL_UPDATE_FAILED', {
        phase: report.phase,
        code: report.code,
        trigger: report.trigger ?? 'unknown',
        channel: report.channel,
        recoverable: String(report.recoverable),
        pending_update: String(Boolean(report.targetVersion)),
        current_version: report.currentVersion,
        target_version: report.targetVersion ?? 'none',
      });
    },
  });
  console.log(`[shell-updater] configured ${feed.channel} feed (${feed.url}, mode: ${mode})`);
  return currentSnapshot;
}

export function getShellAutoUpdateSnapshot(): ShellUpdateSnapshot {
  return controller?.getSnapshot() ?? currentSnapshot;
}

export async function checkShellAutoUpdate(trigger: ShellUpdateTrigger): Promise<ShellUpdateSnapshot> {
  await controller?.check(trigger);
  return getShellAutoUpdateSnapshot();
}

export async function downloadShellAutoUpdate(): Promise<ShellUpdateSnapshot> {
  await controller?.download();
  return getShellAutoUpdateSnapshot();
}

export async function installShellAutoUpdate(source: ShellInstallSource = 'user'): Promise<boolean> {
  if (!controller) return false;
  return withUpdateMaintenance(() => withServerMaintenance(async () => (
    controller?.quitAndInstall(source) ?? false
  )));
}

export function registerShellAutoUpdateHandlers(): void {
  const { ipcMain } = require('electron');
  ipcMain.handle(IPC.SHELL_UPDATE_GET, () => getShellAutoUpdateSnapshot());
  ipcMain.handle(IPC.SHELL_UPDATE_CHECK, () => checkShellAutoUpdate('manual'));
  ipcMain.handle(IPC.SHELL_UPDATE_DOWNLOAD, () => downloadShellAutoUpdate());
  ipcMain.handle(IPC.SHELL_UPDATE_INSTALL, () => installShellAutoUpdate());
}

/** Resolve true once `predicate` holds for the controller's snapshot, or
 *  false after `timeoutMs`. */
function waitForSnapshot(
  predicate: (snapshot: ShellUpdateSnapshot) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let unsubscribe: (() => void) | null = null;
    let done = false;
    const finish = (met: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(met);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    unsubscribe = controller?.subscribe(snapshot => {
      if (predicate(snapshot)) finish(true);
    }) ?? null;
    if (done) unsubscribe?.();
    if (!controller) finish(true);
  });
}

/** The boot check has answered whether a ready update was already on disk: a
 *  cached replay reaches ready-to-install with no bytes, a fresh download moves
 *  bytes first. */
function bootCheckAnswered(snapshot: ShellUpdateSnapshot): boolean {
  if (snapshot.phase === 'checking') return false;
  if (snapshot.phase === 'downloading') return Boolean(snapshot.bytesTransferred);
  return true;
}

/** Install an update a previous launch downloaded but never installed
 *  (ENG-2764). Returns whether the install was handed to the updater. */
async function installStrandedShellUpdate(): Promise<boolean> {
  const snapshot = getShellAutoUpdateSnapshot();
  if (!decideBootShellInstall({
    phase: snapshot.phase,
    mode: snapshot.mode,
    bytesTransferred: snapshot.bytesTransferred,
    targetVersion: snapshot.targetVersion,
    priorAttemptTarget: priorBootInstallTarget,
  })) return false;
  if (!markBootInstallAttempt(snapshot)) return false;

  console.log(`[shell-updater] installing ${snapshot.targetVersion}, downloaded by an earlier launch`);
  return installShellAutoUpdate('boot').catch(error => {
    console.error('[shell-updater] stranded install failed:', error);
    return false;
  });
}

/** The boot check has answered for a stranded target. A cached replay has
 *  just rewritten the evidence at ready-to-install, so it stays; any other
 *  answer (nothing found, a fresh download, a failure, or no answer in time)
 *  means the old record is stale and goes, so the next launch does not wait. */
function settleStrandedEvidence(): void {
  if (getShellAutoUpdateSnapshot().phase === 'ready-to-install') return;
  clearEvidence();
}

/** Starts shell update polling. The returned promise settles once the boot
 *  check is done with the loading gate: at once when no earlier launch left an
 *  uninstalled download, otherwise when no stranded update was found or one
 *  was installed and the app is quitting. `otaBootSettled` resolves when the
 *  OTA boot apply is over: the install quits the app, so it must not start
 *  while a server or UI apply is mid-flight. */
export function startShellAutoUpdatePolling(
  rendererReady: Promise<void>,
  otaBootSettled: Promise<void> = Promise.resolve(),
): Promise<void> {
  if (!controller) return Promise.resolve();
  return rendererReady.then(async () => {
    void checkShellAutoUpdate('boot').catch(error => {
      console.error('[shell-updater] boot check failed:', error);
    });
    schedulePeriodicChecks();
    // Nothing an earlier launch left behind, so no boot install to decide.
    if (!strandedTarget) return;
    const startedAt = Date.now();
    const answered = await waitForSnapshot(bootCheckAnswered, BOOT_INSTALL_WINDOW_MS);
    settleStrandedEvidence();
    if (!answered) return;
    // The whole hold the shell adds to the gate stays within one window: the
    // hand-off wait below gets whatever the check left of it.
    const handoffBudget = Math.max(0, BOOT_INSTALL_WINDOW_MS - (Date.now() - startedAt));
    await otaBootSettled;
    if (await installStrandedShellUpdate()) {
      // Hold the gate while the app quits; release it if the install stalls.
      await waitForSnapshot(snapshot => snapshot.phase !== 'installing', handoffBudget);
    }
  });
}

/** How long between scheduled checks for a given phase. Every 30 minutes while
 *  an install is pending, so the artifact stays fresh, and while a check,
 *  download or install is in flight, so the controller's stall guard (which only runs
 *  from `check()`) releases a stalled one within 30 minutes of its threshold
 *  rather than at the 4-hour tick. Every 4 hours otherwise. */
export function periodicCheckIntervalFor(phase: ShellUpdateSnapshot['phase']): number {
  return phase === 'ready-to-install' || phase === 'checking' || phase === 'downloading' || phase === 'installing'
    ? PENDING_REFRESH_INTERVAL_MS
    : CHECK_INTERVAL_MS;
}

function schedulePeriodicChecks(): void {
  let lastCheckAt = Date.now();
  // One timer at the shorter cadence, gated on when a check is actually due.
  const timer = setInterval(() => {
    const due = periodicCheckIntervalFor(getShellAutoUpdateSnapshot().phase);
    if (Date.now() - lastCheckAt < due) return;
    lastCheckAt = Date.now();
    void checkShellAutoUpdate('periodic').catch(error => {
      console.error('[shell-updater] periodic check failed:', error);
    });
  }, PENDING_REFRESH_INTERVAL_MS);
  timer.unref?.();
  app.once('before-quit', () => clearInterval(timer));
}
