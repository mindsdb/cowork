import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipc-channels';

const bridge = vi.hoisted(() => ({
  exposed: null as { onMindsHubCredentialChanged: (callback: () => void) => () => void } | null,
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: typeof bridge.exposed) => { bridge.exposed = api; } },
  ipcRenderer: { on: bridge.on, removeListener: bridge.removeListener, invoke: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}));

describe('credential handover preload notification', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await import('./preload');
  });

  it('delivers a payload-free callback and unsubscribes the same listener', () => {
    const callback = vi.fn();
    const cleanup = bridge.exposed!.onMindsHubCredentialChanged(callback);
    const [channel, listener] = bridge.on.mock.calls.find(([name]) => name === IPC.MINDSHUB_CREDENTIAL_CHANGED)!;
    listener({ sender: 'Electron event must not cross the bridge' });
    expect(callback.mock.calls).toEqual([[]]);
    cleanup();
    expect(bridge.removeListener).toHaveBeenCalledWith(channel, listener);
  });
});
