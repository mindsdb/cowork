// One state for the three update mechanisms, so every surface reads the same
// answer to "is an update pending, and what does one click do about it".
//
// The three transports stay independent (docs/update-behavior.md). This module
// only aggregates what they report: the shell auto-updater's snapshot
// (`SHELL_UPDATE_STATUS`), the OTA status pushes (`UI_UPDATE_STATUS`), the
// server updater's progress (`SERVER_UPDATE_STATUS`) and the prod-only manual
// installer notice. Main holds one instance, fed by those channels, and pushes
// the derived state on `UPDATE_STATE`. A newer OTA renderer on an older shell
// runs the same reducer over the old channels (platform/host.ts), which is why
// it lives in `shared` and why every input is a plain serializable object.
//
// Pure, like shell-update-state.ts: `coordinateUpdates(input)` is a function
// of its input and nothing else.

import { CHECK_ONLY_FAILURE_CODES, SHELL_AUTO_BANNER_PHASES } from './update-banner-rules';

export type ShellPhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready-to-install'
  | 'installing'
  | 'complete'
  | 'failed';

/** The shell auto-updater snapshot as the renderer sees it. Structurally the
 *  main-process `ShellUpdateSnapshot`; older shells omit the newer fields. */
export interface ShellSnapshot {
  phase: ShellPhase;
  mode: 'auto' | 'manual';
  channel: 'prod' | 'stable' | 'preview';
  currentVersion: string;
  targetVersion?: string;
  progress?: { transferred?: number; total?: number; percent?: number | null; bytesPerSecond?: number } | null;
  recoverable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  disabledReason?: string;
  trigger?: string;
  refreshing?: boolean;
  lastInstall?: { applied: boolean; version: string; expected: string; source?: 'user' | 'boot' };
  installSource?: 'user' | 'boot';
  bytesTransferred?: boolean;
}

/** What main pushes on `UI_UPDATE_STATUS`. `shell-available` is routed to
 *  `shellManual` by the feeder and never reaches the reducer as an OTA phase. */
export interface OtaStatus {
  phase: 'idle' | 'available' | 'downloading' | 'reloading' | 'rolled-back' | 'error' | 'shell-available';
  version?: string;
  /** Set on `available` by newer shells: which layers the check offered. Older
   *  shells only set `serverUpdate`, so a UI update is inferred from `version`. */
  uiUpdate?: boolean;
  uiVersion?: string;
  serverUpdate?: boolean;
  serverVersion?: string;
  serverComponent?: 'cowork-server' | 'anton-agent';
  currentVersion?: string;
  downloadUrl?: string;
}

/** What main pushes on `SERVER_UPDATE_STATUS`. */
export interface ServerStatus {
  phase: 'idle' | 'downloading' | 'restarting' | 'error';
  to?: string;
  error?: string;
  critical?: boolean;
}

/** The prod-only manual installer notice (ENG-849). */
export interface ShellManualNotice {
  version: string;
  currentVersion?: string;
  downloadUrl?: string | null;
}

export interface UpdateCoordinatorInput {
  shell: ShellSnapshot | null;
  ota: OtaStatus | null;
  server: ServerStatus | null;
  shellManual: ShellManualNotice | null;
}

export type UpdateLayerStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'failed'
  | 'disabled';

export interface UpdateLayerState {
  status: UpdateLayerStatus;
  /** The version this layer is heading to, when one is known. */
  version?: string;
  error?: string;
}

export interface ShellLayerState extends UpdateLayerState {
  phase: ShellPhase | null;
  mode?: 'auto' | 'manual';
  progress?: { percent: number | null } | null;
  recoverable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** The manual installer notice is what is pending, not the auto-updater. */
  manual: boolean;
  manualDownloadUrl?: string | null;
  /** The raw snapshot, for consumers that read fields the layer state does not
   *  carry (telemetry, the too-old notice). */
  snapshot: ShellSnapshot | null;
}

export type UpdateOverall = 'idle' | 'checking' | 'downloading' | 'ready' | 'applying' | 'failed';

/** What the one call to action does. `relaunch` installs the shell update,
 *  which also applies any pending OTA at the next boot. `reload` applies the
 *  OTA in place. `retry` re-runs a failed shell check or download. `download`
 *  starts a shell download in manual mode. `open-download-page` is the only
 *  action the renderer performs itself. */
export type UpdateAction = 'relaunch' | 'reload' | 'retry' | 'download' | 'open-download-page' | null;

export interface UpdateCoordinatorState {
  ui: UpdateLayerState & { component?: never };
  server: UpdateLayerState & { component?: 'cowork-server' | 'anton-agent' };
  shell: ShellLayerState;
  overall: UpdateOverall;
  pending: { reload: boolean; relaunch: boolean };
  action: UpdateAction;
  /** The version the one banner names, when one is known. */
  version?: string;
  /** Which boot-time apply is in flight, for the loading screen and the
   *  in-app overlay. Null when nothing is being applied. */
  applying: 'downloading' | 'reloading' | 'installing' | null;
  /** The shell failure is a check that produced no answer (`check-stalled`):
   *  nothing to retry, so no banner. */
  silentShellFailure: boolean;
}

export const EMPTY_UPDATE_INPUT: UpdateCoordinatorInput = { shell: null, ota: null, server: null, shellManual: null };

function shellStatus(phase: ShellPhase | null): UpdateLayerStatus {
  switch (phase) {
    case 'checking': return 'checking';
    case 'available': return 'available';
    case 'downloading': return 'downloading';
    case 'ready-to-install': return 'ready';
    case 'installing': return 'applying';
    case 'failed': return 'failed';
    case 'disabled': return 'disabled';
    default: return 'idle';
  }
}

/** Does the auto-updater snapshot own the shell layer? Same rule as the
 *  shell-first banner: a failure counts only with a known target. */
export function shellAutoIsPending(shell: ShellSnapshot | null): boolean {
  if (!shell) return false;
  if (!(SHELL_AUTO_BANNER_PHASES as readonly string[]).includes(shell.phase)) return false;
  if (shell.phase === 'failed') return !!shell.targetVersion;
  return true;
}

function isSilentCheckFailure(shell: ShellSnapshot | null): boolean {
  return !!shell
    && shell.phase === 'failed'
    && !shell.targetVersion
    && (CHECK_ONLY_FAILURE_CODES as readonly string[]).includes(shell.errorCode ?? '');
}

function shellLayer(shell: ShellSnapshot | null, manual: ShellManualNotice | null): ShellLayerState {
  const autoPending = shellAutoIsPending(shell);
  if (!autoPending && manual) {
    return {
      status: 'available',
      version: manual.version,
      phase: shell?.phase ?? null,
      mode: shell?.mode,
      manual: true,
      manualDownloadUrl: manual.downloadUrl ?? null,
      // A failed auto-update keeps its reason beside the manual fallback.
      recoverable: shell?.recoverable,
      errorCode: shell?.errorCode,
      errorMessage: shell?.errorMessage,
      snapshot: shell,
    };
  }
  const phase = shell?.phase ?? null;
  return {
    status: shellStatus(phase),
    version: shell?.targetVersion,
    phase,
    mode: shell?.mode,
    progress: shell?.progress ? { percent: shell.progress.percent ?? null } : null,
    recoverable: shell?.recoverable,
    errorCode: shell?.errorCode,
    errorMessage: shell?.errorMessage,
    error: shell?.phase === 'failed' ? shell.errorMessage ?? shell.errorCode : undefined,
    manual: false,
    snapshot: shell,
  };
}

function otaLayers(ota: OtaStatus | null, server: ServerStatus | null): { ui: UpdateCoordinatorState['ui']; server: UpdateCoordinatorState['server'] } {
  const serverApplying = server?.phase === 'downloading' || server?.phase === 'restarting';
  const serverFailed = server?.phase === 'error';
  const ui: UpdateCoordinatorState['ui'] = { status: 'idle' };
  const srv: UpdateCoordinatorState['server'] = { status: 'idle' };

  if (serverApplying) Object.assign(srv, { status: 'applying', version: server?.to });
  else if (serverFailed) Object.assign(srv, { status: 'failed', error: server?.error });

  switch (ota?.phase) {
    case 'available': {
      const serverPending = !!ota.serverUpdate;
      // Older shells name only the server's pending-ness: an `available` that
      // is not a server update is a UI update, with or without a version.
      const uiPending = ota.uiUpdate ?? !serverPending;
      if (uiPending) Object.assign(ui, { status: 'ready', version: ota.uiVersion ?? (serverPending ? undefined : ota.version) });
      if (serverPending && !serverApplying) {
        Object.assign(srv, { status: 'ready', version: ota.serverVersion, component: ota.serverComponent });
      }
      break;
    }
    case 'downloading':
    case 'reloading':
      // The tandem apply: the server updater's busy phases are mirrored onto
      // this status by main (feedServerUpdateStatus), and the reload follows a
      // UI swap or a server-only apply. Both layers read as applying; the
      // window reloads before either needs telling apart.
      ui.status = 'applying';
      ui.version = ota.version;
      if (!serverFailed) srv.status = 'applying';
      break;
    case 'error':
      ui.status = 'failed';
      ui.version = ota.version;
      ui.error = 'apply-failed';
      break;
    case 'rolled-back':
      // The bundle failed its load check and is quarantined; re-applying it
      // is not an option, so this is a failed layer with no action.
      ui.status = 'failed';
      ui.error = 'rolled-back';
      break;
    default:
      break;
  }
  return { ui, server: srv };
}

/** The one derived state. */
export function coordinateUpdates(input: UpdateCoordinatorInput): UpdateCoordinatorState {
  const shell = shellLayer(input.shell, input.shellManual);
  const { ui, server } = otaLayers(input.ota, input.server);
  const silentShellFailure = isSilentCheckFailure(input.shell);

  const applying: UpdateCoordinatorState['applying'] = shell.phase === 'installing'
    ? 'installing'
    : input.ota?.phase === 'downloading' || input.ota?.phase === 'reloading'
      ? input.ota.phase
      : null;

  const relaunch = shell.status === 'ready' && !shell.manual;
  const reload = ui.status === 'ready' || server.status === 'ready';

  // Shell-first, the same ladder deriveUpdateBanner always used: a pending
  // shell update owns the action because its relaunch applies the OTA too. A
  // shell failure with no known target drops below the OTA so a feed outage
  // cannot hide a valid Restart, and raises nothing at all when it was a check
  // that produced no answer.
  let action: UpdateAction = null;
  if (applying || shell.status === 'downloading') {
    action = null;
  } else if (relaunch) {
    action = 'relaunch';
  } else if (!shell.manual && shell.status === 'failed' && shellAutoIsPending(input.shell)) {
    action = shell.recoverable ? 'retry' : 'open-download-page';
  } else if (!shell.manual && shell.status === 'available') {
    action = 'download';
  } else if (shell.manual) {
    action = 'open-download-page';
  } else if (reload || (ui.status === 'failed' && ui.error !== 'rolled-back')) {
    action = 'reload';
  } else if (shell.status === 'failed' && !silentShellFailure) {
    action = shell.recoverable ? 'retry' : 'open-download-page';
  }

  const shellOwns = action === 'relaunch' || action === 'download'
    || ((action === 'retry' || action === 'open-download-page') && !shell.manual);
  const failed = (shell.status === 'failed' && !silentShellFailure && action !== 'reload')
    || ui.status === 'failed'
    || server.status === 'failed';

  const overall: UpdateOverall = applying
    ? 'applying'
    : shell.status === 'downloading'
      ? 'downloading'
      : relaunch || reload || action === 'download' || shell.manual
        ? 'ready'
        : failed
          ? 'failed'
          : shell.status === 'checking'
            ? 'checking'
            : 'idle';

  const version = shellOwns || shell.manual
    ? shell.version
    : ui.status !== 'idle' && ui.version
      ? ui.version
      : server.status !== 'idle'
        ? serverLabel(server)
        : undefined;

  return { ui, server, shell, overall, pending: { reload, relaunch }, action, version, applying, silentShellFailure };
}

/** An anton-only server update shares cowork-server's version number, so the
 *  banner names the component that is changing (ENG-1094). */
export function serverLabel(server: UpdateCoordinatorState['server']): string | undefined {
  if (!server.version) return undefined;
  return server.component === 'anton-agent' ? `${server.component} ${server.version}` : server.version;
}

// ---- a feedable instance ---------------------------------------------------

export interface UpdateCoordinator {
  /** Replace one or more inputs. Listeners run only when the derived state
   *  changed. An OTA `shell-available` push is routed to `shellManual`. */
  feed(partial: Partial<UpdateCoordinatorInput>): UpdateCoordinatorState;
  getInput(): UpdateCoordinatorInput;
  getState(): UpdateCoordinatorState;
  subscribe(listener: (state: UpdateCoordinatorState) => void): () => void;
}

export function createUpdateCoordinator(initial: Partial<UpdateCoordinatorInput> = {}): UpdateCoordinator {
  let input: UpdateCoordinatorInput = { ...EMPTY_UPDATE_INPUT, ...initial };
  let state = coordinateUpdates(input);
  let serialized = JSON.stringify(state);
  const listeners = new Set<(state: UpdateCoordinatorState) => void>();
  return {
    feed(partial) {
      const next = { ...input };
      if ('ota' in partial) {
        const ota = partial.ota ?? null;
        if (ota?.phase === 'shell-available') {
          next.shellManual = ota.version
            ? { version: ota.version, currentVersion: ota.currentVersion, downloadUrl: ota.downloadUrl ?? null }
            : null;
        } else {
          next.ota = ota;
        }
      }
      if ('shell' in partial) next.shell = partial.shell ?? null;
      if ('server' in partial) next.server = partial.server ?? null;
      if ('shellManual' in partial) next.shellManual = partial.shellManual ?? null;
      input = next;
      const nextState = coordinateUpdates(input);
      const nextSerialized = JSON.stringify(nextState);
      if (nextSerialized !== serialized) {
        state = nextState;
        serialized = nextSerialized;
        listeners.forEach((listener) => listener(state));
      }
      return state;
    },
    getInput: () => input,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
