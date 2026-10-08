import { beforeEach, describe, expect, it, vi } from 'vitest';

// The UI_UPDATE_APPLY handler (ENG-3291): a restart that includes a server
// update ends every running turn, so it asks before it acts. The question
// must open within seconds, so the handler decides from the last poll's
// server check before it goes to the network, and a forced apply that follows
// the dialog reuses that check instead of running it again.

vi.mock('electron', () => ({
  app: { getVersion: () => '2.260928.1', isPackaged: true },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
}));
vi.mock('./ui-updater', () => ({
  checkForUIUpdate: vi.fn(async () => ({ updateAvailable: false, applied: false })),
  applyUIUpdate: vi.fn(async () => false),
  getRendererPath: vi.fn(() => '/renderer'),
  hasInternet: vi.fn(async () => true),
  rollbackUI: vi.fn(async () => undefined),
  isServingOta: vi.fn(() => false),
  verifyServedUiCompat: vi.fn(async () => 'verified'),
  fetchManifest: vi.fn(async () => null),
}));
type ServerCheck = { updateAvailable: boolean; latestVersion?: string; repair?: boolean };
const serverUpdater = vi.hoisted(() => ({
  check: vi.fn(async (): Promise<ServerCheck> => ({ updateAvailable: true, latestVersion: '0.26.10.7.1' })),
  apply: vi.fn(async () => ({ updated: true, previousVersion: '0.26.10.5.2', newVersion: '0.26.10.7.1' })),
}));
vi.mock('./server-updater', () => ({
  checkForServerUpdate: serverUpdater.check,
  maybeUpdateServer: serverUpdater.apply,
}));
const sidecar = vi.hoisted(() => ({ running: true }));
vi.mock('./server-process', () => ({ isServerRunning: () => sidecar.running }));
const tasks = vi.hoisted(() => ({ count: vi.fn(async (): Promise<number | null> => 0) }));
vi.mock('./running-tasks', () => ({ countRunningTasks: tasks.count }));
vi.mock('./cowork-home', () => ({ buildKindStrict: () => 'prod' }));
vi.mock('./server-source', () => ({ getAppDisplayVersion: () => '2.26.9.28.1' }));
vi.mock('./update-maintenance', () => ({ withUpdateMaintenance: (fn: () => unknown) => fn() }));
vi.mock('./shell-auto-update-runtime', () => ({
  checkShellAutoUpdate: vi.fn(async () => ({ phase: 'idle' })),
  configureShellAutoUpdate: vi.fn(),
  getShellAutoUpdateSnapshot: vi.fn(() => ({ phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.260928.1' })),
  registerShellAutoUpdateHandlers: vi.fn(),
  startShellAutoUpdatePolling: vi.fn(() => Promise.resolve()),
}));

import { checkForUpdates, handleApplyRequest } from './updater';

const apply = (options?: { force?: boolean }) => handleApplyRequest(() => null, options);

beforeEach(() => {
  serverUpdater.check.mockClear();
  serverUpdater.apply.mockClear();
  tasks.count.mockClear();
  tasks.count.mockResolvedValue(0);
  sidecar.running = true;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('UI_UPDATE_APPLY (ENG-3291)', () => {
  it('asks from the last check before any remote call while tasks run', async () => {
    // The poll that offered the Restart already found the server update.
    await checkForUpdates();
    serverUpdater.check.mockClear();
    tasks.count.mockResolvedValue(2);

    expect(await apply({})).toEqual({ confirm: true, runningTasks: 2 });
    expect(tasks.count).toHaveBeenCalledTimes(1);
    expect(serverUpdater.check).not.toHaveBeenCalled();
    expect(serverUpdater.apply).not.toHaveBeenCalled();
  });

  it('after Restart anyway, reuses the check that preceded the dialog and applies once', async () => {
    await checkForUpdates();
    serverUpdater.check.mockClear();

    expect(await apply({ force: true })).toBe(true);
    expect(serverUpdater.check).not.toHaveBeenCalled();
    expect(tasks.count).not.toHaveBeenCalled();
    expect(serverUpdater.apply).toHaveBeenCalledTimes(1);
  });

  it('with no task running, re-checks the server once and applies', async () => {
    await checkForUpdates();
    serverUpdater.check.mockClear();

    expect(await apply({})).toBe(true);
    expect(tasks.count).toHaveBeenCalledTimes(1);
    expect(serverUpdater.check).toHaveBeenCalledTimes(1);
    expect(serverUpdater.apply).toHaveBeenCalledTimes(1);
  });

  it('still asks when the re-check finds a server update the last poll did not know about', async () => {
    // The last poll found nothing, so the fast path cannot answer; the remote
    // check runs first, finds the update, and the handler asks then.
    serverUpdater.check.mockResolvedValueOnce({ updateAvailable: false });
    await checkForUpdates();
    serverUpdater.check.mockClear();
    tasks.count.mockResolvedValue(1);
    expect(await apply({})).toEqual({ confirm: true, runningTasks: 1 });
    expect(serverUpdater.check).toHaveBeenCalledTimes(1);
    expect(tasks.count).toHaveBeenCalledTimes(1);
    expect(serverUpdater.apply).not.toHaveBeenCalled();
  });

  it('never asks for a UI-only apply', async () => {
    serverUpdater.check.mockResolvedValue({ updateAvailable: false });
    await checkForUpdates();
    tasks.count.mockResolvedValue(3);
    await apply({});
    expect(tasks.count).not.toHaveBeenCalled();
    expect(serverUpdater.apply).not.toHaveBeenCalled();
    serverUpdater.check.mockResolvedValue({ updateAvailable: true, latestVersion: '0.26.10.7.1' });
  });
});
