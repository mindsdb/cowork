// Sidecar start budget + the copy that explains a failed start.
//
// Shared because the two sides have to agree: the main process owns the
// budget and classifies the failure, the renderer renders it. Keeping the
// caps and the copy here means a renderer can never describe a state the
// main process no longer produces, and the "how long do we wait" number has
// exactly one definition.
//
// Pure — no fs, no electron, no network. Tested directly.

import { STOCK_PRODUCT_NAME } from './product-name';
import { sourceTranslator, type Translate } from './i18n/translate';
import appSource from './i18n/locales/en/app.json';

/* The copy lives in the `app` catalog under `serverStatus`. The renderer
   passes its `app` translator; without one the copy is English. */
const english: Translate = sourceTranslator(appSource);
const product = { product: STOCK_PRODUCT_NAME };

/** Why a start attempt failed, as classified by the main process.
 *
 *  - `spawn-error`  — the OS refused to launch the program (EPERM from an AV
 *                     product, ENOENT for a broken shim). Nothing ever ran, so
 *                     there is no output to show.
 *  - `exited`       — the process ran and then died during boot. Its exit code
 *                     and whatever it printed are the evidence.
 *  - `timeout`      — the process was still alive, and still silent, when the
 *                     hard cap expired. Usually a very slow first import.
 *  - `incompatible` — a healthy backend answered, but it does not expose the
 *                     Code capability required by this desktop build.
 *  - `not-installed`— the backend (or uv) isn't on disk at all.
 *  - `credential-clear` — a sign-out left API keys for the backend to remove at
 *                     startup, and it could not, so it stopped rather than
 *                     serve them. Also used when the previous backend for that
 *                     store could not be stopped to make way for one that would.
 */
export type ServerStartErrorKind =
  | 'spawn-error' | 'exited' | 'timeout' | 'incompatible' | 'not-installed' | 'credential-clear';

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
}, t: Translate = english): string {
  // A timed-out start is reaped by us, so any exit code on it is our own
  // taskkill/SIGKILL rather than anything the backend chose. Reporting that
  // number as "the exit code" would be the same lie in a new costume.
  if (input.kind === 'timeout') return t('serverStatus.exitCode.stillStarting');
  // An incompatible backend booted and answered /health normally; the only
  // exit code it can carry is from our own reap of it.
  if (input.kind === 'incompatible') return t('serverStatus.exitCode.notApplicable');
  if (typeof input.exitCode === 'number') return String(input.exitCode);
  if (input.stopIntentional === true) return t('serverStatus.exitCode.stopped');
  if (input.stopIntentional === false) return t('serverStatus.exitCode.unknown');
  switch (input.kind) {
    case 'exited': return t('serverStatus.exitCode.unknown');
    case 'spawn-error':
    case 'not-installed': return t('serverStatus.exitCode.neverStarted');
    default: return t('serverStatus.exitCode.neverStarted');
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
}, t: Translate = english): BackendFailureCopy {
  const port = input.port ?? 26866;
  const hints: string[] = [];

  let headline: string;
  switch (input.kind) {
    case 'timeout':
      headline = t('serverStatus.timeout.headline');
      hints.push(
        t('serverStatus.timeout.firstLaunch'),
        t('serverStatus.timeout.reopen'),
      );
      break;
    case 'exited':
      headline = t('serverStatus.exited.headline');
      break;
    case 'spawn-error':
      headline = t('serverStatus.spawnError.headline');
      hints.push(
        t('serverStatus.spawnError.antivirus', product),
        t('serverStatus.spawnError.reinstall'),
      );
      break;
    case 'not-installed':
      headline = t('serverStatus.notInstalled.headline');
      hints.push(t('serverStatus.notInstalled.rerun'));
      break;
    case 'credential-clear':
      headline = t('serverStatus.credentialClear.headline');
      hints.push(
        t('serverStatus.credentialClear.reopen', product),
        t('serverStatus.credentialClear.filesHeld'),
      );
      break;
    case 'incompatible':
      headline = t('serverStatus.incompatible.headline', product);
      hints.push(
        t('serverStatus.incompatible.reopen', product),
        t('serverStatus.incompatible.rerun'),
      );
      break;
    default:
      headline = t('serverStatus.notRunning.headline');
      hints.push(t('serverStatus.notRunning.startBelow'));
      break;
  }

  if (input.portHolderPid !== null) {
    hints.push(
      t('serverStatus.portHeld', { pid: String(input.portHolderPid), port: String(port) }),
    );
  }

  hints.push(input.hasLog ? t('serverStatus.copyLog') : noLogHint(input.kind, t));

  return { headline, hints };
}

/** Why the log is empty, phrased so it agrees with the headline above it.
 *
 *  A single "it died before printing anything" sentence contradicted three of
 *  the four kinds: a timed-out backend is alive and still importing, and
 *  nothing ran at all in the not-installed and spawn-error cases. */
function noLogHint(kind: ServerStartErrorKind | null, t: Translate): string {
  switch (kind) {
    case 'timeout':
      return t('serverStatus.noLog.timeout');
    case 'exited':
      return t('serverStatus.noLog.exited');
    case 'spawn-error':
      return t('serverStatus.noLog.spawnError');
    case 'not-installed':
      return t('serverStatus.noLog.notInstalled');
    case 'incompatible':
      return t('serverStatus.noLog.incompatible');
    case 'credential-clear':
      return t('serverStatus.noLog.credentialClear');
    default:
      return t('serverStatus.noLog.default');
  }
}
