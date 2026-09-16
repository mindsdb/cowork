import { describe, expect, it, vi } from 'vitest';

// The runtime imports server-process (withServerMaintenance), which pulls in
// credential-provisioning → keychain-service → the native `keytar` module at
// load time. keytar needs libsecret on Linux CI, which isn't installed; this
// test only exercises the pure reconcileDownloadedTarget helper, so stub the
// credential layer to keep the import graph off keytar (mirrors
// server-process.test.ts).
vi.mock('./credential-provisioning', () => ({
  loadBundledServerCredentials: vi.fn().mockResolvedValue({}),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cowork-test-userdata', getVersion: () => '2.0.7', isPackaged: false, once: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

// `vi.spyOn` can't redefine an ESM namespace export, so the one call under test
// is replaced at the module boundary; everything else stays real.
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, default: actual, writeFileSync: vi.fn() };
});

import * as fs from 'node:fs';
import { reconcileDownloadedTarget, writeEvidence } from './shell-auto-update-runtime';

describe('reconcileDownloadedTarget', () => {
  const evidence = {
    targetVersion: '2.260727.2',
    channel: 'prod' as const,
    downloadedAt: '2026-07-27T00:00:00.000Z',
  };

  it('confirms an installed target or a newer running shell', () => {
    expect(reconcileDownloadedTarget('2.260727.2', evidence).phase).toBe('complete');
    expect(reconcileDownloadedTarget('2.260728.1', evidence).phase).toBe('complete');
  });

  it('surfaces a recoverable failure when relaunch stayed on the old shell', () => {
    expect(reconcileDownloadedTarget('2.260727.1', evidence)).toMatchObject({
      phase: 'failed',
      targetVersion: '2.260727.2',
      recoverable: true,
      errorCode: 'install-not-applied',
    });
  });

  it('starts idle without durable evidence', () => {
    expect(reconcileDownloadedTarget('2.260727.1', null)).toEqual({ phase: 'idle' });
  });
});

describe('writeEvidence', () => {
  const pending = {
    phase: 'ready-to-install' as const,
    mode: 'auto' as const,
    channel: 'prod' as const,
    currentVersion: '2.0.7',
    targetVersion: '2.260727.2',
  };

  it('retries after a failed write and skips only what is on disk', () => {
    const write = vi.mocked(fs.writeFileSync);
    write.mockReset();
    write.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // A transient failure must not be cached as "already persisted": the
      // relaunch check would then have no evidence to reconcile, and this
      // target would never be written again however many snapshots follow.
      writeEvidence(pending);
      expect(write).toHaveBeenCalledTimes(1);

      writeEvidence(pending);
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[1][1]).toContain('2.260727.2');

      // Now it is on disk, so the per-poll republishing stops rewriting it.
      writeEvidence(pending);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      write.mockReset();
      warn.mockRestore();
    }
  });
});
