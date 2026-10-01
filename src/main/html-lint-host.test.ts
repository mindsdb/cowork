import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const { appMock, startCrashReporterMock, tmpState } = vi.hoisted(() => ({
  appMock: { setPath: vi.fn(), exit: vi.fn() },
  startCrashReporterMock: vi.fn(),
  tmpState: { dir: '' },
}));
vi.mock('electron', () => ({ app: appMock }));
vi.mock('./crash-reporter', () => ({ startCrashReporter: () => startCrashReporterMock() }));

// Keeps the profile sweep and mkdtemp inside a per-test dir, away from the real tmpdir.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const tmpdir = () => tmpState.dir;
  return { ...actual, default: { ...actual, tmpdir }, tmpdir };
});

import { runHtmlLint } from './html-lint-host';

describe('runHtmlLint — crash reporter', () => {
  beforeEach(async () => {
    const realOs = await vi.importActual<typeof import('os')>('os');
    tmpState.dir = fs.mkdtempSync(path.join(realOs.tmpdir(), 'html-lint-host-test-'));
    appMock.setPath.mockClear();
    appMock.exit.mockClear();
    startCrashReporterMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpState.dir, { recursive: true, force: true });
  });

  // Started before setPath, it would cache the default userData and keep its
  // crash database there instead of in the throwaway profile.
  it('starts after userData and sessionData move to the profile', () => {
    const runner = path.join(tmpState.dir, 'runner.js');
    fs.writeFileSync(runner, '');
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', runner);

    runHtmlLint();

    expect(startCrashReporterMock).toHaveBeenCalledTimes(1);
    expect(appMock.setPath).toHaveBeenCalledTimes(2);
    const lastSetPath = Math.max(...appMock.setPath.mock.invocationCallOrder);
    expect(lastSetPath).toBeLessThan(startCrashReporterMock.mock.invocationCallOrder[0]);
  });

  it('does not start without a runner', () => {
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', '');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    runHtmlLint();

    expect(appMock.exit).toHaveBeenCalledWith(2);
    expect(startCrashReporterMock).not.toHaveBeenCalled();
  });
});
