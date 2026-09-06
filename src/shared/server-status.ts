// Shared startup budget and failure copy keep the main process and renderer consistent.

/**
 * Startup failures: spawn-error means nothing ran; exited means boot died; timeout means the
 * process was still starting at the cap; incompatible means health answered without the required
 * Code capability; not-installed means the backend or uv is absent.
 */
export type ServerStartErrorKind = 'spawn-error' | 'exited' | 'timeout' | 'incompatible' | 'not-installed';

/**
 * Hard cap for every build/platform, sized for cold venv creation and Windows antivirus scanning.
 * Progress/exit checks finish earlier; a dev-only allowance would hide packaged-start failures.
 */
export const SERVER_START_CAP_MS = 180_000;

/**
 * Stop attribution is true for deliberate stops, false for unexpected exits, and null before any
 * stop.
 */
export function exitCodeLabel(input: {
  kind: ServerStartErrorKind | null;
  exitCode: number | null;
  stopIntentional?: boolean | null;
}): string {
  // A timeout is reaped by us; its kill code is not a backend failure code.
  if (input.kind === 'timeout') return 'still starting';
  // An incompatible backend booted and answered /health normally; the only
  // exit code it can carry is from our own reap of it.
  if (input.kind === 'incompatible') return 'not applicable';
  if (typeof input.exitCode === 'number') return String(input.exitCode);
  if (input.stopIntentional === true) return 'stopped';
  if (input.stopIntentional === false) return 'unknown';
  switch (input.kind) {
    case 'exited': return 'unknown';
    case 'spawn-error':
    case 'not-installed': return 'never started';
    default: return 'never started';
  }
}

export interface BackendFailureCopy {
  /** One line naming the phase the start died in. */
  headline: string;
  /** What the user can actually do, most useful first. */
  hints: string[];
}

/**
 * Choose copy by failure kind and actual log availability. Never ask users for a log that was not
 * written.
 */
export function backendFailureCopy(input: {
  kind: ServerStartErrorKind | null;
  hasLog: boolean;
  port: number | null;
  portHolderPid: number | null;
}): BackendFailureCopy {
  const port = input.port ?? 26866;
  const hints: string[] = [];

  let headline: string;
  switch (input.kind) {
    case 'timeout':
      headline = 'The backend was still starting when the app stopped waiting.';
      hints.push(
        'This is usually the first launch after an install: the whole Python environment is being scanned as it runs for the first time, which is much slower than every launch after it.',
        'Quit the app completely and reopen it. The backend gets a fresh start and normally comes up on the second try.',
      );
      break;
    case 'exited':
      headline = 'The backend started and then exited before it finished booting.';
      break;
    case 'spawn-error':
      headline = "The backend program couldn't be launched at all.";
      hints.push(
        'Antivirus or endpoint protection blocking the executable is the usual cause; allow the MindsHub Cowork backend and try again.',
        'If that is not it, re-run the installer to reinstall the backend.',
      );
      break;
    case 'not-installed':
      headline = "The backend isn't installed yet.";
      hints.push('Re-run the installer to set it up.');
      break;
    case 'incompatible':
      headline = 'The backend needs to be updated for this version of MindsHub Cowork.';
      hints.push(
        'Quit MindsHub Cowork completely and reopen it so the matching backend can be installed and started.',
        'If the update does not complete, re-run the latest installer.',
      );
      break;
    default:
      headline = 'The backend is not running.';
      hints.push('Start it below.');
      break;
  }

  if (input.portHolderPid !== null) {
    hints.push(
      `Process ${input.portHolderPid} is holding port ${port}. Close it (or restart the machine) and start the backend again.`,
    );
  }

  hints.push(input.hasLog ? 'If it keeps failing, copy the log below and send it to support.' : noLogHint(input.kind));

  return { headline, hints };
}

/**
 * Distinguish never ran, exited and still starting so empty-log copy agrees with the failure
 * headline.
 */
function noLogHint(kind: ServerStartErrorKind | null): string {
  switch (kind) {
    case 'timeout':
      return 'The backend had not printed anything yet when the app stopped waiting, so there is no log to send.';
    case 'exited':
      return 'Nothing was captured in the log because the backend died before it printed anything, so there is no log to send.';
    case 'spawn-error':
      return 'The program never ran, so the launch error above is the only evidence there is; there is no log to send.';
    case 'not-installed':
      return 'Nothing has run yet, so there is no log to send.';
    case 'incompatible':
      return 'The backend responded normally, but it is an older incompatible version; there may be no error log.';
    default:
      return 'No log has been captured yet, so there is nothing to send.';
  }
}
