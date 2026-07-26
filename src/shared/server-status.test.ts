import { describe, it, expect } from 'vitest';
import {
  SERVER_START_CAP_MS,
  SERVER_START_DEV_CAP_MS,
  backendFailureCopy,
  exitCodeLabel,
} from './server-status';

describe('start caps', () => {
  it('gives a dev source tree more room than a packaged install', () => {
    // A dev boot may build a whole .venv; a packaged one only imports.
    expect(SERVER_START_DEV_CAP_MS).toBeGreaterThan(SERVER_START_CAP_MS);
  });
});

describe('exitCodeLabel', () => {
  it('shows the real exit code whenever there is one', () => {
    expect(exitCodeLabel({ kind: 'exited', exitCode: 1 })).toBe('1');
    expect(exitCodeLabel({ kind: 'exited', exitCode: 0 })).toBe('0');
  });

  it('says "still starting" for a process we stopped waiting for', () => {
    // The regression this exists for: the tile read "never started" for a
    // backend that was importing normally.
    expect(exitCodeLabel({ kind: 'timeout', exitCode: null })).toBe('still starting');
  });

  it('says "unknown" when the process died without reporting a code', () => {
    expect(exitCodeLabel({ kind: 'exited', exitCode: null })).toBe('unknown');
  });

  it('says "never started" only when nothing ever ran', () => {
    expect(exitCodeLabel({ kind: 'spawn-error', exitCode: null })).toBe('never started');
    expect(exitCodeLabel({ kind: 'not-installed', exitCode: null })).toBe('never started');
    expect(exitCodeLabel({ kind: null, exitCode: null })).toBe('never started');
  });
});

describe('backendFailureCopy', () => {
  const base = { hasLog: false, port: 27903, portHolderPid: null };

  it('explains a timeout as a slow first launch and offers the recovery that works', () => {
    const copy = backendFailureCopy({ ...base, kind: 'timeout' });
    expect(copy.headline).toContain('still starting');
    expect(copy.hints.some((h) => /Quit the app/.test(h))).toBe(true);
  });

  it('never asks for a log when there is no log', () => {
    // The original panel told users to "copy the log and share it" in exactly
    // the state where the process died before printing anything.
    const copy = backendFailureCopy({ ...base, kind: 'timeout', hasLog: false });
    expect(copy.hints.some((h) => /copy the log/i.test(h))).toBe(false);
    expect(copy.hints.some((h) => /no log to send/.test(h))).toBe(true);
  });

  it('asks for the log when one exists', () => {
    const copy = backendFailureCopy({ ...base, kind: 'exited', hasLog: true });
    expect(copy.hints.some((h) => /copy the log below/.test(h))).toBe(true);
  });

  it('points at antivirus for a spawn error', () => {
    const copy = backendFailureCopy({ ...base, kind: 'spawn-error' });
    expect(copy.headline).toContain("couldn't be launched");
    expect(copy.hints.some((h) => /Antivirus/.test(h))).toBe(true);
  });

  it('sends an uninstalled backend to the installer', () => {
    const copy = backendFailureCopy({ ...base, kind: 'not-installed' });
    expect(copy.hints.some((h) => /Re-run the installer/.test(h))).toBe(true);
  });

  it('describes a boot-time death without guessing at a cause', () => {
    const copy = backendFailureCopy({ ...base, kind: 'exited' });
    expect(copy.headline).toContain('exited before it finished booting');
  });

  it('falls back to a plain not-running message when the kind is unknown', () => {
    const copy = backendFailureCopy({ ...base, kind: null });
    expect(copy.headline).toBe('The backend is not running.');
    expect(copy.hints).toContain('Start it below.');
  });

  it('names the process holding the port instead of guessing that one might be', () => {
    const copy = backendFailureCopy({ ...base, kind: 'timeout', portHolderPid: 4242 });
    expect(copy.hints.some((h) => h.includes('Process 4242') && h.includes('27903'))).toBe(true);
  });

  it('falls back to the legacy port in the copy when the port is unknown', () => {
    const copy = backendFailureCopy({ ...base, kind: 'timeout', port: null, portHolderPid: 7 });
    expect(copy.hints.some((h) => h.includes('port 26866'))).toBe(true);
  });
});
