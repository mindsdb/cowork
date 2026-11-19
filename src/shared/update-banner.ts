// Which update banner, if any, the user sees. Collapses the three update
// mechanisms (see docs/update-behavior.md) into one banner, so the sidebar and
// Settings render from the same decision:
//   - OTA (UI + server)   → applied by a renderer *reload*   (updateStatus)
//   - shell auto-update   → applied by an app *relaunch*     (shellAutoUpdate)
//   - shell manual notice → hand-downloaded installer, prod fallback (shellUpdate)
//
// Priority is SHELL-FIRST: a shell relaunch also auto-applies any pending
// UI/server OTA at boot, so whenever a shell update is pending it owns the slot
// and the weaker OTA "Restart" (reload-only) is suppressed. "Pending" excludes a
// shell failure with no known target (see shellAutoOwnsBanner) — it must not hide
// a valid OTA, so it drops to the BOTTOM of the ladder rather than the top:
//   shell-owned  ►  shell-manual  ►  OTA  ►  targetless shell failure  ►  none
// Ranking it last (not dropping it) keeps its Retry/Download affordance alive
// even after a failed retry check clears the target. shellAuto and shellManual
// are mutually exclusive at the source, but the ordering is safe if they overlap.

import { sourceTranslator, type Translate } from './i18n/translate';
import appSource from './i18n/locales/en/app.json';

/* The banner copy lives in the `app` catalog under `updateBanner`. The
   renderer passes its `app` translator; without one the copy is English. */
const english: Translate = sourceTranslator(appSource);
const withVersion = (version: string | undefined) => ({ version: version ?? '', hasVersion: version ? 'yes' : 'no' });

/** Shell auto-updater phases that can own a banner. Passive phases
 *  (disabled/idle/checking/complete) surface nothing, leaving the slot for an
 *  OTA or manual banner. `failed` is conditional — see shellAutoOwnsBanner. */
export const SHELL_AUTO_BANNER_PHASES = [
  'available',
  'downloading',
  'ready-to-install',
  'installing',
  'failed',
] as const;

/** Does this shell-auto snapshot warrant owning the top (shell-first) banner slot?
 *
 *  A `failed` phase owns the top slot only when `targetVersion` proves an update
 *  was actually found (set by UPDATE_FOUND / DOWNLOAD_COMPLETE and retained
 *  through a download/install failure). A failure with no target — a rejected
 *  checkForUpdates(), or a *retry* whose CHECK_REQUESTED cleared the target and
 *  then failed — must not outrank a valid OTA "Restart", so it does not own the
 *  top slot. It is still rendered at the BOTTOM of deriveUpdateBanner's ladder,
 *  so its Retry/Download affordance survives a failed retry check. */
/** Shell failure codes that describe a check which produced no answer — the
 *  updater stalled, and no update was found or lost. They exist so the next
 *  scheduled check can run; there is nothing for the user to retry, so they
 *  raise no banner. */
export const CHECK_ONLY_FAILURE_CODES = ['check-stalled'] as const;

function isSilentCheckFailure(shellAuto: NonNullable<UpdateBannerInput['shellAuto']>): boolean {
  return shellAuto.phase === 'failed'
    && !shellAuto.targetVersion
    && (CHECK_ONLY_FAILURE_CODES as readonly string[]).includes(shellAuto.errorCode ?? '');
}

export function shellAutoOwnsBanner(
  shellAuto: NonNullable<UpdateBannerInput['shellAuto']>,
): boolean {
  const phase = shellAuto.phase;
  if (!phase || !(SHELL_AUTO_BANNER_PHASES as readonly string[]).includes(phase)) return false;
  if (phase === 'failed') return !!shellAuto.targetVersion;
  return true;
}

export interface UpdateBannerInput {
  /** OTA (UI + server) status pushed from main. `available` = ready to apply on
   *  a renderer reload; `error` = a prior apply failed and offers a retry. Any
   *  other phase surfaces no banner (the app shows a full-screen overlay). */
  ota?: { phase?: string | null; version?: string } | null;
  /** electron-updater snapshot, or null when not packaged / not subscribed. */
  shellAuto?: {
    phase?: string | null;
    recoverable?: boolean;
    version?: string;
    /** The update this snapshot is heading to. Present once an update is found;
     *  absent on a check-only failure — the discriminator in shellAutoOwnsBanner. */
    targetVersion?: string;
    /** Classified failure code; a check-only code suppresses the banner. On a
     *  `ready-to-install` snapshot it is the reason the last install attempt
     *  was aborted (ENG-3291), and the banner says so. */
    errorCode?: string;
    errorMessage?: string;
    progress?: { percent?: number | null } | null;
    /** `auto` installs a downloaded update on quit; `manual` never does. */
    mode?: string;
  } | null;
  /** Prod-only manual installer notice, already filtered for per-version
   *  dismissal by the caller (a dismissed notice must arrive here as null). */
  shellManual?: { version?: string; debInstaller?: boolean } | null;
}

export type UpdateBannerKind = 'shell-auto' | 'shell-manual' | 'ota-ready' | 'ota-error';
export type UpdateBannerTone = 'ready' | 'progress' | 'error';
/** Which caller-supplied handler the banner's click invokes. `null` while work
 *  is in flight (download/install), where the banner is display-only. */
export type UpdateBannerAction = 'shell-auto' | 'download-installer' | 'apply-ota' | null;

export interface UpdateBanner {
  kind: UpdateBannerKind;
  tone: UpdateBannerTone;
  /** Primary line, already including any progress percentage. */
  title: string;
  /** Trailing action pill label, or null when the banner is in-flight/passive. */
  actionLabel: string | null;
  action: UpdateBannerAction;
  /** True while a download/install is running — the control is non-interactive. */
  disabled: boolean;
  /** Only the manual installer notice can be dismissed (per-version). */
  dismissible: boolean;
  /** Tooltip naming how the update lands if the pill is never clicked
   *  (ENG-2764). Absent when clicking is the only way. */
  hint?: string;
  version?: string;
  /** Manual notice only: the installer is a Debian package, so the copy names
   *  the install command instead of telling the user to open it. */
  debInstaller?: boolean;
}

function shellAutoBanner(shellAuto: NonNullable<UpdateBannerInput['shellAuto']>, t: Translate): UpdateBanner {
  const phase = shellAuto.phase;
  const version = shellAuto.version;
  switch (phase) {
    case 'downloading': {
      const pct = shellAuto.progress?.percent;
      const title = pct != null ? t('updateBanner.downloadingPercent', { percent: Math.round(pct) }) : t('updateBanner.downloading');
      return { kind: 'shell-auto', tone: 'progress', title, actionLabel: null, action: null, disabled: true, dismissible: false, version };
    }
    case 'installing':
      return { kind: 'shell-auto', tone: 'progress', title: t('updateBanner.installing'), actionLabel: null, action: null, disabled: true, dismissible: false, version };
    case 'ready-to-install':
      // An install that never left the process (the sidecar stop or the
      // installer failed) re-arms with its reason on the snapshot. Say so,
      // or the pill flips from "Installing…" back to "Update ready" with no
      // explanation (ENG-3291).
      if (shellAuto.errorCode) {
        return {
          kind: 'shell-auto', tone: 'error', title: t('updateBanner.restartFailed'), actionLabel: t('updateBanner.tryAgain'), action: 'shell-auto', disabled: false, dismissible: false, version,
          hint: abortedInstallHint(shellAuto.errorMessage, t),
        };
      }
      // Only auto mode enables `autoInstallOnAppQuit`; in manual mode the pill
      // is the only way to install.
      return {
        kind: 'shell-auto', tone: 'ready', title: t('updateBanner.ready'), actionLabel: t('updateBanner.restartNow'), action: 'shell-auto', disabled: false, dismissible: false, version,
        hint: shellAuto.mode === 'auto' ? t('updateBanner.readyAutoHint', withVersion(version)) : undefined,
      };
    case 'failed':
      // Recoverable → retry via the auto-updater; terminal → manual installer
      // link. The single `shell-auto` handler routes both.
      return { kind: 'shell-auto', tone: 'error', title: t('updateBanner.appUpdateFailed'), actionLabel: shellAuto.recoverable ? t('updateBanner.retry') : t('updateBanner.download'), action: 'shell-auto', disabled: false, dismissible: false, version };
    case 'available':
    default:
      return { kind: 'shell-auto', tone: 'ready', title: t('updateBanner.appVersionAvailable'), actionLabel: t('updateBanner.download'), action: 'shell-auto', disabled: false, dismissible: false, version };
  }
}

/** Why the last restart did not finish, for the banner hint and the Settings
 *  card. Shared so the two surfaces cannot drift. */
export function abortedInstallHint(message?: string, t: Translate = english): string {
  const reason = message?.trim();
  return reason ? t('updateBanner.abortedHintReason', { reason }) : t('updateBanner.abortedHint');
}

/** The install step for a Debian package. Shared so the sidebar hint and the
 *  Settings card cannot drift. Narrowed by version because the alias URL saves
 *  under a versioned Content-Disposition name, so an unbounded glob would hand
 *  apt every release still sitting in the download directory. */
export function debInstallStep(version?: string, t: Translate = english): string {
  return t('updateBanner.debInstallStep', { command: `sudo apt install ./mindshub-cowork-${version ?? ''}*.deb` });
}

/** True once main reports a restart underway: an OTA apply downloading or
 *  reloading the window, or the shell installer taking over. Surfaces that
 *  started the restart (the Settings modal) close on this, because the apply
 *  and install requests only resolve once the window is already reloading or
 *  the app is quitting. It reads main's pushed state rather than the click, so
 *  a restart the person cancels in the running-tasks dialog closes nothing. */
export function restartUnderway(input: Pick<UpdateBannerInput, 'ota' | 'shellAuto'>): boolean {
  const ota = input.ota?.phase;
  return ota === 'downloading' || ota === 'reloading' || input.shellAuto?.phase === 'installing';
}

/** The one banner to show, or null when nothing is pending. Shell-first: a
 *  pending shell update (auto or manual) always owns the slot over OTA. */
export function deriveUpdateBanner(input: UpdateBannerInput, t: Translate = english): UpdateBanner | null {
  const shellAuto = input.shellAuto;
  if (shellAuto && shellAutoOwnsBanner(shellAuto)) {
    return shellAutoBanner(shellAuto, t);
  }

  const shellManual = input.shellManual;
  if (shellManual) {
    return {
      kind: 'shell-manual',
      tone: 'ready',
      title: t('updateBanner.newVersion', withVersion(shellManual.version)),
      actionLabel: t('updateBanner.download'),
      action: 'download-installer',
      disabled: false,
      dismissible: true,
      version: shellManual.version,
      debInstaller: !!shellManual.debInstaller,
    };
  }

  const otaPhase = input.ota?.phase;
  const otaVersion = input.ota?.version;
  if (otaPhase === 'available') {
    return {
      kind: 'ota-ready',
      tone: 'ready',
      title: t('updateBanner.readyVersion', withVersion(otaVersion)),
      actionLabel: t('updateBanner.restart'),
      action: 'apply-ota',
      disabled: false,
      dismissible: false,
      version: otaVersion,
      hint: t('updateBanner.otaHint', withVersion(otaVersion)),
    };
  }
  if (otaPhase === 'error') {
    return {
      kind: 'ota-error',
      tone: 'error',
      title: t('updateBanner.otaFailed', withVersion(otaVersion)),
      actionLabel: t('updateBanner.tryAgain'),
      action: 'apply-ota',
      disabled: false,
      dismissible: false,
      version: otaVersion,
    };
  }

  // Bottom of the ladder: a shell failure with no known target (a failed retry
  // check that cleared the target, or a check-only outage). It never outranks
  // OTA/manual above, but is shown here so Retry/Download survives.
  if (shellAuto?.phase === 'failed' && !isSilentCheckFailure(shellAuto)) {
    return shellAutoBanner(shellAuto, t);
  }

  return null;
}
