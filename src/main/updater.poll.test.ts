import { beforeEach, describe, expect, it, vi } from 'vitest';

// The boot/periodic poll under a scenario table: the three channel checkers are
// injected and the coordinator state the poll leaves behind is asserted. This
// is the "Sample scenarios: what the user sees" table in docs/update-behavior.md,
// as code.

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

import { runUpdatePoll, handleUnifiedApply, updateCoordinator, availableStatus, initUpdater, checkForUpdates, feedServerUpdateStatus, type UpdatePollDeps, type ShellUpdateStatus } from './updater';
import { createUpdateCoordinator, type ShellSnapshot } from '../shared/update-coordinator';
import type { UpdateCheckResult } from './ui-updater';
import type { ServerUpdateCheckResult } from './server-updater';

const shell = (phase: ShellSnapshot['phase'], over: Partial<ShellSnapshot> = {}): ShellSnapshot => ({
  phase, mode: 'auto', channel: 'prod', currentVersion: '2.260928.1', ...over,
});
const uiFound: UpdateCheckResult = { updateAvailable: true, applied: false, newVersion: '2.26.10.7.1' };
const uiNone: UpdateCheckResult = { updateAvailable: false, applied: false };
const serverFound: ServerUpdateCheckResult = { updateAvailable: true, currentVersion: '0.26.10.5.2', latestVersion: '0.26.10.7.1', component: 'cowork-server' };
const serverNone: ServerUpdateCheckResult = { updateAvailable: false };
const noShell: ShellUpdateStatus = { available: false };

/** A poll wired to a fresh coordinator, with the three checkers injected. */
function scenario(over: Partial<UpdatePollDeps> & { shell?: ShellSnapshot } = {}) {
  const coordinator = createUpdateCoordinator({ shell: over.shell ?? shell('idle') });
  const applied: Array<[boolean, boolean]> = [];
  const deps: UpdatePollDeps = {
    hasInternet: async () => true,
    checkUi: async () => uiNone,
    checkServer: async () => serverNone,
    checkShellManual: async () => noShell,
    getShellSnapshot: () => coordinator.getInput().shell ?? shell('idle'),
    isServerRunning: () => true,
    getMode: () => 'auto',
    applyUpdates: async (applyServer, applyUi) => { applied.push([applyServer, applyUi]); return true; },
    pushStatus: (status) => { coordinator.feed({ ota: status }); },
    onShellManual: (status) => { if (status.available) coordinator.feed({ shellManual: { version: status.latestVersion!, downloadUrl: status.downloadUrl ?? null } }); },
    ...over,
  };
  return { deps, coordinator, applied, state: () => coordinator.getState() };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  runtime.requestShellInstall.mockClear();
  runtime.checkShellAutoUpdate.mockClear();
  runtime.downloadShellAutoUpdate.mockClear();
});

describe('runUpdatePoll: what the user sees', () => {
  it('everything current: idle, nothing applied, nothing offered', async () => {
    const s = scenario();
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([]);
    expect(s.state()).toMatchObject({ overall: 'idle', action: null });
  });

  it('OTA only, at boot: applies at once and offers nothing', async () => {
    const s = scenario({ checkUi: async () => uiFound });
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([[false, true]]);
    expect(s.state().action).toBeNull();
  });

  it('OTA only, found mid-session: one reload offered, nothing applied', async () => {
    const s = scenario({ checkUi: async () => uiFound });
    await runUpdatePoll(s.deps, false);
    expect(s.applied).toEqual([]);
    expect(s.state()).toMatchObject({ overall: 'ready', action: 'reload', pending: { reload: true, relaunch: false }, version: '2.26.10.7.1' });
    expect(s.state().ui).toMatchObject({ status: 'ready', version: '2.26.10.7.1' });
    expect(s.state().server.status).toBe('idle');
  });

  it('server + UI, mid-session: one reload naming both layers', async () => {
    const s = scenario({ checkUi: async () => uiFound, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, false);
    expect(s.state().action).toBe('reload');
    expect(s.state().ui).toMatchObject({ status: 'ready', version: '2.26.10.7.1' });
    expect(s.state().server).toMatchObject({ status: 'ready', version: '0.26.10.7.1', component: 'cowork-server' });
  });

  it('server + UI, at boot: both apply server-first in one pass', async () => {
    const s = scenario({ checkUi: async () => uiFound, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([[true, true]]);
  });

  it('server only, server down, mid-session: applied as recovery, not offered', async () => {
    const s = scenario({ checkServer: async () => serverFound, isServerRunning: () => false });
    await runUpdatePoll(s.deps, false);
    expect(s.applied).toEqual([[true, false]]);
    expect(s.state().action).toBeNull();
  });

  it('a stream repair found mid-session is never surfaced', async () => {
    const s = scenario({ checkServer: async () => ({ ...serverFound, repair: true }) });
    await runUpdatePoll(s.deps, false);
    expect(s.applied).toEqual([]);
    expect(s.state().action).toBeNull();
  });

  it('all three pending: the shell relaunch owns the one action, the OTA stays marked pending behind it', async () => {
    const s = scenario({ shell: shell('ready-to-install', { targetVersion: '2.26.10.9.1' }), checkUi: async () => uiFound, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, false);
    expect(s.state()).toMatchObject({ action: 'relaunch', pending: { reload: true, relaunch: true }, version: '2.26.10.9.1' });
  });

  it('a stranded shell update being installed at boot: applying, and an OTA offer does not displace it', async () => {
    const s = scenario({ shell: shell('installing', { targetVersion: '2.26.10.9.1', installSource: 'boot' }), checkUi: async () => uiFound });
    await runUpdatePoll(s.deps, false);
    expect(s.state()).toMatchObject({ overall: 'applying', applying: 'installing', action: null, pending: { reload: true } });
  });

  it('shell only on the manual fallback (auto-update disabled): the installer notice, polled only then', async () => {
    const checkShellManual = vi.fn(async (): Promise<ShellUpdateStatus> => ({ available: true, currentVersion: '2.260928.1', latestVersion: '2.261007.1', downloadUrl: 'https://x/y.pkg' }));
    const disabled = scenario({ shell: shell('disabled', { disabledReason: 'rollout-disabled' }), checkShellManual });
    await runUpdatePoll(disabled.deps, false);
    expect(checkShellManual).toHaveBeenCalledTimes(1);
    expect(disabled.state()).toMatchObject({ action: 'open-download-page', shell: { manual: true, manualDownloadUrl: 'https://x/y.pkg' } });
    // With auto-update healthy the manual manifest is not polled at all (ENG-1739).
    const healthy = scenario({ shell: shell('idle'), checkShellManual });
    await runUpdatePoll(healthy.deps, false);
    expect(checkShellManual).toHaveBeenCalledTimes(1);
  });

  it('manifest host down: the server is still checked and offered', async () => {
    const s = scenario({ hasInternet: async () => false, checkUi: async () => { throw new Error('must not be called'); }, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, false);
    expect(s.state().server.status).toBe('ready');
    expect(s.state().ui.status).toBe('idle');
  });

  it('a UI held for server compat rides the server apply at boot', async () => {
    const s = scenario({ checkUi: async () => ({ updateAvailable: false, applied: false, skippedReason: 'server too old' }), checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, true);
    expect(s.applied).toEqual([[true, true]]);
  });
});

describe('the status an apply leaves behind', () => {
  // The coordinator lives in main, so the status that announced an apply
  // would otherwise outlive the page it was for and reach the fresh renderer.
  // A window whose navigation commits (`did-navigate`) and finishes on the
  // next tick, as Electron's does; `navigates: false` holds it so a test can
  // commit it by hand.
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

  beforeEach(() => {
    updateCoordinator.feed({ shell: shell('idle'), ota: null, server: null, shellManual: null });
  });

  it('a server-only manual apply settles the server and OTA layers once the reload commits', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      // What the server updater reports mid-reinstall, as app.ts feeds it.
      updateCoordinator.feed({ server: { phase: 'downloading', to: '0.26.10.7.1' } });
      updateCoordinator.feed({ server: { phase: 'restarting' } });
      return { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
    });
    const w = win();
    updateCoordinator.feed({ ota: availableStatus(uiNone, serverFound) });
    expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
    expect(w.loadFile).toHaveBeenCalledTimes(1);
    // The navigation commits on the next tick. The fresh renderer then pulls
    // an idle state: no stuck overlay, and a later server-only offer can be
    // marked ready again.
    await new Promise((r) => setTimeout(r, 0));
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, server: { status: 'idle' }, ui: { status: 'idle' } });
    updateCoordinator.feed({ ota: availableStatus(uiNone, serverFound) });
    expect(updateCoordinator.getState().action).toBe('reload');
  });

  it('the old page keeps its overlay until the reload commits, then the state settles', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockResolvedValue({ updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' });
    const w = win({ navigates: false });
    updateCoordinator.feed({ ota: availableStatus(uiNone, serverFound) });
    expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
    expect(w.loadFile).toHaveBeenCalledTimes(1);
    // The apply has returned but the navigation has not committed: the page
    // still on screen must not be told the apply is over.
    expect(updateCoordinator.getState().applying).toBe('reloading');
    w.emit('did-navigate');
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, ui: { status: 'idle' } });
  });

  it('a server reinstall reports as reloading through the coordinator while the apply runs', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    const seen: Array<string | null> = [];
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      // The server updater's progress, as app.ts feeds it.
      feedServerUpdateStatus({ phase: 'downloading', to: '0.26.10.7.1' });
      seen.push(updateCoordinator.getState().applying);
      feedServerUpdateStatus({ phase: 'restarting' });
      seen.push(updateCoordinator.getState().applying);
      return { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
    });
    updateCoordinator.feed({ ota: availableStatus(uiNone, serverFound) });
    expect(await handleUnifiedApply(() => win() as never, { force: true })).toBe(true);
    expect(seen).toEqual(['downloading', 'reloading']);
    await new Promise((r) => setTimeout(r, 5));
    expect(updateCoordinator.getState().applying).toBeNull();
    // Outside an apply there is nothing to settle it, so the mirror stays off
    // the coordinator.
    feedServerUpdateStatus({ phase: 'restarting' });
    expect(updateCoordinator.getState().applying).toBeNull();
    updateCoordinator.feed({ server: null });
  });

  it('a manual check raises the installer notice only when the auto-updater is the fallback', async () => {
    const { checkForUIUpdate, fetchManifest } = await import('./ui-updater');
    const { checkForServerUpdate } = await import('./server-updater');
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiNone);
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    vi.mocked(fetchManifest).mockResolvedValue({ shellVersion: '2.26.12.1.1' } as never);
    // Healthy auto-updater whose feed lags the manifest: its update to make.
    runtime.checkShellAutoUpdate.mockResolvedValue({ phase: 'idle' } as never);
    await checkForUpdates();
    expect(updateCoordinator.getInput().shellManual).toBeNull();
    expect(updateCoordinator.getState().action).toBeNull();
    // Auto-update disabled: the installer notice is the only path.
    runtime.checkShellAutoUpdate.mockResolvedValue({ phase: 'disabled' } as never);
    await checkForUpdates();
    expect(updateCoordinator.getInput().shellManual).toMatchObject({ version: '2.26.12.1.1' });
    expect(updateCoordinator.getState().action).toBe('open-download-page');
    runtime.checkShellAutoUpdate.mockResolvedValue({ phase: 'idle' } as never);
    vi.mocked(fetchManifest).mockResolvedValue(null);
    updateCoordinator.feed({ shellManual: null });
  });

  it('a Restart named as the reload runs it, even while the manual installer notice owns the ladder', async () => {
    const { checkForServerUpdate } = await import('./server-updater');
    const { applyUIUpdate } = await import('./ui-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    vi.mocked(applyUIUpdate).mockResolvedValue(true);
    try {
      updateCoordinator.feed({ shell: shell('disabled'), ota: availableStatus(uiFound, serverNone), shellManual: { version: '2.26.12.1.1', downloadUrl: null } });
      expect(updateCoordinator.getState()).toMatchObject({ action: 'open-download-page', pending: { reload: true } });
      // Unnamed: the notice's action is the renderer's own, so nothing applies.
      const w1 = win();
      expect(await handleUnifiedApply(() => w1 as never, { force: true })).toBe(false);
      expect(w1.loadFile).not.toHaveBeenCalled();
      // Named: the person dismissed the notice and clicked the reload's Restart.
      const w2 = win();
      expect(await handleUnifiedApply(() => w2 as never, { force: true, action: 'reload' })).toBe(true);
      expect(w2.loadFile).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 5));
      // Naming a reload that is not pending changes nothing, and says so.
      updateCoordinator.feed({ ota: null });
      const w3 = win();
      expect(await handleUnifiedApply(() => w3 as never, { force: true, action: 'reload' })).toBe('stale');
      expect(w3.loadFile).not.toHaveBeenCalled();
    } finally {
      vi.mocked(applyUIUpdate).mockResolvedValue(false);
      updateCoordinator.feed({ shell: shell('idle'), shellManual: null, ota: null });
    }
  });

  it('a rolled-back bundle keeps its failure after the fallback load commits', async () => {
    const { checkForServerUpdate } = await import('./server-updater');
    const { applyUIUpdate } = await import('./ui-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    vi.mocked(applyUIUpdate).mockResolvedValueOnce(true);
    // The new bundle fails its load check; the fallback load then commits.
    const w = win({ navigates: false });
    let loads = 0;
    w.loadFile.mockImplementation(() => {
      loads += 1;
      if (loads === 1) setTimeout(() => w.emit('did-fail-load', null, -2, 'ERR_FAILED', 'file:///x', true), 0);
      else setTimeout(() => { w.emit('did-navigate'); w.emit('did-finish-load'); }, 0);
    });
    updateCoordinator.feed({ ota: availableStatus(uiFound, serverNone) });
    await handleUnifiedApply(() => w as never, { force: true });
    await new Promise((r) => setTimeout(r, 5));
    expect(w.loadFile).toHaveBeenCalledTimes(2);
    // The fresh renderer reads the rollback, not idle: nothing to retry, but
    // Settings can say what happened.
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, ui: { status: 'failed', error: 'rolled-back' } });
    updateCoordinator.feed({ ota: null });
  });

  it('an offer a check finds mid-apply waits, and comes back once the apply settles', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    const { checkForUIUpdate } = await import('./ui-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      await gate;
      return { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
    });
    const w = win();
    // The last check is what a forced apply reuses: make it the one that
    // offered the server update.
    const { checkForUIUpdate: checkUi } = await import('./ui-updater');
    vi.mocked(checkUi).mockResolvedValue(uiNone);
    await checkForUpdates();
    expect(updateCoordinator.getState().action).toBe('reload');
    const applying = handleUnifiedApply(() => w as never, { force: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(updateCoordinator.getState().applying).toBe('downloading');
    // A manual check lands while the server reinstalls and finds a UI update.
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    expect(updateCoordinator.getState().applying).toBe('downloading');
    expect(updateCoordinator.getState().action).toBeNull();
    release();
    expect(await applying).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    // The reload committed and the apply settled; the UI offer it did not
    // apply is back in front of the person.
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.7.1' } });
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiNone);
    vi.mocked(maybeUpdateServer).mockReset();
    updateCoordinator.feed({ ota: null, server: null });
  });

  it('an offer found while a UI reload commits is kept for the apply\'s final settle', async () => {
    const { checkForServerUpdate } = await import('./server-updater');
    const { applyUIUpdate, checkForUIUpdate, getCachedVersion } = await import('./ui-updater');
    // Version A is being applied; a check finds version B mid-reload.
    const uiA = uiFound;
    const uiB: UpdateCheckResult = { updateAvailable: true, applied: false, newVersion: '2.26.10.8.1' };
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    vi.mocked(applyUIUpdate).mockResolvedValueOnce(true);
    const w = win({ navigates: false });
    try {
      // The last check offered A with the server current; the forced apply
      // reuses it, so the server is left alone and A reloads.
      vi.mocked(checkForUIUpdate).mockResolvedValue(uiA);
      await checkForUpdates();
      const applying = handleUnifiedApply(() => w as never, { force: true });
      await vi.waitFor(() => expect(w.loadFile).toHaveBeenCalledTimes(1));
      expect(updateCoordinator.getState().applying).toBe('reloading');
      vi.mocked(checkForUIUpdate).mockResolvedValue(uiB);
      await checkForUpdates();
      // The reload commits while the apply still waits for the page to
      // finish loading: the apply has not let go of the status yet.
      vi.mocked(getCachedVersion).mockReturnValue(uiA.newVersion!);
      w.emit('did-navigate');
      w.emit('did-finish-load');
      expect(await applying).toBe(true);
      // A landed, B did not: B is in front of the person, not lost.
      expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
    } finally {
      vi.mocked(getCachedVersion).mockReturnValue(null);
      vi.mocked(checkForUIUpdate).mockResolvedValue(uiNone);
      updateCoordinator.feed({ ota: null, server: null });
    }
  });

  it('a check landing during the Restart\'s server re-check holds its offer, and the offer returns with the dialog', async () => {
    const { checkForServerUpdate } = await import('./server-updater');
    const { checkForUIUpdate } = await import('./ui-updater');
    const { countRunningTasks } = await import('./running-tasks');
    const uiB: UpdateCheckResult = { updateAvailable: true, applied: false, newVersion: '2.26.10.8.1' };
    // The last check offered UI A with the server current, so the click does
    // not ask up front and goes straight to its re-check.
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiFound);
    await checkForUpdates();
    expect(updateCoordinator.getState()).toMatchObject({ action: 'reload', ui: { version: '2.26.10.7.1' } });
    // The re-check hangs until released, then finds a server update the
    // last check did not know about, with two tasks running.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(checkForServerUpdate).mockImplementationOnce(async () => { await gate; return serverFound; });
    vi.mocked(countRunningTasks).mockResolvedValueOnce(2);
    try {
      const request = handleUnifiedApply(() => null, {});
      await new Promise((r) => setTimeout(r, 0));
      expect(updateCoordinator.getState().applying).toBe('downloading');
      // A check lands meanwhile and finds UI B.
      vi.mocked(checkForUIUpdate).mockResolvedValue(uiB);
      await checkForUpdates();
      expect(updateCoordinator.getState().applying).toBe('downloading');
      release();
      expect(await request).toEqual({ confirm: true, runningTasks: 2 });
      // The dialog opens over the newest offer, not over "Updating…".
      expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
    } finally {
      release();
      vi.mocked(checkForUIUpdate).mockResolvedValue(uiNone);
      vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
      updateCoordinator.feed({ ota: null, server: null });
    }
  });

  it('a window closed before its reload commits does not throw when the health window elapses', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockResolvedValue({ updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' });
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
      const { checkForUIUpdate: checkUi } = await import('./ui-updater');
      vi.mocked(checkUi).mockResolvedValue(uiNone);
      await checkForUpdates();
      expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
      expect(updateCoordinator.getState().applying).toBe('reloading');
      destroyed = true;
      // The health window elapses with the window gone: the settle must run
      // without touching the dead webContents.
      expect(() => vi.advanceTimersByTime(15_001)).not.toThrow();
      expect(updateCoordinator.getState().applying).toBeNull();
    } finally {
      vi.useRealTimers();
      updateCoordinator.feed({ ota: null, server: null });
    }
  });

  it('a manual apply that lands nothing puts the offer back rather than calling it a failure', async () => {
    const { checkForServerUpdate } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    const offer = availableStatus(uiFound, serverNone);
    updateCoordinator.feed({ ota: offer });
    // Not forced: the apply re-checks the server and finds it current.
    expect(await handleUnifiedApply(() => null, {})).toBe(false);
    expect(updateCoordinator.getInput().ota).toEqual(offer);
    expect(updateCoordinator.getState()).toMatchObject({ action: 'reload', ui: { status: 'ready' } });
  });

  it('a check that no longer reports the manual notice clears it', async () => {
    const s = scenario({ shell: shell('disabled'), checkShellManual: async () => ({ available: true, latestVersion: '2.261007.1', downloadUrl: null }) });
    await runUpdatePoll(s.deps, false);
    expect(s.state().action).toBe('open-download-page');
    s.deps.checkShellManual = async () => noShell;
    s.deps.onShellManual = (status) => s.coordinator.feed({ shellManual: status.available ? { version: status.latestVersion! } : null });
    await runUpdatePoll(s.deps, false);
    expect(s.state().action).toBeNull();
  });
});

describe('the real boot path settles what it reported', () => {
  // initUpdater with its production deps, the boot poll it starts, and the
  // status that poll leaves for the first renderer to pull.
  const boot = (getWindow: () => unknown = () => null) => new Promise<void>((resolve) => {
    initUpdater(getWindow as never, Promise.resolve(), () => 'auto', false, resolve);
  });

  beforeEach(async () => {
    updateCoordinator.feed({ shell: shell('idle'), ota: null, server: null, shellManual: null });
    const { checkForUIUpdate, applyUIUpdate } = await import('./ui-updater');
    vi.mocked(checkForUIUpdate).mockResolvedValue(uiNone);
    vi.mocked(applyUIUpdate).mockResolvedValue(false);
  });

  it('a failed boot server install leaves no apply in flight', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      updateCoordinator.feed({ server: { phase: 'downloading', to: '0.26.10.7.1' } });
      return { updated: false, previousVersion: '0.26.10.5.2', error: 'uv tool install failed' };
    });
    await boot();
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, server: { status: 'idle' }, ui: { status: 'idle' } });
    // A later offer is actionable, not hidden behind a stale apply.
    updateCoordinator.feed({ ota: availableStatus(uiNone, serverFound) });
    expect(updateCoordinator.getState().action).toBe('reload');
  });

  it('a critical server failure keeps its error for Settings, but nothing stays in flight', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      updateCoordinator.feed({ server: { phase: 'error', critical: true, error: 'rollback failed' } });
      return { updated: false, error: 'rollback failed' };
    });
    await boot();
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, server: { status: 'failed', error: 'rollback failed' } });
  });

  it('a successful boot server install with no live window leaves no apply in flight', async () => {
    const { checkForServerUpdate, maybeUpdateServer } = await import('./server-updater');
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      updateCoordinator.feed({ server: { phase: 'restarting' } });
      return { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
    });
    await boot(() => null);
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, server: { status: 'idle' } });
  });
});

describe('availableStatus', () => {
  it('names each layer for the coordinator and keeps the legacy version for older renderers', () => {
    expect(availableStatus(uiFound, serverFound)).toEqual({
      phase: 'available', version: '2.26.10.7.1', uiUpdate: true, uiVersion: '2.26.10.7.1',
      serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server',
    });
    expect(availableStatus(uiNone, { ...serverFound, component: 'anton-agent' })).toMatchObject({ version: 'anton-agent 0.26.10.7.1', uiUpdate: false, uiVersion: undefined });
  });
});

describe('handleUnifiedApply: one apply, the minimal sufficient step', () => {
  const noWindow = () => null;
  beforeEach(() => {
    updateCoordinator.feed({ shell: shell('idle'), ota: null, server: null, shellManual: null });
  });

  it('a ready shell download installs and relaunches, with the running-tasks question passed through', async () => {
    updateCoordinator.feed({ shell: shell('ready-to-install', { targetVersion: '2.26.10.9.1' }), ota: { phase: 'available', version: 'ui' } });
    runtime.requestShellInstall.mockResolvedValueOnce({ confirm: true, runningTasks: 2 } as never);
    expect(await handleUnifiedApply(noWindow, {})).toEqual({ confirm: true, runningTasks: 2 });
    expect(runtime.requestShellInstall).toHaveBeenCalledWith({});
    expect(await handleUnifiedApply(noWindow, { force: true })).toBe(true);
    expect(runtime.requestShellInstall).toHaveBeenLastCalledWith({ force: true });
  });

  it('a failed recoverable shell update retries the check; a manual-mode offer downloads', async () => {
    updateCoordinator.feed({ shell: shell('failed', { targetVersion: 'v', recoverable: true }) });
    runtime.checkShellAutoUpdate.mockResolvedValueOnce({ phase: 'checking' } as never);
    expect(await handleUnifiedApply(noWindow)).toBe(true);
    expect(runtime.checkShellAutoUpdate).toHaveBeenCalledWith('retry');
    updateCoordinator.feed({ shell: shell('available', { mode: 'manual', targetVersion: 'v' }) });
    expect(await handleUnifiedApply(noWindow)).toBe(true);
    expect(runtime.downloadShellAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it('runs the clicked action only while it is still on offer: a Download click never installs', async () => {
    // The banner rendered Download (manual mode, shell available)...
    updateCoordinator.feed({ shell: shell('available', { mode: 'manual', targetVersion: '2.26.10.9.1' }) });
    expect(updateCoordinator.getState().action).toBe('download');
    // ...and the snapshot reached ready-to-install before the click landed.
    updateCoordinator.feed({ shell: shell('ready-to-install', { mode: 'manual', targetVersion: '2.26.10.9.1' }) });
    expect(updateCoordinator.getState().action).toBe('relaunch');
    expect(await handleUnifiedApply(noWindow, { action: 'download' })).toBe('stale');
    expect(await handleUnifiedApply(noWindow, { action: 'retry' })).toBe('stale');
    expect(runtime.requestShellInstall).not.toHaveBeenCalled();
    expect(runtime.downloadShellAutoUpdate).not.toHaveBeenCalled();
    expect(runtime.checkShellAutoUpdate).not.toHaveBeenCalled();
    // The Restart the banner now shows does install.
    expect(await handleUnifiedApply(noWindow, { action: 'relaunch' })).toBe(true);
    expect(runtime.requestShellInstall).toHaveBeenCalledTimes(1);
    // An unknown action from the renderer runs nothing.
    expect(await handleUnifiedApply(noWindow, { action: 'format-disk' as never })).toBe('stale');
    expect(runtime.requestShellInstall).toHaveBeenCalledTimes(1);
  });

  it('answers false when nothing is pending, and leaves the installer page to the renderer', async () => {
    expect(await handleUnifiedApply(noWindow)).toBe(false);
    updateCoordinator.feed({ shellManual: { version: 'v' } });
    expect(await handleUnifiedApply(noWindow)).toBe(false);
    expect(runtime.requestShellInstall).not.toHaveBeenCalled();
  });
});
