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

import { runHtmlLint, sweepStaleProfiles } from './html-lint-host';

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

/* On Linux os.tmpdir() is the shared /tmp, where any account can create an
 * entry with the profile prefix. The sweep runs at the start of every lint run. */
describe('the stale profile sweep', () => {
  const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let outside: string;

  beforeEach(() => {
    tmpState.dir = fs.mkdtempSync(path.join(tmpState.real, 'html-lint-sweep-test-'));
    outside = fs.mkdtempSync(path.join(tmpState.real, 'html-lint-outside-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpState.dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  function lintRun(): void {
    const runner = path.join(outside, 'runner.js');
    fs.writeFileSync(runner, '');
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', runner);
    runHtmlLint();
  }

  function staleProfile(name: string): string {
    const dir = path.join(tmpState.dir, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'Cookies'), 'x');
    fs.utimesSync(dir, longAgo, longAgo);
    return dir;
  }

  it('removes a stale profile this user owns', () => {
    const dir = staleProfile('cowork-html-lint-mine');
    lintRun();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('keeps a stale folder another account owns', () => {
    const dir = staleProfile('cowork-html-lint-theirs');
    vi.spyOn(process, 'getuid').mockReturnValue(fs.statSync(dir).uid + 1);

    lintRun();

    expect(fs.existsSync(path.join(dir, 'Cookies'))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('never follows a link with the prefix, and leaves the link itself', () => {
    const target = path.join(outside, 'user-files');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
    fs.utimesSync(target, longAgo, longAgo);
    const link = path.join(tmpState.dir, 'cowork-html-lint-link');
    fs.symlinkSync(target, link);
    fs.lutimesSync(link, longAgo, longAgo);

    lintRun();

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true);
  });

  it('skips the owner check on win32, whose temp folder is per user', () => {
    const dir = staleProfile('cowork-html-lint-win');
    vi.spyOn(process, 'getuid').mockReturnValue(fs.statSync(dir).uid + 1);

    sweepStaleProfiles({ platform: 'win32' });

    expect(fs.existsSync(dir)).toBe(false);
  });

  it('keeps a fresh profile, which a concurrent run may be using', () => {
    const dir = path.join(tmpState.dir, 'cowork-html-lint-fresh');
    fs.mkdirSync(dir);
    lintRun();
    expect(fs.existsSync(dir)).toBe(true);
  });
});
