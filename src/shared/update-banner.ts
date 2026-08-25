// Single source of truth for "which update banner, if any, does the user see?"
//
// The app updates three independently-versioned pieces through three
// mechanisms (see docs/update-behavior.md):
//   - OTA (UI + server)   → applied by a renderer *reload*      (updateStatus)
//   - shell auto-update   → applied by an app *relaunch*        (shellAutoUpdate)
//   - shell manual notice → hand-downloaded installer, prod-only fallback (shellUpdate)
//
// Historically each surfaced its own sidebar block with only pairwise guards,
// so an OTA update and a shell auto-update — which poll together — stacked into
// two banners ("Restart" + "Download"), and an OTA reload left the main-process
// shell banner behind ("I restarted and it's still there"). This function makes
// exactly one banner (or none) authoritative, so both the sidebar and Settings
// render from the same decision.
//
// Priority is SHELL-FIRST. A shell relaunch is the superset action: on relaunch
// the boot check auto-applies any pending UI/server OTA, so whenever a shell
// update is pending its restart resolves everything and the weaker OTA "Restart"
// (reload-only) must never compete with it. (This already held for the manual
// notice, which suppressed the OTA banner; it now holds for the auto-updater
// too.) shellAuto and shellManual are mutually exclusive at the source — the
// manual notice is pushed only when auto-update is the disabled/failed fallback
// — but the ordering here is safe even if that ever overlaps.

/** Shell auto-updater phases that own a user-visible banner. Passive phases
 *  (disabled/idle/checking/complete) surface nothing here, so an OTA or manual
 *  banner can take the slot. Kept in sync with shellAutoUpdateIsActive() in
 *  update-logic.ts, which additionally excludes the failed phase (a failed
 *  auto-update still warrants a banner, but is not "in flight"). */
export const SHELL_AUTO_BANNER_PHASES = [
  'available',
  'downloading',
  'ready-to-install',
  'installing',
  'failed',
] as const;

export interface UpdateBannerInput {
  /** OTA (UI + server) status pushed from main. `available` = ready to apply on
   *  a renderer reload; `error` = a prior apply failed and offers a retry. Any
   *  other phase (downloading/reloading/null) surfaces no banner — the app shows
   *  the full-screen overlay for those. */
  ota?: { phase?: string | null; version?: string } | null;
  /** electron-updater snapshot, or null when not packaged / not subscribed. */
  shellAuto?: {
    phase?: string | null;
    recoverable?: boolean;
    version?: string;
    progress?: { percent?: number | null } | null;
  } | null;
  /** Prod-only manual installer notice, already filtered for per-version
   *  dismissal by the caller (a dismissed notice must arrive here as null). */
  shellManual?: { version?: string } | null;
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
  version?: string;
}

function shellAutoBanner(shellAuto: NonNullable<UpdateBannerInput['shellAuto']>): UpdateBanner {
  const phase = shellAuto.phase;
  const version = shellAuto.version;
  switch (phase) {
    case 'downloading': {
      const pct = shellAuto.progress?.percent;
      const title = pct != null ? `Downloading update (${Math.round(pct)}%)` : 'Downloading update…';
      return { kind: 'shell-auto', tone: 'progress', title, actionLabel: null, action: null, disabled: true, dismissible: false, version };
    }
    case 'installing':
      return { kind: 'shell-auto', tone: 'progress', title: 'Installing update…', actionLabel: null, action: null, disabled: true, dismissible: false, version };
    case 'ready-to-install':
      return { kind: 'shell-auto', tone: 'ready', title: 'App update ready', actionLabel: 'Restart', action: 'shell-auto', disabled: false, dismissible: false, version };
    case 'failed':
      // A recoverable failure retries through the auto-updater; a terminal one
      // falls back to the manual installer link. Either way the single
      // `shell-auto` handler routes it (see handleShellAutoUpdateAction).
      return { kind: 'shell-auto', tone: 'error', title: 'App update failed', actionLabel: shellAuto.recoverable ? 'Retry' : 'Download', action: 'shell-auto', disabled: false, dismissible: false, version };
    case 'available':
    default:
      return { kind: 'shell-auto', tone: 'ready', title: 'New app version available', actionLabel: 'Download', action: 'shell-auto', disabled: false, dismissible: false, version };
  }
}

/** The one banner to show, or null when nothing is pending. Shell-first: a
 *  pending shell update (auto or manual) always owns the slot over OTA. */
export function deriveUpdateBanner(input: UpdateBannerInput): UpdateBanner | null {
  const shellAuto = input.shellAuto;
  if (shellAuto?.phase && (SHELL_AUTO_BANNER_PHASES as readonly string[]).includes(shellAuto.phase)) {
    return shellAutoBanner(shellAuto);
  }

  const shellManual = input.shellManual;
  if (shellManual) {
    return {
      kind: 'shell-manual',
      tone: 'ready',
      title: `New version available${shellManual.version ? ` (${shellManual.version})` : ''}`,
      actionLabel: 'Download',
      action: 'download-installer',
      disabled: false,
      dismissible: true,
      version: shellManual.version,
    };
  }

  const otaPhase = input.ota?.phase;
  const otaVersion = input.ota?.version;
  if (otaPhase === 'available') {
    return {
      kind: 'ota-ready',
      tone: 'ready',
      title: `Update ready${otaVersion ? ` (${otaVersion})` : ''}`,
      actionLabel: 'Restart',
      action: 'apply-ota',
      disabled: false,
      dismissible: false,
      version: otaVersion,
    };
  }
  if (otaPhase === 'error') {
    return {
      kind: 'ota-error',
      tone: 'error',
      title: `Update failed${otaVersion ? ` (${otaVersion})` : ''}`,
      actionLabel: 'Try again',
      action: 'apply-ota',
      disabled: false,
      dismissible: false,
      version: otaVersion,
    };
  }

  return null;
}
