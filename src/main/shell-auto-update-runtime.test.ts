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

import { reconcileDownloadedTarget } from './shell-auto-update-runtime';

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
