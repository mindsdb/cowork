import { app, type BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IPC } from '../shared/ipc-channels';
import { resolveShellUpdateFeed } from '../shared/shell-update-feed';
import { compareUpdaterSemVer } from '../shared/version';
import { buildKindStrict } from './cowork-home';
import {
  createDefaultElectronUpdaterAdapter,
  createShellAutoUpdater,
  type ShellAutoUpdater,
} from './shell-auto-updater';
import type {
  ShellUpdateChannel,
  ShellUpdateMode,
  ShellUpdateSnapshot,
  ShellUpdateTrigger,
} from './shell-update-state';
import { withUpdateMaintenance } from './update-maintenance';
import { withServerMaintenance } from './server-process';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const EVIDENCE_FILE = 'shell-update-target.json';

interface DownloadedTargetEvidence {
  targetVersion: string;
  channel: ShellUpdateChannel;
  downloadedAt: string;
}

type GetWindow = () => BrowserWindow | null;

let controller: ShellAutoUpdater | null = null;
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
    ) return null;
    return parsed as DownloadedTargetEvidence;
  } catch {
    return null;
  }
}

function writeEvidence(snapshot: ShellUpdateSnapshot): void {
  if (snapshot.phase !== 'ready-to-install' || !snapshot.targetVersion) return;
  const evidence: DownloadedTargetEvidence = {
    targetVersion: snapshot.targetVersion,
    channel: snapshot.channel,
    downloadedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(evidencePath(), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn('[shell-updater] could not persist downloaded target:', error);
  }
}

function clearEvidence(): void {
  try { fs.unlinkSync(evidencePath()); } catch (error: any) {
    if (error?.code !== 'ENOENT') console.warn('[shell-updater] could not clear target evidence:', error);
  }
}

export function reconcileDownloadedTarget(
  currentVersion: string,
  evidence: DownloadedTargetEvidence | null,
): Pick<ShellUpdateSnapshot, 'phase' | 'targetVersion' | 'recoverable' | 'errorCode' | 'errorMessage'> {
  if (!evidence) return { phase: 'idle' };
  const comparison = compareUpdaterSemVer(currentVersion, evidence.targetVersion);
  if (comparison !== null && comparison >= 0) return { phase: 'complete' };
  return {
    phase: 'failed',
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
  if (evidence) clearEvidence();

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

export async function installShellAutoUpdate(): Promise<boolean> {
  if (!controller) return false;
  return withUpdateMaintenance(() => withServerMaintenance(async () => (
    controller?.quitAndInstall() ?? false
  )));
}

export function registerShellAutoUpdateHandlers(): void {
  const { ipcMain } = require('electron');
  ipcMain.handle(IPC.SHELL_UPDATE_GET, () => getShellAutoUpdateSnapshot());
  ipcMain.handle(IPC.SHELL_UPDATE_CHECK, () => checkShellAutoUpdate('manual'));
  ipcMain.handle(IPC.SHELL_UPDATE_DOWNLOAD, () => downloadShellAutoUpdate());
  ipcMain.handle(IPC.SHELL_UPDATE_INSTALL, () => installShellAutoUpdate());
}

export function startShellAutoUpdatePolling(rendererReady: Promise<void>): void {
  if (!controller) return;
  rendererReady.then(async () => {
    await checkShellAutoUpdate('boot').catch(error => {
      console.error('[shell-updater] boot check failed:', error);
    });
    const timer = setInterval(() => {
      void checkShellAutoUpdate('periodic').catch(error => {
        console.error('[shell-updater] periodic check failed:', error);
      });
    }, CHECK_INTERVAL_MS);
    timer.unref?.();
    app.once('before-quit', () => clearInterval(timer));
  });
}
