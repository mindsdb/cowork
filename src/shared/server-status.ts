// Sidecar start budget + the copy that explains a failed start.
//
// Shared because the two sides have to agree: the main process owns the
// budget and classifies the failure, the renderer renders it. Keeping the
// caps and the copy here means a renderer can never describe a state the
// main process no longer produces, and the "how long do we wait" number has
// exactly one definition.
//
// Pure — no fs, no electron, no network. Tested directly.

/** Why a start attempt failed, as classified by the main process.
 *
 *  - `spawn-error`  — the OS refused to launch the program (EPERM from an AV
 *                     product, ENOENT for a broken shim). Nothing ever ran, so
 *                     there is no output to show.
 *  - `exited`       — the process ran and then died during boot. Its exit code
 *                     and whatever it printed are the evidence.
 *  - `timeout`      — the process was still alive, and still silent, when the
 *                     hard cap expired. Usually a very slow first import.
 *  - `not-installed`— the backend (or uv) isn't on disk at all.
 */
export type ServerStartErrorKind = 'spawn-error' | 'exited' | 'timeout' | 'not-installed';

/** Hard cap on a start, in ms. One number for every build and every platform.
 *
 *  Not a "normal boot takes this long" figure — a warm packaged boot is under
 *  2s. It's the ceiling on a pathological one: a fresh install makes Windows
 *  Defender scan a brand-new uv venv's DLLs and .pyd files the first time they
 *  execute, which can push the pre-uvicorn import phase past half a minute; a
 *  dev source tree may additionally build a whole .venv on a cold cache. The
 *  wait is progress-aware, so this cap is only ever reached by a process that
 *  is genuinely still alive and still starting; a dead one is detected the
 *  moment it exits, and a healthy one the moment it answers.
 *
 *  Deliberately NOT split by build kind. A dev-only allowance means a start
 *  that passes locally can still be killed in a packaged build, so the failure
 *  only ever reproduces on a customer's machine. The cap is sized for the
 *  slowest case any build can hit, and every build gets the same one. */
export const SERVER_START_CAP_MS = 180_000;

/** What the "Exit code" tile should read.
 *
 *  The tile used to say "never started" for every failure, which was actively
 *  misleading in the two cases that matter most: a process that was still
 *  starting when we gave up on it had very much started, and so had one the
 *  user deliberately stopped.
 *
 *  `stopIntentional` is the stop attribution from the main process: true when
 *  the backend went down because someone asked it to, false when it died on
 *  its own, null before it has ever gone down. */
export function exitCodeLabel(input: {
  kind: ServerStartErrorKind | null;
  exitCode: number | null;
  stopIntentional?: boolean | null;
}): string {
  // A timed-out start is reaped by us, so any exit code on it is our own
  // taskkill/SIGKILL rather than anything the backend chose. Reporting that
  // number as "the exit code" would be the same lie in a new costume.
  if (input.kind === 'timeout') return 'still starting';
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

/** The offline panel's explanation, chosen from the failure kind rather than
 *  from string-matching the error message.
 *
 *  The rule this exists to enforce: never ask for a log in the one state where
 *  no log can exist. A start that dies before the process prints anything
 *  leaves the tail empty AND truncates the on-disk log on the next attempt, so
 *  "copy the log and share it" sent users hunting for something that was never
 *  written. */
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

/** Why the log is empty, phrased so it agrees with the headline above it.
 *
 *  A single "it died before printing anything" sentence contradicted three of
 *  the four kinds: a timed-out backend is alive and still importing, and
 *  nothing ran at all in the not-installed and spawn-error cases. */
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
    default:
      return 'No log has been captured yet, so there is nothing to send.';
  }
}
