import { beforeEach, describe, expect, it, vi } from 'vitest';

// The updater's wiring with the transports mocked. The decisions are pure and
// tested in src/shared/update-coordinator.test.ts.

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
import { countRunningTasks } from './running-tasks';
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
const serverLanded = { updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' };
const idleSnapshot = { phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.260928.1' };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const state = () => updateCoordinator.getState();

/** A poll wired to a fresh coordinator, with the checkers injected. */
function scenario(over: Partial<UpdatePollDeps> & { shell?: ShellSnapshot } = {}) {
  const coordinator = createUpdateCoordinator({ shell: over.shell ?? shell('idle') });
  const applied: Array<[boolean, boolean]> = [];
  const reported: OtaCheck[] = [];
  const deps: UpdatePollDeps = {
    hasInternet: async () => true,
    checkUi: async () => uiNone,
    checkServer: async () => serverNone,
    checkShellManual: async () => ({ available: false }),
    getShellSnapshot: () => coordinator.getInput().shell ?? shell('idle'),
    isServerRunning: () => true,
    getMode: () => 'auto',
    applyUpdates: async (applyServer, applyUi) => { applied.push([applyServer, applyUi]); return true; },
    recordCheck: (check) => { reported.push(check); coordinator.feed({ otaOffer: offerAfterCheck(coordinator.getInput().otaOffer, check) }); },
    onShellManual: vi.fn(),
    ...over,
  };
  return { deps, applied, reported, state: () => coordinator.getState() };
}

/** A window whose navigation commits on the next tick, as Electron's does;
 *  `navigates: false` holds it so a test can commit it by hand. */
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

/** Offer what the mocked checkers find, through a manual check. */
async function offerFound(ui: UpdateCheckResult, server: ServerUpdateCheckResult = serverNone) {
  vi.mocked(checkForUIUpdate).mockResolvedValue(ui);
  vi.mocked(checkForServerUpdate).mockResolvedValue(server);
  await checkForUpdates();
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  runtime.checkShellAutoUpdate.mockResolvedValue(idleSnapshot as never);
  vi.mocked(getShellAutoUpdateSnapshot).mockReturnValue(idleSnapshot as never);
  vi.mocked(maybeUpdateServer).mockResolvedValue({ updated: false } as never);
  vi.mocked(applyUIUpdate).mockResolvedValue(false);
  vi.mocked(lastUiApplyAttempt).mockReturnValue(null);
  vi.mocked(getCachedVersion).mockReturnValue(null);
  vi.mocked(fetchManifest).mockResolvedValue(null);
  // A check that finds nothing clears the offer; the rest is fed directly.
  await offerFound(uiNone);
  updateCoordinator.feed({ shell: shell('idle'), otaApply: null, server: null, shellManual: null });
  vi.clearAllMocks();
});

describe('runUpdatePoll', () => {
  it.each<[string, Partial<UpdatePollDeps>, boolean, Array<[boolean, boolean]>, string | null]>([
    ['everything current', {}, true, [], null],
    ['boot applies both and offers nothing', { checkUi: async () => uiFound, checkServer: async () => serverFound }, true, [[true, true]], null],
    ['mid-session offers instead', { checkUi: async () => uiFound, checkServer: async () => serverFound }, false, [], 'reload'],
    ['a down server is applied as recovery', { checkServer: async () => serverFound, isServerRunning: () => false }, false, [[true, false]], null],
    ['a UI held for server compat rides the server apply', { checkUi: async () => ({ updateAvailable: false, applied: false, skippedReason: 'server too old' }), checkServer: async () => serverFound }, true, [[true, true]], null],
  ])('%s', async (_name, over, autoApply, applied, action) => {
    const s = scenario(over);
    await runUpdatePoll(s.deps, autoApply);
    expect(s.applied).toEqual(applied);
    expect(s.state().action).toBe(action);
  });

  it('with the manifest host down, the UI is not checked or reported', async () => {
    const s = scenario({ hasInternet: async () => false, checkUi: async () => { throw new Error('must not be called'); }, checkServer: async () => serverFound });
    await runUpdatePoll(s.deps, false);
    expect(s.reported).toEqual([{ server: { ...serverFound, updateAvailable: true } }]);
    expect(s.state()).toMatchObject({ server: { status: 'ready' }, ui: { status: 'idle' } });
  });

  it('polls the installer manifest only as the fallback, and treats a thrown check as no answer', async () => {
    const checkShellManual = vi.fn(async (): Promise<ShellUpdateStatus> => ({ available: true, currentVersion: '2.260928.1', latestVersion: '2.261007.1', downloadUrl: 'https://x/y.pkg' }));
    const disabled = scenario({ shell: shell('disabled', { disabledReason: 'rollout-disabled' }), checkShellManual });
    await runUpdatePoll(disabled.deps, false);
    expect(disabled.deps.onShellManual).toHaveBeenCalledWith(expect.objectContaining({ available: true, latestVersion: '2.261007.1' }));
    await runUpdatePoll(scenario({ shell: shell('idle'), checkShellManual }).deps, false);
    expect(checkShellManual).toHaveBeenCalledTimes(1);
    const thrown = scenario({ shell: shell('disabled'), checkShellManual: async () => { throw new Error('offline'); } });
    await runUpdatePoll(thrown.deps, false);
    expect(thrown.deps.onShellManual).toHaveBeenCalledWith({ available: false, error: true });
  });
});

describe('an apply\'s progress settles with the page it was for', () => {
  it('a server apply holds the overlay until the reload commits, then settles both layers', async () => {
    await offerFound(uiNone, serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      updateCoordinator.feed({ server: { phase: 'restarting' } });
      return serverLanded;
    });
    const w = win({ navigates: false });
    expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
    expect(state().applying).toBe('reloading');
    w.emit('did-navigate');
    expect(state()).toMatchObject({ applying: null, action: null, server: { status: 'idle' }, ui: { status: 'idle' } });
  });

  it('a server reinstall reports as reloading through the coordinator only while the apply runs', async () => {
    await offerFound(uiNone, serverFound);
    const seen: Array<string | null> = [];
    vi.mocked(maybeUpdateServer).mockImplementation(async () => {
      feedServerUpdateStatus({ phase: 'downloading', to: '0.26.10.7.1' });
      seen.push(state().applying);
      feedServerUpdateStatus({ phase: 'restarting' });
      seen.push(state().applying);
      return serverLanded;
    });
    expect(await handleUnifiedApply(() => win() as never, { force: true })).toBe(true);
    expect(seen).toEqual(['downloading', 'reloading']);
    await tick(5);
    feedServerUpdateStatus({ phase: 'restarting' });
    expect(state().applying).toBeNull();
  });

  it('a rolled-back bundle keeps its failure after the fallback load commits', async () => {
    await offerFound(uiFound);
    vi.mocked(applyUIUpdate).mockResolvedValueOnce(true);
    vi.mocked(getCachedVersion).mockReturnValue(uiFound.newVersion!);
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
    expect(state()).toMatchObject({ applying: null, action: null, ui: { status: 'failed', error: 'rolled-back' } });
  });

  it('a window closed before its reload commits does not throw when the health window elapses', async () => {
    await offerFound(uiNone, serverFound);
    vi.mocked(maybeUpdateServer).mockResolvedValue(serverLanded);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const w = win({ navigates: false });
      let destroyed = false;
      w.isDestroyed = () => destroyed;
      (w.webContents as unknown as Record<string, unknown>).isDestroyed = () => destroyed;
      const removeListener = w.webContents.removeListener;
      w.webContents.removeListener = vi.fn((...args: Parameters<typeof removeListener>) => {
        if (destroyed) throw new Error('Object has been destroyed');
        return removeListener(...args);
      });
      expect(await handleUnifiedApply(() => w as never, { force: true })).toBe(true);
      destroyed = true;
      expect(() => vi.advanceTimersByTime(15_001)).not.toThrow();
      expect(state().applying).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<[string, () => Promise<unknown>, Record<string, unknown>]>([
    ['a failed boot server install leaves nothing in flight', async () => {
      updateCoordinator.feed({ server: { phase: 'downloading', to: '0.26.10.7.1' } });
      return { updated: false, previousVersion: '0.26.10.5.2', error: 'uv tool install failed' };
    }, { applying: null, ui: { status: 'idle' } }],
    ['a critical server failure keeps its error', async () => {
      updateCoordinator.feed({ server: { phase: 'error', critical: true, error: 'rollback failed' } });
      return { updated: false, error: 'rollback failed' };
    }, { applying: null, server: { status: 'failed', error: 'rollback failed' } }],
  ])('the real boot path: %s', async (_name, install, expected) => {
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverFound);
    vi.mocked(maybeUpdateServer).mockImplementation(install as never);
    await new Promise<void>((resolve) => { initUpdater((() => null) as never, Promise.resolve(), () => 'auto', false, resolve); });
    expect(state()).toMatchObject(expected);
  });
});

describe('handleUnifiedApply', () => {
  it('a ready shell download relaunches, passing the running-tasks question through', async () => {
    updateCoordinator.feed({ shell: shell('ready-to-install', { targetVersion: '2.26.10.9.1' }) });
    runtime.requestShellInstall.mockResolvedValueOnce({ confirm: true, runningTasks: 2 } as never);
    expect(await handleUnifiedApply(() => null, {})).toEqual({ confirm: true, runningTasks: 2 });
    expect(await handleUnifiedApply(() => null, { force: true })).toBe(true);
    expect(runtime.requestShellInstall).toHaveBeenLastCalledWith({ force: true });
  });

  it('a Download or Retry click that lands after the shell became ready runs nothing', async () => {
    updateCoordinator.feed({ shell: shell('ready-to-install', { mode: 'manual', targetVersion: '2.26.10.9.1' }) });
    expect(await handleUnifiedApply(() => null, { action: 'download' })).toBe('stale');
    expect(await handleUnifiedApply(() => null, { action: 'retry' })).toBe('stale');
    expect(runtime.requestShellInstall).not.toHaveBeenCalled();
    expect(runtime.downloadShellAutoUpdate).not.toHaveBeenCalled();
    expect(runtime.checkShellAutoUpdate).not.toHaveBeenCalled();
  });
});

describe('offers through main\'s entry points', () => {
  it('a check where one channel errors keeps the other channel\'s offer', async () => {
    await offerFound(uiFound, serverFound);
    vi.mocked(checkForServerUpdate).mockResolvedValue({ updateAvailable: false, error: 'timeout' } as never);
    await checkForUpdates();
    expect(state()).toMatchObject({ ui: { status: 'ready', version: '2.26.10.7.1' }, server: { status: 'ready', version: '0.26.10.7.1' } });
  });

  it('an unreachable installer manifest keeps the notice, in a check and the boot poll; a definitive no clears it', async () => {
    const disabled = { ...idleSnapshot, phase: 'disabled' };
    runtime.checkShellAutoUpdate.mockResolvedValue(disabled as never);
    vi.mocked(getShellAutoUpdateSnapshot).mockReturnValue(disabled as never);
    vi.mocked(fetchManifest).mockResolvedValue({ shellVersion: '2.26.12.1.1' } as never);
    await checkForUpdates();
    vi.mocked(fetchManifest).mockResolvedValue(null);
    await checkForUpdates();
    const kept = { action: 'open-download-page', shell: { manual: true, version: '2.26.12.1.1' } };
    expect(state()).toMatchObject(kept);
    await new Promise<void>((resolve) => { initUpdater((() => null) as never, Promise.resolve(), () => 'auto', false, resolve); });
    expect(state()).toMatchObject(kept);
    vi.mocked(fetchManifest).mockResolvedValue({ shellVersion: '2.26.1.1.1' } as never);
    await checkForUpdates();
    expect(state().action).toBeNull();
  });

  it('an offer for a newer UI found while one reloads survives the reload', async () => {
    await offerFound(uiFound);
    vi.mocked(applyUIUpdate).mockResolvedValueOnce(true);
    const w = win({ navigates: false });
    const applying = handleUnifiedApply(() => w as never, { force: true });
    await vi.waitFor(() => expect(w.loadFile).toHaveBeenCalledTimes(1));
    await offerFound(uiNext);
    vi.mocked(getCachedVersion).mockReturnValue(uiFound.newVersion!);
    w.emit('did-navigate');
    w.emit('did-finish-load');
    expect(await applying).toBe(true);
    expect(state()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
  });

  it('a Restart that finds nothing to apply answers stale and clears the offer', async () => {
    await offerFound(uiFound);
    expect(await handleUnifiedApply(() => null, { force: true })).toBe('stale');
    expect(state()).toMatchObject({ applying: null, action: null, ui: { status: 'idle' } });
    // A server-only offer gone at the click's re-check: stale, and the server is not touched.
    await offerFound(uiNone, serverFound);
    vi.mocked(checkForServerUpdate).mockResolvedValue(serverNone);
    expect(await handleUnifiedApply(() => null, {})).toBe('stale');
    expect(maybeUpdateServer).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ action: null, server: { status: 'idle' } });
  });

  it('a failed download keeps the offer and names the version the apply tried', async () => {
    await offerFound(uiFound);
    vi.mocked(lastUiApplyAttempt).mockReturnValueOnce(uiNext.newVersion!);
    expect(await handleUnifiedApply(() => null, { force: true })).toBe(false);
    expect(state()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: uiNext.newVersion } });
  });

  it('behind a manual notice, a reload\'s progress and failure are named by the UI offer', async () => {
    await offerFound(uiFound);
    updateCoordinator.feed({ shellManual: { version: '2.26.12.1.1' } });
    let announced: string | undefined;
    vi.mocked(applyUIUpdate).mockImplementationOnce(async () => { announced = updateCoordinator.getInput().otaApply?.version; throw new Error('boom'); });
    expect(await handleUnifiedApply(() => null, { force: true, action: 'reload' })).toBe(false);
    expect(announced).toBe(uiFound.newVersion);
    expect(state().ui).toMatchObject({ status: 'failed', version: uiFound.newVersion });
  });

  it('a check during the Restart\'s server re-check leaves its progress alone, and shows with the dialog', async () => {
    await offerFound(uiFound);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(checkForServerUpdate).mockImplementationOnce(async () => { await gate; return serverFound; });
    vi.mocked(countRunningTasks).mockResolvedValueOnce(2);
    const request = handleUnifiedApply(() => null, {});
    await tick();
    await offerFound(uiNext);
    expect(state().applying).toBe('downloading');
    release();
    expect(await request).toEqual({ confirm: true, runningTasks: 2 });
    expect(state()).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' }, server: { status: 'ready' } });
  });
});
