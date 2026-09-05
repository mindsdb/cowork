// Shared banner priority: shell-auto with a target > manual shell > OTA > targetless shell failure.
// A shell relaunch also applies pending OTA at boot. Targetless failures rank last so they retain
// Retry/Download without hiding a valid update. See docs/update-behavior.md.

/**
 * Passive shell phases leave the banner slot available. Failed is conditional on targetVersion
 * below.
 */
export const SHELL_AUTO_BANNER_PHASES = [
  'available',
  'downloading',
  'ready-to-install',
  'installing',
  'failed',
] as const;

/**
 * A failed shell update owns the top slot only with a known target. Check failures (including
 * retries that cleared the target) rank below OTA but retain Retry/Download.
 */
export function shellAutoOwnsBanner(
  shellAuto: NonNullable<UpdateBannerInput['shellAuto']>,
): boolean {
  const phase = shellAuto.phase;
  if (!phase || !(SHELL_AUTO_BANNER_PHASES as readonly string[]).includes(phase)) return false;
  if (phase === 'failed') return !!shellAuto.targetVersion;
  return true;
}

export interface UpdateBannerInput {
  /** OTA available offers reload; error offers retry. Other phases do not show an OTA banner. */
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

  // Keep targetless failure recovery available without outranking OTA or manual updates.
  if (shellAuto?.phase === 'failed') {
    return shellAutoBanner(shellAuto);
  }

  return null;
}
