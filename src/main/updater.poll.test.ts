import { beforeEach, describe, expect, it, vi } from 'vitest';

// The updater's wiring, with the transports mocked: what the poll reports and
// applies, how an apply's progress settles with the page it was for, the real
// boot path, the step a click runs, and the round-four offer findings through
// main's entry points. The decisions themselves (what a check or an apply does
// to the offer, when progress settles, which step a click runs) are pure and
// tested directly in src/shared/update-coordinator.test.ts, which also holds the
// "Sample scenarios" table from docs/update-behavior.md.

vi.mock('electron', () => ({
  app: { getVersion: () => '2.260928.1', isPackaged: true, on: vi.fn() },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
}));
vi.mock('./ui-updater', () => ({
  checkForUIUpdate: vi.fn(),
  applyUIUpdate: vi.fn(async () => false),
  getRendererPath: vi.fn(() => '/renderer'),
  hasInternet: vi.fn(async () => true),
  rollbackUI: vi.fn(async () => undefined),
  isServingOta: vi.fn(() => false),
  verifyServedUiCompat: vi.fn(async () => 'verified'),
  fetchManifest: vi.fn(async () => null),
  getCachedVersion: vi.fn(() => null),
  lastUiApplyAttempt: vi.fn(() => null),
}));
// The outcome journal (update-journal.ts) writes to disk; keep it out of the
// scenario table.
vi.mock('./update-journal', async (importActual) => ({
  ...await importActual<typeof import('./update-journal')>(),
  recordUpdatePhase: vi.fn(),
}));
vi.mock('./server-updater', () => ({ checkForServerUpdate: vi.fn(), maybeUpdateServer: vi.fn() }));
vi.mock('./server-process', () => ({ isServerRunning: () => true }));
vi.mock('./running-tasks', () => ({ countRunningTasks: vi.fn(async () => 0) }));
vi.mock('./cowork-home', () => ({ buildKindStrict: () => 'prod' }));
vi.mock('./server-source', () => ({ getAppDisplayVersion: () => '2.26.9.28.1' }));
vi.mock('./update-maintenance', () => ({ withUpdateMaintenance: (fn: () => unknown) => fn() }));
const runtime = vi.hoisted(() => ({
  requestShellInstall: vi.fn(async () => true),
  checkShellAutoUpdate: vi.fn(async () => ({ phase: 'idle' })),
  downloadShellAutoUpdate: vi.fn(async () => ({ phase: 'downloading' })),
}));
vi.mock('./shell-auto-update-runtime', () => ({
  checkShellAutoUpdate: runtime.checkShellAutoUpdate,
  downloadShellAutoUpdate: runtime.downloadShellAutoUpdate,
  requestShellInstall: runtime.requestShellInstall,
  configureShellAutoUpdate: vi.fn(),
  getShellAutoUpdateSnapshot: vi.fn(() => ({ phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.260928.1' })),
  onShellAutoUpdateSnapshot: vi.fn(),
  registerShellAutoUpdateHandlers: vi.fn(),
  startShellAutoUpdatePolling: vi.fn(() => Promise.resolve()),
}));

import { runUpdatePoll, handleUnifiedApply, updateCoordinator, initUpdater, checkForUpdates, feedServerUpdateStatus, type UpdatePollDeps, type ShellUpdateStatus } from './updater';
import { createUpdateCoordinator, offerAfterCheck, type OtaCheck, type ShellSnapshot } from '../shared/update-coordinator';
import { applyUIUpdate, checkForUIUpdate, fetchManifest, getCachedVersion, lastUiApplyAttempt } from './ui-updater';
import { checkForServerUpdate, maybeUpdateServer } from './server-updater';
import { getShellAutoUpdateSnapshot } from './shell-auto-update-runtime';
import type { UpdateCheckResult } from './ui-updater';
import type { ServerUpdateCheckResult } from './server-updater';

const shell = (phase: ShellSnapshot['phase'], over: Partial<ShellSnapshot> = {}): ShellSnapshot => ({
  phase, mode: 'auto', channel: 'prod', currentVersion: '2.260928.1', ...over,
});
const uiFound: UpdateCheckResult = { updateAvailable: true, applied: false, newVersion: '2.26.10.7.1' };
const uiNone: UpdateCheckResult = { updateAvailable: false, applied: false };
const uiNext: UpdateCheckResult = { updateAvailable: true, applied: false, newVersion: '2.26.10.8.1' };
const serverFound: ServerUpdateCheckResult = { updateAvailable: true, currentVersion: '0.26.10.5.2', latestVersion: '0.26.10.7.1', component: 'cowork-server' };
const serverNone: ServerUpdateCheckResult = { updateAvailable: false };
const noShell: ShellUpdateStatus = { available: false };

/** A poll wired to a fresh coordinator, with the three checkers injected. */
function scenario(over: Partial<UpdatePollDeps> & { shell?: ShellSnapshot } = {}) {
  const coordinator = createUpdateCoordinator({ shell: over.shell ?? shell('idle') });
  const applied: Array<[boolean, boolean]> = [];
  const reported: OtaCheck[] = [];
  const deps: UpdatePollDeps = {
    hasInternet: async () => true,
    checkUi: async () => uiNone,
    checkServer: async () => serverNone,
    checkShellManual: async () => noShell,
    getShellSnapshot: () => coordinator.getInput().shell ?? shell('idle'),
    isServerRunning: () => true,
    getMode: () => 'auto',
    applyUpdates: async (applyServer, applyUi) => { applied.push([applyServer, applyUi]); return true; },
    recordCheck: (check) => { reported.push(check); coordinator.feed({ otaOffer: offerAfterCheck(coordinator.getInput().otaOffer, check) }); },
    onShellManual: vi.fn(),
    ...over,
  };
  return { deps, coordinator, applied, reported, state: () => coordinator.getState() };
}

/** A window whose navigation commits (`did-navigate`) and finishes on the next
 *  tick, as Electron's does; `navigates: false` holds it so a test can commit
 *  it by hand. */
const win = ({ navigates = true }: { navigates?: boolean } = {}) => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const emit = (event: string, ...args: unknown[]) => { (listeners[event] ?? []).slice().forEach((cb) => cb(...args)); };
  return {
    isDestroyed: () => false,
    loadFile: vi.fn(() => {
      if (navigates) setTimeout(() => { emit('did-navigate'); emit('did-finish-load'); }, 0);
    }),
    emit,
    webContents: {
      send: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); }),
      removeListener: vi.fn((event: string, cb: (...args: unknown[]) => void) => { listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb); }),
    },
  };
};

const idleSnapshot = { phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.260928.1' };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  runtime.requestShellInstall.mockClear();
  runtime.checkShellAutoUpdate.mockClear();
  runtime.checkShellAutoUpdate.mockResolvedValue(idleSnapshot as never);
  runtime.downloadShellAutoUpdate.mockClear();
  vi.mocked(getShellAutoUpdateSnapshot).mockReturnValue(idleSnapshot as never);
  vi.mocked(checkForUIUpdate).mockResolvedValue(uiNone);
  vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
  vi.mocked(maybeUpdateServer).mockResolvedValue({ updated: false } as never);
  vi.mocked(applyUIUpdate).mockResolvedValue(false);
  vi.mocked(lastUiApplyAttempt).mockReturnValue(null);
  vi.mocked(getCachedVersion).mockReturnValue(null);
  vi.mocked(fetchManifest).mockResolvedValue(null);
  // Start every case from a clean slate: a check that finds nothing clears
  // the offer, and the rest is fed directly.
  await checkForUpdates();
  updateCoordinator.feed({ shell: shell('idle'), otaApply: null, server: null, shellManual: null });
  vi.clearAllMocks();
});

describe('runUpdatePoll: what it reports and applies', () => {
  it('everything current: both channels answered no, nothing applied', async () => {
    const s = scenario();
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([]);
    expect(s.reported).toEqual([{ ui: uiNone, server: { ...serverNone, updateAvailable: false } }]);
    expect(s.state().action).toBeNull();
  });

  it('at boot it applies, and reports only the layers it does not apply', async () => {
    const s = scenario({ checkUi: async () => uiFound, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([[true, true]]);
    expect(s.reported).toEqual([{}]);
    expect(s.state().action).toBeNull();
  });

  it('mid-session it offers instead, and a down server is applied as recovery', async () => {
    const offered = scenario({ checkUi: async () => uiFound, checkServer: async () => serverFound });
    await runUpdatePoll(offered.deps, false);
    expect(offered.applied).toEqual([]);
    expect(offered.state()).toMatchObject({ action: 'reload', ui: { status: 'ready' }, server: { status: 'ready' } });
    const down = scenario({ checkServer: async () => serverFound, isServerRunning: () => false });
    await runUpdatePoll(down.deps, false);
    expect(down.applied).toEqual([[true, false]]);
    expect(down.state().action).toBeNull();
  });

  it('manifest host down: the UI is not checked or reported, the server still is', async () => {
    const s = scenario({ hasInternet: async () => false, checkUi: async () => { throw new Error('must not be called'); }, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, false);
    expect(s.reported).toEqual([{ server: { ...serverFound, updateAvailable: true } }]);
    expect(s.state()).toMatchObject({ server: { status: 'ready' }, ui: { status: 'idle' } });
  });

  it('a UI held for server compat rides the server apply at boot', async () => {
    const s = scenario({ checkUi: async () => ({ updateAvailable: false, applied: false, skippedReason: 'server too old' }), checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([[true, true]]);
  });

  it('the installer manifest is polled only while it is the fallback, and a thrown check is no answer', async () => {
    const checkShellManual = vi.fn(async (): Promise<ShellUpdateStatus> => ({ available: true, currentVersion: '2.260928.1', latestVersion: '2.261007.1', downloadUrl: 'https://x/y.pkg' }));
    const disabled = scenario({ shell: shell('disabled', { disabledReason: 'rollout-disabled' }), checkShellManual });
    await runUpdatePoll(disabled.deps, false);
    expect(disabled.deps.onShellManual).toHaveBeenCalledWith(expect.objectContaining({ available: true, latestVersion: '2.261007.1' }));
    // With auto-update healthy the manual manifest is not polled at all (ENG-1739).
    const healthy = scenario({ shell: shell('idle'), checkShellManual });
    await runUpdatePoll(healthy.deps, false);
    expect(checkShellManual).toHaveBeenCalledTimes(1);
    const thrown = scenario({ shell: shell('disabled'), checkShellManual: async () => { throw new Error('offline'); } });
    await runUpdatePoll(thrown.deps, false);
    expect(thrown.deps.onShellManual).toHaveBeenCalledWith({ available: false, error: true });
  });
});

describe('an apply\'s progress settles with the page it was for', () => {
  it('a server-only manual apply settles the server and apply status once the reload commits', async () => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    await checkForUpdates();
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      // What the server updater reports mid-reinstall, as app.ts feeds it.
      updateCoordinator.feed({ server: { phase: 'downloading', to: '0.26.10.7.1' } });
      updateCoordinator.feed({ server: { phase: 'restarting' } });
      return { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
    });
    const w = win();
    expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
    expect(w.loadFile).toHaveBeenCalledTimes(1);
    // The fresh renderer pulls an idle state: no stuck overlay, and the
    // landed server update is no longer offered.
    await tick();
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, server: { status: 'idle' }, ui: { status: 'idle' } });
  });

  it('the old page keeps its overlay until the reload commits', async () => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockResolvedValue({ updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' });
    await checkForUpdates();
    const w = win({ navigates: false });
    expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
    // The apply has returned but the navigation has not committed: the page
    // still on screen must not be told the apply is over.
    expect(updateCoordinator.getState().applying).toBe('reloading');
    w.emit('did-navigate');
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, ui: { status: 'idle' } });
  });

  it('a server reinstall reports as reloading through the coordinator while the apply runs', async () => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    await checkForUpdates();
    const seen: Array<string | null> = [];
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      // The server updater's progress, as app.ts feeds it.
      feedServerUpdateStatus({ phase: 'downloading', to: '0.26.10.7.1' });
      seen.push(updateCoordinator.getState().applying);
      feedServerUpdateStatus({ phase: 'restarting' });
      seen.push(updateCoordinator.getState().applying);
      return { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
    });
    expect(await handleUnifiedApply(() => win() as never, { force: true })).toBe(true);
    expect(seen).toEqual(['downloading', 'reloading']);
    await tick(5);
    expect(updateCoordinator.getState().applying).toBeNull();
    // Outside an apply the mirror stays off the coordinator.
    feedServerUpdateStatus({ phase: 'restarting' });
    expect(updateCoordinator.getState().applying).toBeNull();
  });

  it('a rolled-back bundle keeps its failure after the fallback load commits, and offers nothing to repeat', async () => {
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    vi.mocked(applyUIUpdate).mockResolvedValueOnce(true);
    vi.mocked(getCachedVersion).mockReturnValue(uiFound.newVersion!);
    // The new bundle fails its load check; the fallback load then commits.
    const w = win({ navigates: false });
    let loads = 0;
    w.loadFile.mockImplementation(() => {
      loads += 1;
      if (loads === 1) setTimeout(() => w.emit('did-fail-load', null, -2, 'ERR_FAILED', 'file:///x', true), 0);
      else setTimeout(() => { w.emit('did-navigate'); w.emit('did-finish-load'); }, 0);
    });
    await handleUnifiedApply(() => w as never, { force: true });
    await tick(5);
    expect(w.loadFile).toHaveBeenCalledTimes(2);
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, ui: { status: 'failed', error: 'rolled-back' } });
  });

  it('a window closed before its reload commits does not throw when the health window elapses', async () => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockResolvedValue({ updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' });
    await checkForUpdates();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const w = win({ navigates: false });
      let destroyed = false;
      w.isDestroyed = () => destroyed;
      const contents = w.webContents as unknown as Record<string, unknown>;
      contents.isDestroyed = () => destroyed;
      const removeListener = w.webContents.removeListener;
      w.webContents.removeListener = vi.fn((...args: Parameters<typeof removeListener>) => {
        if (destroyed) throw new Error('Object has been destroyed');
        return removeListener(...args);
      });
      expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
      expect(updateCoordinator.getState().applying).toBe('reloading');
      destroyed = true;
      // The health window elapses with the window gone: the settle must run
      // without touching the dead webContents.
      expect(() => vi.advanceTimersByTime(15_001)).not.toThrow();
      expect(updateCoordinator.getState().applying).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the real boot path settles what it reported', () => {
  // initUpdater with its production deps, the boot poll it starts, and the
  // status that poll leaves for the first renderer to pull.
  const boot = (getWindow: () => unknown = () => null) => new Promise<void>((resolve) => {
    initUpdater(getWindow as never, Promise.resolve(), () => 'auto', false, resolve);
  });

  it('a failed boot server install leaves no apply in flight, and its offer for the retry', async () => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      updateCoordinator.feed({ server: { phase: 'downloading', to: '0.26.10.7.1' } });
      return { updated: false, previousVersion: '0.26.10.5.2', error: 'uv tool install failed' };
    });
    await boot();
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, ui: { status: 'idle' } });
    // A later offer is actionable, not hidden behind a stale apply.
    await checkForUpdates();
    expect(updateCoordinator.getState()).toMatchObject({ action: 'reload', server: { status: 'ready' } });
  });

  it('a critical server failure keeps its error for Settings, but nothing stays in flight', async () => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      updateCoordinator.feed({ server: { phase: 'error', critical: true, error: 'rollback failed' } });
      return { updated: false, error: 'rollback failed' };
    });
    await boot();
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, server: { status: 'failed', error: 'rollback failed' } });
  });
});

describe('handleUnifiedApply wires the step to the runtime', () => {
  const noWindow = () => null;

  it('a ready shell download installs and relaunches, with the running-tasks question passed through', async () => {
    updateCoordinator.feed({ shell: shell('ready-to-install', { targetVersion: '2.26.10.9.1' }) });
    runtime.requestShellInstall.mockResolvedValueOnce({ confirm: true, runningTasks: 2 } as never);
    expect(await handleUnifiedApply(noWindow, {})).toEqual({ confirm: true, runningTasks: 2 });
    expect(runtime.requestShellInstall).toHaveBeenCalledWith({});
    expect(await handleUnifiedApply(noWindow, { force: true })).toBe(true);
    expect(runtime.requestShellInstall).toHaveBeenLastCalledWith({ force: true });
  });

  it('a Download or Retry click that lands after the shell became ready never installs', async () => {
    updateCoordinator.feed({ shell: shell('ready-to-install', { mode: 'manual', targetVersion: '2.26.10.9.1' }) });
    expect(await handleUnifiedApply(noWindow, { action: 'download' })).toBe('stale');
    expect(await handleUnifiedApply(noWindow, { action: 'retry' })).toBe('stale');
    expect(runtime.requestShellInstall).not.toHaveBeenCalled();
    expect(runtime.downloadShellAutoUpdate).not.toHaveBeenCalled();
    expect(runtime.checkShellAutoUpdate).not.toHaveBeenCalled();
  });
});

describe('round four: the offer through main\'s entry points', () => {
  it('a manual check where one channel errors keeps the other channel\'s offer (finding 1)', async () => {
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    await checkForUpdates();
    // The server host flakes; the UI check still answers.
    vi.mocked(checkForServerUpdate).mockResolvedValue({ updateAvailable: false, error: 'timeout' } as never);
    await checkForUpdates();
    expect(updateCoordinator.getState().ui).toMatchObject({ status: 'ready', version: '2.26.10.7.1' });
    expect(updateCoordinator.getState().server).toMatchObject({ status: 'ready', version: '0.26.10.7.1' });
  });

  it('a manifest that cannot be reached keeps the installer notice, in a check and in the poll (finding 2)', async () => {
    const disabled = { ...idleSnapshot, phase: 'disabled' };
    runtime.checkShellAutoUpdate.mockResolvedValue(disabled as never);
    vi.mocked(getShellAutoUpdateSnapshot).mockReturnValue(disabled as never);
    vi.mocked(fetchManifest).mockResolvedValue({ shellVersion: '2.26.12.1.1' } as never);
    await checkForUpdates();
    expect(updateCoordinator.getState().action).toBe('open-download-page');
    // A network blip: fetchManifest swallows it to null.
    vi.mocked(fetchManifest).mockResolvedValue(null);
    await checkForUpdates();
    const kept = { action: 'open-download-page', shell: { manual: true, version: '2.26.12.1.1' } };
    expect(updateCoordinator.getState()).toMatchObject(kept);
    await new Promise<void>((resolve) => { initUpdater((() => null) as never, Promise.resolve(), () => 'auto', false, resolve); });
    expect(updateCoordinator.getState()).toMatchObject(kept);
    // A manifest that answers with no newer shell does clear it.
    vi.mocked(fetchManifest).mockResolvedValue({ shellVersion: '2.26.1.1.1' } as never);
    await checkForUpdates();
    expect(updateCoordinator.getState().action).toBeNull();
  });

  it('an offer for UI X and server Y keeps Y offered when the apply running lands X (finding 3)', async () => {
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    let land!: (applied: boolean) => void;
    vi.mocked(applyUIUpdate).mockImplementationOnce(() => new Promise<boolean>((r) => { land = r; }));
    const applying = handleUnifiedApply(() => win() as never, { force: true });
    await vi.waitFor(() => expect(applyUIUpdate).toHaveBeenCalledTimes(1));
    // A check lands mid-apply and finds UI X and server Y. The progress stays.
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    await checkForUpdates();
    expect(updateCoordinator.getState()).toMatchObject({ applying: 'downloading', action: null });
    vi.mocked(getCachedVersion).mockReturnValue(uiFound.newVersion!);
    land(true);
    expect(await applying).toBe(true);
    await tick(5);
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', server: { status: 'ready', version: '0.26.10.7.1' }, ui: { status: 'idle' } });
  });

  it('an offer for a newer UI found while one reloads survives the reload', async () => {
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    vi.mocked(applyUIUpdate).mockResolvedValueOnce(true);
    const w = win({ navigates: false });
    const applying = handleUnifiedApply(() => w as never, { force: true });
    await vi.waitFor(() => expect(w.loadFile).toHaveBeenCalledTimes(1));
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiNext);
    await checkForUpdates();
    vi.mocked(getCachedVersion).mockReturnValue(uiFound.newVersion!);
    w.emit('did-navigate');
    w.emit('did-finish-load');
    expect(await applying).toBe(true);
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
  });

  it('a Restart whose apply finds nothing clears the stale offer instead of looping (finding 4)', async () => {
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    expect(updateCoordinator.getState().action).toBe('reload');
    // The release was withdrawn before the click: the apply downloads nothing.
    expect(await handleUnifiedApply(() => null, { force: true })).toBe(false);
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, ui: { status: 'idle' } });
  });

  it('a Restart whose download fails keeps the offer and says so, for a real retry', async () => {
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    vi.mocked(lastUiApplyAttempt).mockReturnValueOnce(uiFound.newVersion!);
    expect(await handleUnifiedApply(() => null, { force: true })).toBe(false);
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: '2.26.10.7.1' } });
  });

  it('a check that lands during the Restart\'s server re-check leaves its progress alone, and its offer shows with the dialog', async () => {
    const { countRunningTasks } = await import('./running-tasks');
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    // The re-check hangs until released, then finds a server update the last
    // check did not know about, with two tasks running.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(checkForServerUpdate).mockImplementationOnce(async () => { await gate; return serverFound; });
    vi.mocked(countRunningTasks).mockResolvedValueOnce(2);
    const request = handleUnifiedApply(() => null, {});
    await tick();
    expect(updateCoordinator.getState().applying).toBe('downloading');
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiNext);
    await checkForUpdates();
    expect(updateCoordinator.getState().applying).toBe('downloading');
    release();
    expect(await request).toEqual({ confirm: true, runningTasks: 2 });
    // The dialog opens over the newest offer, not over "Updating…".
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' }, server: { status: 'ready' } });
  });
});
