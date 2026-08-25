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
// check-only shell failure (see shellAutoOwnsBanner), which must not hide a valid
// OTA. shellAuto and shellManual are mutually exclusive at the source, but the
// ordering is safe even if they ever overlap.

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

/** Does this shell-auto snapshot warrant owning the (shell-first) banner slot?
 *
 *  A `failed` phase is only a *pending shell update* when `targetVersion` proves
 *  an update was actually found (set by UPDATE_FOUND / DOWNLOAD_COMPLETE and
 *  retained through a download/install failure). A check-only failure — a
 *  rejected checkForUpdates() — transitions from `checking`, which cleared
 *  `targetVersion`, so it has none; treating it as pending would let a shell
 *  feed outage outrank and hide a valid OTA "Restart". So a targetless `failed`
 *  surfaces no banner and falls through to OTA/manual. */
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
      // Recoverable → retry via the auto-updater; terminal → manual installer
      // link. The single `shell-auto` handler routes both.
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
  if (shellAuto && shellAutoOwnsBanner(shellAuto)) {
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
