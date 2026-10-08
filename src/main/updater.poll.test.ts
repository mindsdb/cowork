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

import { runUpdatePoll, handleUnifiedApply, updateCoordinator, availableStatus, initUpdater, type UpdatePollDeps, type ShellUpdateStatus } from './updater';
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
  const win = () => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    return {
      isDestroyed: () => false,
      loadFile: vi.fn(() => { setTimeout(() => listeners['did-finish-load']?.(), 0); }),
      webContents: {
        send: vi.fn(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { listeners[event] = cb; }),
        removeListener: vi.fn(),
      },
    };
  };

  beforeEach(() => {
    updateCoordinator.feed({ shell: shell('idle'), ota: null, server: null, shellManual: null });
  });

  it('a server-only manual apply settles the server and OTA layers before the reload', async () => {
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
    // The fresh renderer pulls an idle state: no stuck overlay, and a later
    // server-only offer can be marked ready again.
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null, server: { status: 'idle' }, ui: { status: 'idle' } });
    updateCoordinator.feed({ ota: availableStatus(uiNone, serverFound) });
    expect(updateCoordinator.getState().action).toBe('reload');
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

  it('answers false when nothing is pending, and leaves the installer page to the renderer', async () => {
    expect(await handleUnifiedApply(noWindow)).toBe(false);
    updateCoordinator.feed({ shellManual: { version: 'v' } });
    expect(await handleUnifiedApply(noWindow)).toBe(false);
    expect(runtime.requestShellInstall).not.toHaveBeenCalled();
  });
});
