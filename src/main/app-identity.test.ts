import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHANNELS } from './channels';

// Exercise module-load app.setName calls: prod must retain its historical userData name, while
// other channels isolate state.
// The channel-table tests alone cannot catch an inverted runtime guard.

const appMock = { setName: vi.fn(), getName: vi.fn(() => 'mock-name') };
vi.mock('electron', () => ({ app: appMock }));

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
  });

  it('prod: NEVER calls app.setName (userData stays "anton", unchanged)', async () => {
    await loadForKind('prod');
    expect(appMock.setName).not.toHaveBeenCalled();
  });

  it.each(['dev', 'preview', 'stable'] as const)(
    'non-prod %s: sets the channel appName from CHANNELS',
    async (kind) => {
      await loadForKind(kind);
      expect(appMock.setName).toHaveBeenCalledTimes(1);
      expect(appMock.setName).toHaveBeenCalledWith(CHANNELS[kind].appName);
    },
  );
});
