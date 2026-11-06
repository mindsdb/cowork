import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keeps the real maintenance lock, since the queue is the point.

vi.mock('electron', () => ({
  app: { getVersion: () => '2.260928.1', isPackaged: true, on: vi.fn() },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
}));
vi.mock('./ui-updater', () => ({
  checkForUIUpdate: vi.fn(async () => ({ updateAvailable: false, applied: false })),
  applyUIUpdate: vi.fn(async () => false),
  getRendererPath: vi.fn(() => '/renderer'),
  hasInternet: vi.fn(async () => true),
  rollbackUI: vi.fn(async () => undefined),
  isServingOta: vi.fn(() => true),
  verifyServedUiCompat: vi.fn(async () => 'verified'),
  fetchManifest: vi.fn(async () => null),
  getCachedVersion: vi.fn(() => null),
  lastUiApplyAttempt: vi.fn(() => null),
}));
vi.mock('./update-journal', async (importActual) => ({
  ...await importActual<typeof import('./update-journal')>(),
  recordUpdatePhase: vi.fn(),
}));
vi.mock('./server-updater', () => ({
  checkForServerUpdate: vi.fn(async () => ({ updateAvailable: false })),
  maybeUpdateServer: vi.fn(),
}));
vi.mock('./server-process', () => ({ isServerRunning: () => true }));
vi.mock('./running-tasks', () => ({ countRunningTasks: vi.fn(async () => 0) }));
vi.mock('./cowork-home', () => ({ buildKindStrict: () => 'prod' }));
vi.mock('./server-source', () => ({ getAppDisplayVersion: () => '2.26.9.28.1' }));
vi.mock('./shell-auto-update-runtime', () => ({
  checkShellAutoUpdate: vi.fn(async () => ({ phase: 'idle' })),
  downloadShellAutoUpdate: vi.fn(async () => ({ phase: 'idle' })),
  requestShellInstall: vi.fn(async () => true),
  configureShellAutoUpdate: vi.fn(),
  getShellAutoUpdateSnapshot: vi.fn(() => ({ phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.260928.1' })),
  onShellAutoUpdateSnapshot: vi.fn(),
  registerShellAutoUpdateHandlers: vi.fn(),
  startShellAutoUpdatePolling: vi.fn(() => Promise.resolve()),
}));

import { handleUnifiedApply, initUpdater, updateCoordinator } from './updater';
import { applyUIUpdate, checkForUIUpdate } from './ui-updater';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  updateCoordinator.feed({ shell: null, otaOffer: null, otaApply: null, server: null, shellManual: null });
});

describe('a Restart queued behind another apply', () => {
  it('keeps its progress when the apply ahead of it settles, and settles its own when it ran', async () => {
    let releaseBoot!: (applied: boolean) => void;
    vi.mocked(checkForUIUpdate).mockResolvedValueOnce({ updateAvailable: true, applied: false, newVersion: '2.26.10.7.1' });
    vi.mocked(applyUIUpdate).mockImplementationOnce(() => new Promise<boolean>((r) => { releaseBoot = r; }));
    const bootDone = new Promise<void>((resolve) => {
      initUpdater((() => null) as never, Promise.resolve(), () => 'auto', false, resolve);
    });
    await vi.waitFor(() => expect(applyUIUpdate).toHaveBeenCalledTimes(1));

    updateCoordinator.feed({ otaOffer: { ui: { version: '2.26.10.8.1' }, server: null } });
    expect(updateCoordinator.getState().action).toBe('reload');
    let releaseClick!: (applied: boolean) => void;
    vi.mocked(applyUIUpdate).mockImplementationOnce(() => new Promise<boolean>((r) => { releaseClick = r; }));
    const click = handleUnifiedApply(() => null, { force: true, action: 'reload' });
    await tick();
    expect(updateCoordinator.getState().applying).toBe('downloading');

    // The boot apply settles while the click is still queued.
    releaseBoot(false);
    await bootDone;
    await tick();
    expect(updateCoordinator.getState().applying).toBe('downloading');

    await vi.waitFor(() => expect(applyUIUpdate).toHaveBeenCalledTimes(2));
    expect(updateCoordinator.getState().applying).toBe('downloading');
    releaseClick(false);
    expect(await click).toBe('stale');
    expect(updateCoordinator.getState()).toMatchObject({ applying: null, action: null });
  });
});
