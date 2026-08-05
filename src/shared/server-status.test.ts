import { describe, it, expect } from 'vitest';
import {
  SERVER_START_CAP_MS,
  backendFailureCopy,
  exitCodeLabel,
} from './server-status';

describe('start cap', () => {
  it('is one number, big enough for the slowest case any build can hit', () => {
    // Deliberately not split by build kind: a dev-only allowance means a start
    // that passes locally can still be killed in a packaged build, so the
    // failure only ever reproduces on a customer's machine. A dev boot may
    // build a whole .venv on a cold cache, so that is the case it is sized for.
    expect(SERVER_START_CAP_MS).toBeGreaterThanOrEqual(180_000);
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

  it('keeps saying "still starting" even though our own reap left an exit code', () => {
    // taskkill /F makes the child exit 1. That code is ours, not the backend's,
    // so reporting it as "the exit code" would be the same lie in a new costume.
    expect(exitCodeLabel({ kind: 'timeout', exitCode: 1 })).toBe('still starting');
  });

  it('says "stopped" for a backend the user deliberately stopped', () => {
    // A signal kill leaves no exit code, so this used to read "never started"
    // for a backend that had been running perfectly.
    expect(exitCodeLabel({ kind: null, exitCode: null, stopIntentional: true })).toBe('stopped');
  });

  it('prefers the real code over the stop attribution', () => {
    expect(exitCodeLabel({ kind: null, exitCode: 0, stopIntentional: true })).toBe('0');
  });

  it('says "unknown" when the process died on its own without reporting a code', () => {
    expect(exitCodeLabel({ kind: 'exited', exitCode: null })).toBe('unknown');
    expect(exitCodeLabel({ kind: null, exitCode: null, stopIntentional: false })).toBe('unknown');
  });

  it('says "never started" only when nothing ever ran', () => {
    expect(exitCodeLabel({ kind: 'spawn-error', exitCode: null })).toBe('never started');
    expect(exitCodeLabel({ kind: 'not-installed', exitCode: null })).toBe('never started');
    expect(exitCodeLabel({ kind: null, exitCode: null })).toBe('never started');
    expect(exitCodeLabel({ kind: null, exitCode: null, stopIntentional: null })).toBe('never started');
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

  it('does not tell the user the backend died when it is still alive', () => {
    // One "it died before printing anything" sentence for every kind
    // contradicted the headline directly above it: a timed-out backend is
    // alive and still importing, and nothing ran at all in the other two.
    for (const kind of ['timeout', 'spawn-error', 'not-installed'] as const) {
      const copy = backendFailureCopy({ ...base, kind, hasLog: false });
      expect(copy.hints.some((h) => /died/.test(h))).toBe(false);
      expect(copy.hints.some((h) => /no log to send/.test(h))).toBe(true);
    }
    // Only the one kind where it is true says it.
    const exited = backendFailureCopy({ ...base, kind: 'exited', hasLog: false });
    expect(exited.hints.some((h) => /died before it printed anything/.test(h))).toBe(true);
  });

  it('says nothing has been captured yet when there is no failure at all', () => {
    const copy = backendFailureCopy({ ...base, kind: null, hasLog: false });
    expect(copy.hints.some((h) => /No log has been captured yet/.test(h))).toBe(true);
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
