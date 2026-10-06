import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const { appMock, startCrashReporterMock, tmpState } = vi.hoisted(() => ({
  appMock: { setPath: vi.fn(), exit: vi.fn() },
  startCrashReporterMock: vi.fn(),
  tmpState: { real: '', dir: '' },
}));
vi.mock('electron', () => ({ app: appMock }));
vi.mock('./crash-reporter', () => ({ startCrashReporter: () => startCrashReporterMock() }));

// Keeps the profile sweep and mkdtemp inside a per-test dir, away from the real tmpdir.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  tmpState.real = actual.tmpdir();
  const tmpdir = () => tmpState.dir;
  return { ...actual, tmpdir, default: { ...actual, tmpdir } };
});

import { runHtmlLint } from './html-lint-host';

describe('runHtmlLint — crash reporter', () => {
  beforeEach(() => {
    tmpState.dir = fs.mkdtempSync(path.join(tmpState.real, 'html-lint-host-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpState.dir, { recursive: true, force: true });
  });

  // Order matters: see crash-reporter.ts.
  it('starts after userData and sessionData move to the profile', () => {
    const runner = path.join(tmpState.dir, 'runner.js');
    fs.writeFileSync(runner, '');
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', runner);

    runHtmlLint();

    expect(startCrashReporterMock).toHaveBeenCalledOnce();
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
