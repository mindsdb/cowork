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

/** Hard cap on a packaged start, in ms.
 *
 *  Not a "normal boot takes this long" figure — a warm packaged boot is under
 *  2s. It's the ceiling on a pathological one: a fresh install makes Windows
 *  Defender scan a brand-new uv venv's DLLs and .pyd files the first time they
 *  execute, which can push the pre-uvicorn import phase past half a minute. The
 *  wait is progress-aware, so this cap is only ever reached by a process that
 *  is genuinely still alive and still starting; a dead one is detected the
 *  moment it exits. */
export const SERVER_START_CAP_MS = 90_000;

/** Hard cap when running from a dev source tree, where `uv run` may build a
 *  fresh .venv and download the whole dependency tree on a cold cache. */
export const SERVER_START_DEV_CAP_MS = 180_000;

/** What the "Exit code" tile should read.
 *
 *  The tile used to say "never started" for every failure, which was actively
 *  misleading in the case that matters most: a process that was still starting
 *  when we gave up on it had very much started. */
export function exitCodeLabel(input: {
  kind: ServerStartErrorKind | null;
  exitCode: number | null;
}): string {
  if (typeof input.exitCode === 'number') return String(input.exitCode);
  switch (input.kind) {
    case 'timeout': return 'still starting';
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

  hints.push(
    input.hasLog
      ? 'If it keeps failing, copy the log below and send it to support.'
      : 'Nothing was captured in the log because the backend died before it printed anything, so there is no log to send.',
  );

  return { headline, hints };
}
