import { describe, it, expect, vi } from 'vitest';

const startMock = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: (name: string) => `/mock/${name}` },
  crashReporter: { start: (opts: unknown) => startMock(opts) },
}));

import { startCrashReporter } from './crash-reporter';

describe('startCrashReporter', () => {
  it('collects locally only and logs where dumps go', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    startCrashReporter();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith({ uploadToServer: false });
    expect(log).toHaveBeenCalledWith('[crash-reporter] minidumps → /mock/crashDumps');
    log.mockRestore();
  });
});
