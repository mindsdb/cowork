// One state for the three update mechanisms, so every surface reads the same
// answer to "is an update pending, and what does one click do about it".
//
// The three transports stay independent (docs/update-behavior.md). This module
// only aggregates what they report: the shell auto-updater's snapshot, what the
// last OTA check offered, what an OTA apply is doing, the server updater's
// progress, and the prod-only manual installer notice. Main holds one instance
// and pushes the derived state on `UPDATE_STATE`. A newer OTA renderer on an
// older shell runs the same reducer over the old channels (platform/host.ts),
// which is why it lives in `shared` and why every input is a plain
// serializable object.
//
// The OTA has two inputs, not one. `otaOffer` is written only by checks, and
// `otaApply` only by applies, so a check that lands mid-apply cannot replace
// its progress and an apply cannot lose an offer a check made meanwhile: the
// offer waits in its own slot and shows once the apply settles.
//
// Pure, like shell-update-state.ts: `coordinateUpdates(input)` is a function
// of its input and nothing else, and so is every decision helper below.

import { CHECK_ONLY_FAILURE_CODES, SHELL_AUTO_BANNER_PHASES } from './update-banner-rules';
import { compareCalVer, parseCalVer } from './version';

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

/** What main pushes on the legacy `UI_UPDATE_STATUS` channel. It carries an
 *  offer and an apply's progress in one shape; `legacyOtaInput` splits it
 *  into the two inputs below. */
export interface OtaStatus {
  phase: 'idle' | 'available' | 'downloading' | 'reloading' | 'rolled-back' | 'error' | 'shell-available';
  version?: string;
  /** Set on `available` by newer shells: which layers the check offered. Older
   *  shells set only `serverUpdate`, with `version` naming the UI update when
   *  there is one and the server update otherwise (`legacyAvailableOffer`). */
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

/** What OTA checks found and nothing has applied yet, per layer. A layer is
 *  null when no check has offered it, or the last one that answered for it
 *  found nothing. */
export interface OtaOffer {
  ui: { version?: string } | null;
  server: { version?: string; component?: 'cowork-server' | 'anton-agent' } | null;
}

/** What an OTA apply is doing, or how the last one ended. `downloading` and
 *  `reloading` are in flight; `rolled-back` and `error` stay until a later
 *  apply, or an offer for another version, replaces them. */
export interface OtaApply {
  phase: 'downloading' | 'reloading' | 'rolled-back' | 'error';
  version?: string;
}

export interface UpdateCoordinatorInput {
  shell: ShellSnapshot | null;
  otaOffer: OtaOffer | null;
  otaApply: OtaApply | null;
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
  action: UpdateAction;
  /** The version the one banner names, when one is known. */
  version?: string;
  /** Which boot-time apply is in flight, for the loading screen and the
   *  in-app overlay. Null when nothing is being applied. */
  applying: 'downloading' | 'reloading' | 'installing' | null;
  /** The shell failure is a check that produced no answer (`check-stalled`):
   *  nothing to retry, so no banner. */
  silentShellFailure: boolean;
  /** Increases by one on every change of a coordinator instance. A renderer
   *  uses it to drop a state older than one it already has (a mount-time pull
   *  that resolves after a push). Absent from the pure reducer's result and
   *  from shells that predate it. */
  revision?: number;
}

export const EMPTY_UPDATE_INPUT: UpdateCoordinatorInput = { shell: null, otaOffer: null, otaApply: null, server: null, shellManual: null };

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

/** Is the apply status one of an apply still in flight? */
export function applyInFlight(apply: OtaApply | null): boolean {
  return apply?.phase === 'downloading' || apply?.phase === 'reloading';
}

/** Order two component versions. CalVer when both parse (by date, then
 *  same-day sequence, then commit distance; see version.ts), and otherwise
 *  only equality is known. */
function compareVersions(a: string, b: string): number | null {
  if (a === b) return 0;
  const pa = parseCalVer(a);
  const pb = parseCalVer(b);
  return pa && pb ? compareCalVer(pa, pb) : null;
}

/** Is `candidate` a strictly newer version than `than`? Unordered versions
 *  that differ count as newer, so an offer naming something else still wins
 *  as it always did. */
export function isNewerVersion(candidate: string | undefined, than: string | undefined): boolean {
  if (!candidate) return false;
  if (!than) return true;
  const order = compareVersions(candidate, than);
  return order === null ? candidate !== than : order > 0;
}

/** Does `version` reach `target`: the same version or a newer one? An
 *  unversioned target is reached by anything; an unversioned `version` only
 *  reaches an unversioned target. Two versions that compare equal but are
 *  spelled differently (a PEP 440 rc suffix the CalVer parse ignores) count
 *  as reached: the next check re-offers anything newer. */
export function versionReaches(version: string | undefined, target: string | undefined): boolean {
  if (target === undefined) return true;
  if (version === undefined) return false;
  const order = compareVersions(version, target);
  return order === null ? version === target : order >= 0;
}

/** The version the OTA layers are heading to, from the offer alone: the UI's
 *  when one is offered, the server's label otherwise. Progress and failures of
 *  an OTA apply are named by this, never by the coordinator's banner version,
 *  which is the shell installer's whenever a manual notice exists. */
export function otaOfferVersion(offer: OtaOffer | null): string | undefined {
  if (offer?.ui?.version) return offer.ui.version;
  if (offer?.server) return serverLabel({ status: 'ready', version: offer.server.version, component: offer.server.component });
  return undefined;
}

function otaLayers(
  offer: OtaOffer | null,
  apply: OtaApply | null,
  server: ServerStatus | null,
): { ui: UpdateCoordinatorState['ui']; server: UpdateCoordinatorState['server'] } {
  const serverApplying = server?.phase === 'downloading' || server?.phase === 'restarting';
  const serverFailed = server?.phase === 'error';
  const ui: UpdateCoordinatorState['ui'] = { status: 'idle' };
  const srv: UpdateCoordinatorState['server'] = { status: 'idle' };

  if (serverApplying) Object.assign(srv, { status: 'applying', version: server?.to });
  else if (serverFailed) Object.assign(srv, { status: 'failed', error: server?.error });

  // What the checks offered. A server update the updater is installing right
  // now reads as applying, not as an offer.
  if (offer?.ui) Object.assign(ui, { status: 'ready', version: offer.ui.version });
  if (offer?.server && !serverApplying) {
    Object.assign(srv, { status: 'ready', version: offer.server.version, component: offer.server.component });
  }

  if (applyInFlight(apply)) {
    // The tandem apply: the server updater's busy phases are mirrored onto the
    // apply status by main (feedServerUpdateStatus), and the reload follows a
    // UI swap or a server-only apply. Both layers read as applying; the
    // window reloads before either needs telling apart.
    Object.assign(ui, { status: 'applying', version: apply?.version, error: undefined });
    if (!serverFailed) srv.status = 'applying';
  } else if (apply?.phase === 'error' || apply?.phase === 'rolled-back') {
    // How the last apply ended, unless a check has since offered a newer UI:
    // that offer is the newer news, and its Restart is the retry. An offer
    // for the same version or an older one does not hide the failure (the
    // apply re-reads the manifest, so it can fail on a release newer than the
    // one the check offered).
    const newerOffer = isNewerVersion(offer?.ui?.version, apply.version);
    if (!newerOffer) {
      // A rolled-back bundle failed its load check and is quarantined;
      // re-applying it is not an option, so that failure has no action.
      Object.assign(ui, apply.phase === 'error'
        ? { status: 'failed', version: apply.version, error: 'apply-failed' }
        : { status: 'failed', version: apply.version, error: 'rolled-back' });
    }
  }
  return { ui, server: srv };
}

/** The one derived state. */
export function coordinateUpdates(input: UpdateCoordinatorInput): UpdateCoordinatorState {
  const shell = shellLayer(input.shell, input.shellManual);
  const { ui, server } = otaLayers(input.otaOffer, input.otaApply, input.server);
  const silentShellFailure = isSilentCheckFailure(input.shell);

  const applying: UpdateCoordinatorState['applying'] = shell.phase === 'installing'
    ? 'installing'
    : applyInFlight(input.otaApply)
      ? input.otaApply!.phase as 'downloading' | 'reloading'
      : null;

  const relaunch = relaunchPending(shell);
  const reload = reloadPending(ui, server);

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
  } else if (reload) {
    action = 'reload';
  } else if (shell.status === 'failed' && !silentShellFailure) {
    action = shell.recoverable ? 'retry' : 'open-download-page';
  }

  const shellOwns = action === 'relaunch' || action === 'download'
    || ((action === 'retry' || action === 'open-download-page') && !shell.manual);

  const version = shellOwns || shell.manual
    ? shell.version
    : ui.status !== 'idle' && ui.version
      ? ui.version
      : server.status !== 'idle'
        ? serverLabel(server)
        : undefined;

  return { ui, server, shell, action, version, applying, silentShellFailure };
}

/** A shell download is ready to install. */
function relaunchPending(shell: ShellLayerState): boolean {
  return shell.status === 'ready' && !shell.manual;
}

/** An OTA reload would apply something: an offered UI or server update, or a
 *  retry of a failed apply (not of a rolled-back bundle). */
function reloadPending(ui: UpdateCoordinatorState['ui'], server: UpdateCoordinatorState['server']): boolean {
  return ui.status === 'ready'
    || server.status === 'ready'
    || (ui.status === 'failed' && ui.error !== 'rolled-back');
}

/** An anton-only server update shares cowork-server's version number, so the
 *  banner names the component that is changing (ENG-1094). */
export function serverLabel(server: UpdateCoordinatorState['server']): string | undefined {
  if (!server.version) return undefined;
  return server.component === 'anton-agent' ? `${server.component} ${server.version}` : server.version;
}

// ---- what a click runs ------------------------------------------------------

/** What main (or the old-shell path) runs for a click. */
export type ApplyStep = 'relaunch' | 'reload' | 'retry' | 'download';

function isApplyStep(action: unknown): action is ApplyStep {
  return action === 'relaunch' || action === 'reload' || action === 'retry' || action === 'download';
}

/** Is `step` still something the current state offers? The banner can lag
 *  main by a push, so a click is checked against the state it lands on. */
function stepStillOffered(state: UpdateCoordinatorState, step: ApplyStep): boolean {
  if (state.applying) return false;
  switch (step) {
    case 'relaunch':
      return relaunchPending(state.shell);
    case 'reload':
      // Also behind a dismissed manual installer notice, which outranks the
      // reload in the ladder but leaves it pending.
      return reloadPending(state.ui, state.server);
    case 'retry':
      // Behind a manual notice the layer reads `available`, but a failed
      // auto-update it stands in for can still be retried.
      return (state.shell.status === 'failed' || (state.shell.manual && state.shell.phase === 'failed'))
        && state.shell.recoverable === true;
    case 'download':
      return state.shell.status === 'available' && !state.shell.manual;
  }
}

/** The step a click runs, decided once for main and the old-shell path alike.
 *  The click names the action it rendered; it runs only if the current state
 *  still offers it, and is otherwise `'stale'`, with no side effect, so the
 *  renderer re-renders from the fresh state. A relaunch therefore never runs
 *  for a Download or Retry click. A renderer that names no action (older than
 *  this contract) gets whatever the state offers now. `open-download-page` is
 *  the renderer's own and runs nothing here. */
export function resolveApplyAction(state: UpdateCoordinatorState, clicked?: unknown): ApplyStep | 'stale' | null {
  if (clicked === undefined) return isApplyStep(state.action) ? state.action : null;
  if (clicked === null || clicked === 'open-download-page') return null;
  if (!isApplyStep(clicked)) return 'stale';
  return stepStillOffered(state, clicked) ? clicked : 'stale';
}

// ---- what checks and applies do to the offer ---------------------------------

/** What one OTA check reported, per channel. A channel that is absent was not
 *  checked (the manifest host was unreachable, or this pass is applying it),
 *  and one with `error` could not be checked: either way its offer stands. A
 *  channel that answered replaces its layer's offer, clearing it when it found
 *  nothing. */
export interface OtaCheck {
  ui?: { updateAvailable: boolean; newVersion?: string; error?: boolean };
  server?: { updateAvailable: boolean; latestVersion?: string; component?: 'cowork-server' | 'anton-agent'; error?: boolean };
}

function normalizeOffer(offer: OtaOffer): OtaOffer | null {
  return offer.ui || offer.server ? offer : null;
}

/** The offer after a check: each channel that answered decides its own layer,
 *  and a channel that errored or was not checked leaves it as it was. */
export function offerAfterCheck(prev: OtaOffer | null, check: OtaCheck): OtaOffer | null {
  const next: OtaOffer = { ui: prev?.ui ?? null, server: prev?.server ?? null };
  if (check.ui && !check.ui.error) {
    next.ui = check.ui.updateAvailable ? { version: check.ui.newVersion } : null;
  }
  if (check.server && !check.server.error) {
    next.server = check.server.updateAvailable
      ? { version: check.server.latestVersion, component: check.server.component }
      : null;
  }
  return normalizeOffer(next);
}

/** What one boot or periodic poll reports to the offer. The UI is not
 *  reported when the manifest host was unreachable (`ui` null). A layer this
 *  pass applies is left to the apply, which clears what lands, so an
 *  auto-applied update is never offered on the way in. A stream repair is
 *  boot-only and never offered (`surfaceServer`). */
export function pollOfferCheck(input: {
  ui: { updateAvailable: boolean; newVersion?: string; error?: boolean } | null;
  server: { updateAvailable: boolean; latestVersion?: string; component?: 'cowork-server' | 'anton-agent'; error?: boolean };
  surfaceServer: boolean;
  applyServer: boolean;
  applyUi: boolean;
}): OtaCheck {
  const check: OtaCheck = {};
  if (input.ui && !input.applyUi) check.ui = input.ui;
  if (!input.applyServer) {
    check.server = { ...input.server, updateAvailable: input.surfaceServer };
  }
  return check;
}

/** How one apply ended, per layer, for the offer it answered. `server` is set
 *  only when a server update landed. `ui` is absent when the apply did not try
 *  the UI (not asked, or held behind a failed server update). */
export interface OtaApplyOutcome {
  server?: { landed: true; version?: string };
  ui?: { result: 'landed' | 'rolled-back' | 'failed' | 'nothing'; version?: string };
}

/** Does the outcome speak for this offered layer? An apply re-reads the
 *  manifest, so it can land a release newer than the one the check offered:
 *  an outcome for the offered version or a newer one covers the offer, and an
 *  offer for a version newer than the outcome is a check made meanwhile, and
 *  stands. */
function outcomeCovers(offered: { version?: string } | null, version: string | undefined): boolean {
  if (!offered) return false;
  return versionReaches(version, offered.version);
}

/** How one apply ended, for the request that ran it. A server update that
 *  landed reloads the window, so the request applied even when the UI beside
 *  it failed (the banner names that failure after the reload). `stale` is an
 *  apply that ran nothing: the server re-check found no server update and the UI
 *  had nothing to apply, so the offer the click answered was already gone.
 *  That clears the offer (offerAfterApply) and is not a failure. */
export type ApplyRunResult = 'applied' | 'failed' | 'stale';

export function applyRunResult(run: { serverTried: boolean; serverOk: boolean; ui?: OtaApplyOutcome['ui'] }): ApplyRunResult {
  if (run.serverTried) return run.serverOk ? 'applied' : 'failed';
  if (run.ui?.result === 'landed' || run.ui?.result === 'rolled-back') return 'applied';
  if (run.ui?.result === 'failed') return 'failed';
  return 'stale';
}

/** The offer after an apply. A layer the apply landed is no longer pending. A
 *  UI that rolled back is quarantined, and the apply status reports it; its
 *  offer goes, or Restart would re-apply the same bundle. A UI the apply found
 *  nothing to apply for was a stale offer. A UI that failed to download is
 *  still pending, and its offer stays for the retry. A layer the apply did not
 *  try, or a newer offer a check made meanwhile, stands. */
export function offerAfterApply(prev: OtaOffer | null, outcome: OtaApplyOutcome): OtaOffer | null {
  if (!prev) return null;
  const next: OtaOffer = { ...prev };
  if (outcome.server?.landed && outcomeCovers(prev.server, outcome.server.version)) next.server = null;
  if (outcome.ui && outcome.ui.result !== 'failed' && outcomeCovers(prev.ui, outcome.ui.version)) next.ui = null;
  return normalizeOffer(next);
}

/** The `available` status for a pending UI and/or server update, on the legacy
 *  channel. Names each layer explicitly; `version` keeps the legacy "whichever
 *  we have" value so older renderers never render a blank banner. */
export function availableStatus(
  ui: { updateAvailable: boolean; newVersion?: string },
  server: { updateAvailable: boolean; latestVersion?: string; component?: 'cowork-server' | 'anton-agent' },
): OtaStatus {
  // An anton-only server update (ENG-1094) shares cowork-server's version,
  // so a bare version number would read as blank/wrong — name the component
  // that's actually changing, by the one rule the banner uses too.
  const label = server.updateAvailable
    ? serverLabel({ status: 'ready', version: server.latestVersion, component: server.component })
    : undefined;
  return {
    phase: 'available',
    version: (ui.updateAvailable ? ui.newVersion : undefined) ?? label,
    uiUpdate: ui.updateAvailable,
    uiVersion: ui.updateAvailable ? ui.newVersion : undefined,
    serverUpdate: server.updateAvailable,
    serverVersion: server.updateAvailable ? server.latestVersion : undefined,
    serverComponent: server.updateAvailable ? server.component : undefined,
  };
}

/** The legacy-channel status for an offer: `available`, or `idle` for none. */
export function legacyOfferStatus(offer: OtaOffer | null): OtaStatus {
  if (!offer) return { phase: 'idle' };
  return availableStatus(
    { updateAvailable: !!offer.ui, newVersion: offer.ui?.version },
    { updateAvailable: !!offer.server, latestVersion: offer.server?.version, component: offer.server?.component },
  );
}

/** The offer an `available` on the legacy channel names. Newer shells say
 *  which layers it covers. Older ones set only `serverUpdate`, and `version`
 *  is the UI's version when a UI update is pending and the server's label
 *  otherwise, so a UI update is pending when there is no server update, or
 *  when `version` names something other than the server update. */
export function legacyAvailableOffer(status: OtaStatus): OtaOffer | null {
  const serverPending = !!status.serverUpdate;
  const server = serverPending
    ? { version: status.serverVersion, component: status.serverComponent }
    : null;
  let uiPending: boolean;
  let uiVersion: string | undefined;
  if (status.uiUpdate !== undefined) {
    uiPending = status.uiUpdate;
    uiVersion = status.uiVersion ?? (serverPending ? undefined : status.version);
  } else if (!serverPending) {
    uiPending = true;
    uiVersion = status.version;
  } else {
    const label = serverLabel({ status: 'ready', version: status.serverVersion, component: status.serverComponent });
    uiPending = status.version !== undefined && status.version !== label;
    uiVersion = uiPending ? status.version : undefined;
  }
  return normalizeOffer({ ui: uiPending ? { version: uiVersion } : null, server });
}

/** Split a legacy-channel status into the inputs it speaks for. */
export function legacyOtaInput(status: OtaStatus | null): Partial<UpdateCoordinatorInput> {
  if (!status) return { otaOffer: null, otaApply: null };
  switch (status.phase) {
    case 'shell-available':
      return {
        shellManual: status.version
          ? { version: status.version, currentVersion: status.currentVersion, downloadUrl: status.downloadUrl ?? null }
          : null,
      };
    case 'available':
      return { otaOffer: legacyAvailableOffer(status) };
    case 'idle':
      return { otaOffer: null };
    default:
      return { otaApply: { phase: status.phase, ...(status.version ? { version: status.version } : {}) } };
  }
}

/** What a manual check summary from an older shell says about the offer. It
 *  carries no per-channel errors, and it reports ok while one channel errored
 *  if another found something. So a channel it reports is an answer, but a
 *  channel it leaves out is one only when nothing was found anywhere and
 *  nothing errored. */
export function checkFromSummary(summary: {
  ok: boolean;
  updateAvailable: boolean;
  uiUpdateAvailable: boolean;
  serverUpdateAvailable: boolean;
  uiVersion?: string;
  serverVersion?: string;
  serverComponent?: 'cowork-server' | 'anton-agent';
}): OtaCheck {
  if (!summary.ok) return {};
  if (!summary.updateAvailable) return { ui: { updateAvailable: false }, server: { updateAvailable: false } };
  const check: OtaCheck = {};
  if (summary.uiUpdateAvailable) check.ui = { updateAvailable: true, newVersion: summary.uiVersion };
  if (summary.serverUpdateAvailable) {
    check.server = { updateAvailable: true, latestVersion: summary.serverVersion, component: summary.serverComponent };
  }
  return check;
}

/** The manual installer notice after its check. It is the fallback for when
 *  the auto-updater is off or terminally failed, so it is cleared whenever
 *  the auto-updater is not; otherwise a check that could not reach the
 *  manifest leaves it as it was, and one that answered decides. */
export function manualNoticeAfterCheck(
  prev: ShellManualNotice | null,
  result: { available: boolean; latestVersion?: string; currentVersion?: string; downloadUrl?: string | null; error?: boolean } | null,
  isFallback: boolean,
): ShellManualNotice | null {
  if (!isFallback) return null;
  if (!result || result.error) return prev;
  return result.available && result.latestVersion
    ? { version: result.latestVersion, currentVersion: result.currentVersion, downloadUrl: result.downloadUrl ?? null }
    : null;
}

// ---- settling an apply's progress -------------------------------------------

/** Where the applies stand in main: one running under the maintenance lock,
 *  Restart requests that announced progress and wait for the lock behind it,
 *  and a reload whose navigation has not committed. */
export interface ApplyRun {
  running: boolean;
  queued: number;
  navigationPending: boolean;
}

/** Whether progress an apply announced may be cleared now. A request still
 *  waiting for the lock owns it, always. A navigation commit ends the running
 *  apply's progress (it belonged to the page being torn down). The end of an
 *  apply or a request ends it only when nothing else is running and no reload
 *  is waiting to commit. */
export function applyProgressSettles(run: ApplyRun, at: 'navigation' | 'apply-end' | 'request-end'): boolean {
  if (run.queued > 0) return false;
  if (at === 'navigation') return true;
  if (run.navigationPending) return false;
  return at === 'apply-end' || !run.running;
}

/** The inputs to clear when an apply's progress settles: its in-flight status
 *  and a server reinstall still reported busy (the server updater reports no
 *  completion of its own). A rolled-back or failed apply, and a server error,
 *  stay: they are what the banner and Settings show next. */
export function settledApplyInput(input: UpdateCoordinatorInput): Partial<UpdateCoordinatorInput> {
  const partial: Partial<UpdateCoordinatorInput> = {};
  if (applyInFlight(input.otaApply)) partial.otaApply = null;
  if (input.server?.phase === 'downloading' || input.server?.phase === 'restarting') partial.server = null;
  return partial;
}

// ---- running a step -----------------------------------------------------------

/** How main and the old-shell path each run a step. Only the transports
 *  differ; what counts as success does not. */
export interface ApplyStepHandlers<R> {
  relaunch(): Promise<R>;
  reload(): Promise<R>;
  retry(): Promise<{ phase: string }>;
  download(): Promise<{ phase: string }>;
}

/** Run the step `resolveApplyAction` chose. */
export async function dispatchApplyStep<R>(
  step: ApplyStep | 'stale' | null,
  handlers: ApplyStepHandlers<R>,
): Promise<R | boolean | 'stale'> {
  switch (step) {
    case 'stale':
      return 'stale';
    case 'relaunch':
      return handlers.relaunch();
    case 'reload':
      return handlers.reload();
    case 'retry':
      return (await handlers.retry()).phase !== 'failed';
    case 'download': {
      const phase = (await handlers.download()).phase;
      return phase === 'downloading' || phase === 'ready-to-install';
    }
    default:
      // `open-download-page` is the renderer's own action (it opens the
      // browser); nothing pending answers false.
      return false;
  }
}

// ---- change detection ---------------------------------------------------------

/** The state as the surfaces render it. Every shell download tick changes the
 *  raw snapshot's byte counts and speed, but the banner shows a rounded
 *  percentage, so only a change in that, or in anything else rendered, is a
 *  new state worth pushing. */
export function renderedStateKey(state: UpdateCoordinatorState): string {
  const percent = (p: { percent?: number | null } | null | undefined) =>
    p?.percent == null ? null : Math.round(p.percent);
  const snapshot = state.shell.snapshot;
  return JSON.stringify({
    ...state,
    revision: undefined,
    shell: {
      ...state.shell,
      progress: state.shell.progress ? { percent: percent(state.shell.progress) } : null,
      snapshot: snapshot ? { ...snapshot, progress: snapshot.progress ? { percent: percent(snapshot.progress) } : null } : null,
    },
  });
}

// ---- a feedable instance -------------------------------------------------------

export interface UpdateCoordinator {
  /** Replace one or more inputs. Listeners run only when the rendered state
   *  changed. `ota` is a legacy-channel status, split by `legacyOtaInput`. */
  feed(partial: Partial<UpdateCoordinatorInput> & { ota?: OtaStatus | null }): UpdateCoordinatorState;
  getInput(): UpdateCoordinatorInput;
  getState(): UpdateCoordinatorState;
  subscribe(listener: (state: UpdateCoordinatorState) => void): () => void;
}

export function createUpdateCoordinator(initial: Partial<UpdateCoordinatorInput> = {}): UpdateCoordinator {
  let input: UpdateCoordinatorInput = { ...EMPTY_UPDATE_INPUT, ...initial };
  let revision = 0;
  let state: UpdateCoordinatorState = { ...coordinateUpdates(input), revision };
  let key = renderedStateKey(state);
  const listeners = new Set<(state: UpdateCoordinatorState) => void>();
  return {
    feed(partial) {
      const { ota, ...direct } = partial;
      const next: UpdateCoordinatorInput = { ...input, ...('ota' in partial ? legacyOtaInput(ota ?? null) : {}) };
      for (const k of Object.keys(direct) as Array<keyof UpdateCoordinatorInput>) {
        (next as unknown as Record<string, unknown>)[k] = direct[k] ?? null;
      }
      input = next;
      const derived = coordinateUpdates(input);
      const nextKey = renderedStateKey({ ...derived, revision });
      if (nextKey === key) {
        // Nothing rendered changed (a download tick's byte count, say): keep
        // the fresh snapshot for the next pull, without a push.
        state = { ...derived, revision };
        return state;
      }
      key = nextKey;
      revision += 1;
      state = { ...derived, revision };
      listeners.forEach((listener) => listener(state));
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
