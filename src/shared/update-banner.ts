// Which update banner, if any, the user sees. Rendered from the coordinator
// state (update-coordinator.ts), so the sidebar and Settings → Updates show
// the same banner with the same action and cannot disagree. The coordinator
// already decided the shell-first ladder (a pending shell relaunch also
// applies any OTA at boot, so it owns the slot) and the one action; this
// module turns that into copy.
//
// Copy is layer-agnostic: "Update ready — Restart now" whether the
// restart is a renderer reload or an app relaunch. The one exception is the
// manual installer fallback, which is a genuinely different action
// ("Download") and keeps its own words.

import type { UpdateAction, UpdateCoordinatorState } from './update-coordinator';
import { serverLabel } from './update-coordinator';

export { SHELL_AUTO_BANNER_PHASES, CHECK_ONLY_FAILURE_CODES } from './update-banner-rules';

export type UpdateBannerKind = 'shell-auto' | 'shell-manual' | 'ota-ready' | 'ota-error';
export type UpdateBannerTone = 'ready' | 'progress' | 'error';
/** Which coordinator action the banner's click performs. `null` while work is
 *  in flight (download/install), where the banner is display-only. */
export type UpdateBannerAction = UpdateAction;

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

export interface UpdateBannerOptions {
  /** The manual installer notice the user dismissed, by version. Settings
   *  passes nothing: it always reflects the true state. */
  dismissedManualVersion?: string | null;
  /** The installer is a .deb (Linux). */
  debInstaller?: boolean;
}

/** Why the last restart did not finish, for the banner hint and the Settings
 *  card. Shared so the two surfaces cannot drift. */
export function abortedInstallHint(message?: string): string {
  const reason = message?.trim();
  return `${reason ? `Last restart attempt failed: ${reason}.` : 'The last restart attempt failed.'} The update is still downloaded. Try again to restart.`;
}

/** The install step for a Debian package. Shared so the sidebar hint and the
 *  Settings card cannot drift. Narrowed by version because the alias URL saves
 *  under a versioned Content-Disposition name, so an unbounded glob would hand
 *  apt every release still sitting in the download directory. */
export function debInstallStep(version?: string): string {
  return `run sudo apt install ./mindshub-cowork-${version ?? ''}*.deb from the directory you downloaded it to`;
}

const base = { disabled: false, dismissible: false } as const;

/** The one banner to show, or null when nothing is pending. */
export function deriveUpdateBanner(
  state: UpdateCoordinatorState | null | undefined,
  options: UpdateBannerOptions = {},
): UpdateBanner | null {
  if (!state) return null;
  const { shell, ui, server, action } = state;

  // In flight: display only. The boot overlay owns an OTA apply, so only the
  // shell's own download and install show here.
  if (shell.status === 'downloading' && !shell.manual) {
    const pct = shell.progress?.percent;
    const title = pct != null ? `Downloading update (${Math.round(pct)}%)` : 'Downloading update…';
    return { kind: 'shell-auto', tone: 'progress', title, actionLabel: null, action: null, disabled: true, dismissible: false, version: shell.version };
  }
  if (shell.status === 'applying') {
    return { kind: 'shell-auto', tone: 'progress', title: 'Installing update…', actionLabel: null, action: null, disabled: true, dismissible: false, version: shell.version };
  }

  switch (action) {
    case 'relaunch':
      // An install that never left the process (the sidecar stop or the
      // installer failed) re-arms with its reason on the snapshot. Say so, or
      // the pill flips from "Installing…" back to "Update ready" with no
      // explanation (ENG-3291).
      if (shell.errorCode) {
        return {
          kind: 'shell-auto', tone: 'error', title: 'Last restart attempt failed', actionLabel: 'Try again', action, ...base, version: shell.version,
          hint: abortedInstallHint(shell.errorMessage),
        };
      }
      // Only auto mode enables `autoInstallOnAppQuit`; in manual mode the pill
      // is the only way to install.
      return {
        kind: 'shell-auto', tone: 'ready', title: 'Update ready', actionLabel: 'Restart now', action, ...base, version: shell.version,
        hint: shell.mode === 'auto'
          ? `The new version${shell.version ? ` (${shell.version})` : ''} is downloaded. Restart now to use it, or it installs on its own the next time you quit the app.`
          : undefined,
      };
    case 'download':
      return { kind: 'shell-auto', tone: 'ready', title: 'New version available', actionLabel: 'Download', action, ...base, version: shell.version };
    case 'retry':
      return { kind: 'shell-auto', tone: 'error', title: 'Update failed', actionLabel: 'Retry', action, ...base, version: shell.version };
    case 'open-download-page':
      if (shell.manual) {
        if (options.dismissedManualVersion && options.dismissedManualVersion === shell.version) return null;
        return {
          kind: 'shell-manual',
          tone: 'ready',
          title: `New version available${shell.version ? ` (${shell.version})` : ''}`,
          actionLabel: 'Download',
          action,
          disabled: false,
          dismissible: true,
          version: shell.version,
          debInstaller: !!options.debInstaller,
        };
      }
      // A terminal auto-update failure: the installer is the way forward.
      return { kind: 'shell-auto', tone: 'error', title: 'Update failed', actionLabel: 'Download', action, ...base, version: shell.version };
    case 'reload': {
      const version = ui.status !== 'idle' && ui.version ? ui.version : serverLabel(server);
      if (ui.status === 'failed') {
        return { kind: 'ota-error', tone: 'error', title: `Update failed${version ? ` (${version})` : ''}`, actionLabel: 'Try again', action, ...base, version };
      }
      return {
        kind: 'ota-ready',
        tone: 'ready',
        title: 'Update ready',
        actionLabel: 'Restart now',
        action,
        ...base,
        version,
        hint: `Restarts the app to finish updating${version ? ` to ${version}` : ''}. It also applies on its own the next time you open the app.`,
      };
    }
    default:
      return null;
  }
}
