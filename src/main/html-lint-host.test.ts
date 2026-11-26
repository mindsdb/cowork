import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const { appMock, startCrashReporterMock, startHtmlLintRunnerMock, tmpState } = vi.hoisted(() => ({
  appMock: { setPath: vi.fn(), exit: vi.fn() },
  startCrashReporterMock: vi.fn(),
  startHtmlLintRunnerMock: vi.fn(),
  tmpState: { real: '', dir: '' },
}));
vi.mock('electron', () => ({ app: appMock }));
vi.mock('./crash-reporter', () => ({ startCrashReporter: () => startCrashReporterMock() }));
vi.mock('./html-lint-runner', () => ({ startHtmlLintRunner: startHtmlLintRunnerMock }));

// Keeps the profile sweep and mkdtemp inside a per-test dir, away from the real tmpdir.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  tmpState.real = actual.tmpdir();
  const tmpdir = () => tmpState.dir;
  return { ...actual, tmpdir, default: { ...actual, tmpdir } };
});

import { runHtmlLint, sweepStaleProfiles } from './html-lint-host';

/* A runner script that counts its own loads on a global, so a test can tell
 * whether the host required it. */
const LOADS = '__htmlLintEnvRunnerLoads';
function loadsOfEnvRunner(): number {
  return (globalThis as Record<string, unknown>)[LOADS] as number | undefined ?? 0;
}

function writeEnvRunner(): string {
  const runner = path.join(tmpState.dir, 'runner.js');
  fs.writeFileSync(runner, `globalThis.${LOADS} = (globalThis.${LOADS} || 0) + 1;\n`);
  return runner;
}

function writePage(): string {
  const page = path.join(tmpState.dir, 'page.html');
  fs.writeFileSync(page, '<!DOCTYPE html><html><body><h1>ok</h1></body></html>');
  return page;
}

function profiles(): string[] {
  return fs.readdirSync(tmpState.dir).filter((name) => name.startsWith('cowork-html-lint-'));
}

beforeEach(() => {
  tmpState.dir = fs.mkdtempSync(path.join(tmpState.real, 'html-lint-host-test-'));
  vi.clearAllMocks();
  startHtmlLintRunnerMock.mockResolvedValue(undefined);
  delete (globalThis as Record<string, unknown>)[LOADS];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmpState.dir, { recursive: true, force: true });
});

describe('runHtmlLint: crash reporter', () => {
  // Order matters: see crash-reporter.ts.
  it.each([true, false])('starts after userData and sessionData move to the profile (packaged: %s)', (packaged) => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', writePage());
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', writeEnvRunner());

    runHtmlLint({ packaged });

    expect(startCrashReporterMock).toHaveBeenCalledOnce();
    expect(appMock.setPath).toHaveBeenCalledTimes(2);
    const lastSetPath = Math.max(...appMock.setPath.mock.invocationCallOrder);
    expect(lastSetPath).toBeLessThan(startCrashReporterMock.mock.invocationCallOrder[0]);
  });

  it('does not start without a runner in an unpackaged run', () => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', writePage());
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', '');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    runHtmlLint({ packaged: false });

    expect(appMock.exit).toHaveBeenCalledWith(2);
    expect(startCrashReporterMock).not.toHaveBeenCalled();
  });
});

/* On Linux os.tmpdir() is the shared /tmp, where any account can create an
 * entry with the profile prefix. The sweep runs at the start of every lint run. */
describe('the stale profile sweep', () => {
  const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let outside: string;

  /* The file-level hooks give each test its own tmpdir and reset the mocks. */
  beforeEach(() => {
    outside = fs.mkdtempSync(path.join(tmpState.real, 'html-lint-outside-'));
  });

  afterEach(() => {
    fs.rmSync(outside, { recursive: true, force: true });
  });

  /* A packaged run with a real target reaches the sweep; the bundled runner is mocked. */
  function lintRun(): void {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', writePage());
    runHtmlLint({ packaged: true });
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

describe('runHtmlLint: which runner runs', () => {
  it('runs the bundled runner in a packaged build and never requires the script ANTON_HTML_LINT_RUNNER names', () => {
    const page = writePage();
    vi.stubEnv('ANTON_HTML_LINT_TARGET', page);
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', writeEnvRunner());

    runHtmlLint({ packaged: true });

    expect(startHtmlLintRunnerMock).toHaveBeenCalledExactlyOnceWith(page);
    expect(loadsOfEnvRunner()).toBe(0);
    expect(appMock.exit).not.toHaveBeenCalled();
    /* The profile still moves before the runner opens a window. */
    expect(profiles()).toHaveLength(1);
    expect(appMock.setPath).toHaveBeenCalledWith('userData', path.join(tmpState.dir, profiles()[0]));
  });

  it('needs no ANTON_HTML_LINT_RUNNER in a packaged build', () => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', writePage());
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', 'relative/runner.js');

    runHtmlLint({ packaged: true });

    expect(startHtmlLintRunnerMock).toHaveBeenCalledOnce();
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it('lints an http(s) URL target with the bundled runner', () => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', 'http://127.0.0.1:8123/index.html');

    runHtmlLint({ packaged: true });

    expect(startHtmlLintRunnerMock).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8123/index.html');
  });

  it('requires the script ANTON_HTML_LINT_RUNNER names in an unpackaged run', () => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', writePage());
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', writeEnvRunner());

    runHtmlLint({ packaged: false });

    expect(loadsOfEnvRunner()).toBe(1);
    expect(startHtmlLintRunnerMock).not.toHaveBeenCalled();
  });

  it('ends the run with a non-zero exit when the bundled runner fails', async () => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', writePage());
    startHtmlLintRunnerMock.mockRejectedValue(new Error('no window'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    runHtmlLint({ packaged: true });
    await vi.waitFor(() => expect(appMock.exit).toHaveBeenCalledWith(1));

    expect(String(stderr.mock.calls[0][0])).toContain('no window');
  });
});

describe('runHtmlLint: refused targets', () => {
  it.each([
    { name: 'a relative path', target: () => 'page.html' },
    { name: 'an absolute path that does not exist', target: () => path.join(tmpState.dir, 'missing.html') },
    { name: 'a URL that does not parse', target: () => 'http://' },
    { name: 'a scheme other than http(s)', target: () => 'javascript:alert(1)' },
  ])('refuses $name before a profile or a runner, packaged or not', ({ target }) => {
    vi.stubEnv('ANTON_HTML_LINT_TARGET', target());
    vi.stubEnv('ANTON_HTML_LINT_RUNNER', writeEnvRunner());
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    for (const packaged of [true, false]) {
      runHtmlLint({ packaged });
    }

    expect(appMock.exit.mock.calls).toEqual([[2], [2]]);
    expect(String(stderr.mock.calls[0][0])).toContain('ANTON_HTML_LINT_TARGET');
    expect(startHtmlLintRunnerMock).not.toHaveBeenCalled();
    expect(loadsOfEnvRunner()).toBe(0);
    expect(appMock.setPath).not.toHaveBeenCalled();
    expect(profiles()).toEqual([]);
  });
});
