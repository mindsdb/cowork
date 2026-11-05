// Supported desktop window (ENG-1047).
//
// The UI bundle hot-updates over the air while the Electron shell (`src/main`,
// preload, the runtime) only changes on a relaunch, so a newer UI routinely
// runs on an older shell. The UI copes by probing bridge methods and falling
// back without a word — which is exactly how a 5-week-old shell came to hide
// Code mode and the onboarding organization picker on 6 October 2026. This
// module names how far back a shell may fall before the UI says so.
//
// Pure: takes version strings, returns a verdict. The renderer reads the
// installed shell version over the bridge and the newest published shell from
// the release manifest (`shellVersion` in latest.json), then calls
// `assessShellSupport`. Settings → Updates and the launch notice render from
// the same verdict so they cannot disagree. See the "Supported desktop window"
// section of docs/update-behavior.md.

import { parseCalVer, compareCalVer, calverDate } from './version';

/**
 * The oldest prod shell the current UI and cowork-server support.
 *
 * 2.26.9.21.1 is where per-account data roots (ENG-548) and the post-update
 * auth probe (ENG-2852) landed. Older shells show one account's data to whoever
 * signs in, so the floor is a hard one. It also already exposes every bridge
 * member today's UI reads.
 *
 * This value is the ENG-1047 proposal, pending Lucas's decision. Whoever moves
 * it also updates the "Supported desktop window" section of
 * docs/update-behavior.md and cowork-server's README.
 */
export const MIN_SUPPORTED_SHELL = '2.26.9.21.1';

/**
 * How many days behind the newest published shell a shell may be and still be
 * supported. Measured against the manifest's `shellVersion`, never the UI:
 * UI-only publishes ship without a new shell, so a rule measured against the
 * UI would call the newest shell too old after a pause in shell releases.
 * Prod shells shipped 11 times in the 33 days to 4 October 2026, never more
 * than 6 days apart, so 14 days spans at least two releases. ENG-1047 proposal.
 */
export const SUPPORTED_SHELL_WINDOW_DAYS = 14;

/** Where a shell that cannot update itself sends the user (ENG-849/ENG-1103). */
export const SHELL_DOWNLOAD_PAGE = 'https://mindshub.ai/download';

export type ShellBuildKind = 'dev' | 'preview' | 'stable' | 'prod';
export type ShellVersionSource = 'bundled' | 'ota' | 'web';

export interface ShellSupportInput {
  /** Installed Electron shell version, from the bridge. */
  shellVersion: string | null | undefined;
  /** Newest published prod shell, `shellVersion` in the release manifest. */
  latestShellVersion: string | null | undefined;
  /** Where the running renderer came from. `web` has no shell. */
  source: ShellVersionSource | null | undefined;
  /** The shell's build kind when it reports one; null on legacy shells. */
  buildKind: ShellBuildKind | null | undefined;
}

export type ShellSupportNotApplicableReason =
  | 'web'
  | 'non-prod'
  | 'untagged-shell'
  | 'unparseable-shell'
  | 'unparseable-latest';

export type ShellSupportVerdict =
  /** No verdict: the rule does not apply here, or a version it needs is
   *  missing or unreadable. Callers show nothing. */
  | { status: 'not-applicable'; reason: ShellSupportNotApplicableReason }
  | {
    status: 'supported';
    shellVersion: string;
    latestShellVersion: string;
    daysBehind: number;
  }
  | {
    status: 'too-old';
    shellVersion: string;
    latestShellVersion: string;
    daysBehind: number;
    reason: 'below-floor' | 'outside-window';
  };

const DAY_MS = 86_400_000;

/**
 * Decide whether the installed shell is inside the supported window.
 *
 * Fails closed to `not-applicable` whenever a version it needs cannot be read,
 * so a broken manifest or an odd dev build never raises the notice. Stable and
 * preview shells never load OTA bundles, so the renderer code that calls this
 * only ever runs on prod shells and on web — but legacy shells do not report
 * `buildKind`, so the untagged git-describe shape (`2.26.10.4.1-597-g0f28d663`)
 * is treated as non-prod as well.
 */
export function assessShellSupport(input: ShellSupportInput): ShellSupportVerdict {
  if (input.source === 'web') return { status: 'not-applicable', reason: 'web' };
  if (input.buildKind && input.buildKind !== 'prod') {
    return { status: 'not-applicable', reason: 'non-prod' };
  }

  const shell = parseCalVer(input.shellVersion);
  if (!shell) return { status: 'not-applicable', reason: 'unparseable-shell' };
  if (shell.distance > 0 || shell.sha) return { status: 'not-applicable', reason: 'untagged-shell' };

  const latest = parseCalVer(input.latestShellVersion);
  if (!latest || latest.distance > 0 || latest.sha) {
    return { status: 'not-applicable', reason: 'unparseable-latest' };
  }

  const shellVersion = shell.raw;
  const latestShellVersion = latest.raw;
  const daysBehind = Math.max(
    0,
    Math.round((calverDate(latest).getTime() - calverDate(shell).getTime()) / DAY_MS),
  );

  // The newest published shell is always inside the window, whatever the
  // floor says — there is nothing newer for its user to install.
  if (compareCalVer(shell, latest) >= 0) {
    return { status: 'supported', shellVersion, latestShellVersion, daysBehind };
  }

  const floor = parseCalVer(MIN_SUPPORTED_SHELL)!;
  if (compareCalVer(shell, floor) < 0) {
    return { status: 'too-old', shellVersion, latestShellVersion, daysBehind, reason: 'below-floor' };
  }
  if (daysBehind > SUPPORTED_SHELL_WINDOW_DAYS) {
    return { status: 'too-old', shellVersion, latestShellVersion, daysBehind, reason: 'outside-window' };
  }
  return { status: 'supported', shellVersion, latestShellVersion, daysBehind };
}

// ---------------------------------------------------------------------------
// The launch notice
// ---------------------------------------------------------------------------

/** The one action the too-old notice offers, routed by the caller:
 *  - `install`: a downloaded shell update is waiting → relaunch into it.
 *  - `download`: the auto-updater found an update → start its download.
 *  - `retry`: the auto-updater failed recoverably → check again.
 *  - `open-download-page`: nothing the shell can do itself (Linux, shells
 *    before 2.26.8.24.1, disabled or terminally failed) → the download page.
 *  - `null`: work is in flight; the control is display-only. */
export type ShellTooOldAction = 'install' | 'download' | 'retry' | 'open-download-page' | null;

export interface ShellTooOldNotice {
  title: string;
  body: string;
  actionLabel: string;
  action: ShellTooOldAction;
}

export interface ShellAutoUpdateView {
  phase?: string | null;
  recoverable?: boolean;
  progress?: { percent?: number | null } | null;
}

/**
 * What the too-old notice says and offers, given the shell auto-updater's
 * current snapshot (null on shells that predate it). Returns null unless the
 * verdict is `too-old`, so callers can render `notice && <Notice …/>`.
 */
export function deriveShellTooOldNotice(
  verdict: ShellSupportVerdict | null | undefined,
  shellAuto: ShellAutoUpdateView | null | undefined,
): ShellTooOldNotice | null {
  if (!verdict || verdict.status !== 'too-old') return null;

  const title = 'This app is too old for this version of Cowork';
  const body = `App shell ${verdict.shellVersion} is installed; ${verdict.latestShellVersion} is current. `
    + 'Some features are hidden until the app updates.';

  const phase = shellAuto?.phase;
  switch (phase) {
    case 'ready-to-install':
      return { title, body, actionLabel: 'Restart to update', action: 'install' };
    case 'available':
      return { title, body, actionLabel: 'Download update', action: 'download' };
    case 'checking':
      return { title, body, actionLabel: 'Checking for update…', action: null };
    case 'downloading': {
      const pct = shellAuto?.progress?.percent;
      const actionLabel = pct != null ? `Downloading (${Math.round(pct)}%)` : 'Downloading…';
      return { title, body, actionLabel, action: null };
    }
    case 'installing':
      return { title, body, actionLabel: 'Installing…', action: null };
    case 'failed':
      if (shellAuto?.recoverable) return { title, body, actionLabel: 'Retry update', action: 'retry' };
      return { title, body, actionLabel: 'Download the latest app', action: 'open-download-page' };
    default:
      // disabled, idle, complete, or no snapshot at all (a shell older than the
      // auto-updater): the shell will not update itself, so send the user to
      // the installer.
      return { title, body, actionLabel: 'Download the latest app', action: 'open-download-page' };
  }
}
