import { describe, it, expect, vi, afterEach } from 'vitest';

const startMock = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/mock/${name}` },
  crashReporter: { start: (opts: unknown) => startMock(opts) },
}));

import { startCrashReporter } from './crash-reporter';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startCrashReporter', () => {
  it('collects locally only and logs where dumps go', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    startCrashReporter();
    expect(startMock).toHaveBeenCalledExactlyOnceWith({ uploadToServer: false });
    expect(log).toHaveBeenCalledWith('[crash-reporter] minidumps → /mock/crashDumps');
  });
});
