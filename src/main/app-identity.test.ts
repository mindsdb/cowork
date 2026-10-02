import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHANNELS } from './channels';

// app-identity.ts runs its logic as a MODULE-LOAD side effect (it calls
// app.setName for non-prod kinds so the userData dir is picked before token-store
// reads it). channels.test.ts only checks the CHANNELS *data*; these tests pin
// that app-identity correctly CONSUMES it — specifically that prod is never
// re-named (its userData stays "anton", byte-for-byte as shipped) and every
// non-prod kind is renamed to its channel appName. A flipped guard would
// silently break channel isolation, so it gets a direct test.

const appMock = { setName: vi.fn(), getName: vi.fn(() => 'mock-name') };
vi.mock('electron', () => ({ app: appMock }));

const startCrashReporterMock = vi.fn();
vi.mock('./crash-reporter', () => ({ startCrashReporter: () => startCrashReporterMock() }));

const buildKindMock = vi.fn();
vi.mock('./cowork-home', () => ({ buildKind: () => buildKindMock() }));

async function loadForKind(kind: string): Promise<void> {
  buildKindMock.mockReturnValue(kind);
  vi.resetModules(); // re-run app-identity's load-time side effect for this kind
  await import('./app-identity');
}

describe('app-identity — per-channel app name (userData isolation)', () => {
  beforeEach(() => {
    appMock.setName.mockClear();
    startCrashReporterMock.mockClear();
  });

  it('prod: NEVER calls app.setName (userData stays "anton", unchanged)', async () => {
    await loadForKind('prod');
    expect(appMock.setName).not.toHaveBeenCalled();
    expect(startCrashReporterMock).toHaveBeenCalledOnce();
  });

  // Order matters: see crash-reporter.ts.
  it.each(['dev', 'preview', 'stable'] as const)(
    'non-prod %s: sets the channel appName from CHANNELS, then starts the crash reporter',
    async (kind) => {
      await loadForKind(kind);
      expect(appMock.setName).toHaveBeenCalledExactlyOnceWith(CHANNELS[kind].appName);
      expect(startCrashReporterMock).toHaveBeenCalledOnce();
      expect(appMock.setName.mock.invocationCallOrder[0]).toBeLessThan(
        startCrashReporterMock.mock.invocationCallOrder[0],
      );
    },
  );
});
