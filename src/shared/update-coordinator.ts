// One update state for every surface. Pure and serializable, so an OTA renderer
// on an older shell can run the same reducer over the legacy channels (host.ts).
// Checks write only `otaOffer` and applies only `otaApply`, so neither can
// overwrite the other.

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

/** Older shells omit the newer fields. */
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

/** The legacy `UI_UPDATE_STATUS` payload; `legacyOtaInput` splits it. */
export interface OtaStatus {
  phase: 'idle' | 'available' | 'downloading' | 'reloading' | 'rolled-back' | 'error' | 'shell-available';
  version?: string;
  /** Older shells set only `serverUpdate` (see `legacyAvailableOffer`). */
  uiUpdate?: boolean;
  uiVersion?: string;
  serverUpdate?: boolean;
  serverVersion?: string;
  serverComponent?: 'cowork-server' | 'anton-agent';
  currentVersion?: string;
  downloadUrl?: string;
}

export interface ServerStatus {
  phase: 'idle' | 'downloading' | 'restarting' | 'error';
  to?: string;
  error?: string;
  critical?: boolean;
}

/** The prod-only manual installer notice. */
export interface ShellManualNotice {
  version: string;
  currentVersion?: string;
  downloadUrl?: string | null;
}

export interface OtaOffer {
  ui: { version?: string } | null;
  server: { version?: string; component?: 'cowork-server' | 'anton-agent' } | null;
}

/** `rolled-back` and `error` stay until a later apply or a newer offer. */
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
  manual: boolean;
  manualDownloadUrl?: string | null;
  snapshot: ShellSnapshot | null;
}

/** `relaunch` also applies pending OTA at the next boot. `open-download-page`
 *  runs in the renderer. */
export type UpdateAction = 'relaunch' | 'reload' | 'retry' | 'download' | 'open-download-page' | null;

export interface UpdateCoordinatorState {
  ui: UpdateLayerState & { component?: never };
  server: UpdateLayerState & { component?: 'cowork-server' | 'anton-agent' };
  shell: ShellLayerState;
  action: UpdateAction;
  version?: string;
  applying: 'downloading' | 'reloading' | 'installing' | null;
  /** A check that produced no answer: nothing to retry, so no banner. */
  silentShellFailure: boolean;
  /** Per-instance counter; renderers drop states older than one they hold.
   *  Absent from shells that predate it. */
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

/** A failure owns the shell layer only with a known target. */
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

export function applyInFlight(apply: OtaApply | null): boolean {
  return apply?.phase === 'downloading' || apply?.phase === 'reloading';
}

/** CalVer order when both parse; otherwise only equality is known. */
function compareVersions(a: string, b: string): number | null {
  if (a === b) return 0;
  const pa = parseCalVer(a);
  const pb = parseCalVer(b);
  return pa && pb ? compareCalVer(pa, pb) : null;
}

/** Unordered versions that differ count as newer. */
export function isNewerVersion(candidate: string | undefined, than: string | undefined): boolean {
  if (!candidate) return false;
  if (!than) return true;
  const order = compareVersions(candidate, than);
  return order === null ? candidate !== than : order > 0;
}

/** Same or newer. Versions that compare equal but are spelled differently
 *  (a PEP 440 rc suffix) count as reached. */
export function versionReaches(version: string | undefined, target: string | undefined): boolean {
  if (target === undefined) return true;
  if (version === undefined) return false;
  const order = compareVersions(version, target);
  return order === null ? version === target : order >= 0;
}

/** Names OTA progress and failures. Not the banner version, which is the
 *  shell installer's whenever a manual notice exists. */
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

  if (offer?.ui) Object.assign(ui, { status: 'ready', version: offer.ui.version });
  if (offer?.server && !serverApplying) {
    Object.assign(srv, { status: 'ready', version: offer.server.version, component: offer.server.component });
  }

  if (applyInFlight(apply)) {
    // Main mirrors the server updater's busy phases onto the apply.
    Object.assign(ui, { status: 'applying', version: apply?.version, error: undefined });
    if (!serverFailed) srv.status = 'applying';
  } else if (apply?.phase === 'error' || apply?.phase === 'rolled-back') {
    // Only a newer offer hides the failure. The apply re-reads the manifest,
    // so it can fail on a release newer than the one offered.
    const newerOffer = isNewerVersion(offer?.ui?.version, apply.version);
    if (!newerOffer) {
      // A rolled-back bundle is quarantined, so it has no action.
      Object.assign(ui, apply.phase === 'error'
        ? { status: 'failed', version: apply.version, error: 'apply-failed' }
        : { status: 'failed', version: apply.version, error: 'rolled-back' });
    }
  }
  return { ui, server: srv };
}

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

  // Shell-first, because a relaunch applies the OTA too. A shell failure with
  // no known target ranks below the OTA so a feed outage cannot hide a Restart.
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

function relaunchPending(shell: ShellLayerState): boolean {
  return shell.status === 'ready' && !shell.manual;
}

/** Includes retrying a failed apply, never a rolled-back bundle. */
function reloadPending(ui: UpdateCoordinatorState['ui'], server: UpdateCoordinatorState['server']): boolean {
  return ui.status === 'ready'
    || server.status === 'ready'
    || (ui.status === 'failed' && ui.error !== 'rolled-back');
}

/** An anton-only update shares cowork-server's version, so name the component. */
export function serverLabel(server: UpdateCoordinatorState['server']): string | undefined {
  if (!server.version) return undefined;
  return server.component === 'anton-agent' ? `${server.component} ${server.version}` : server.version;
}

export type ApplyStep = 'relaunch' | 'reload' | 'retry' | 'download';

function isApplyStep(action: unknown): action is ApplyStep {
  return action === 'relaunch' || action === 'reload' || action === 'retry' || action === 'download';
}

/** The banner can lag main by a push, so a click is checked on arrival. */
function stepStillOffered(state: UpdateCoordinatorState, step: ApplyStep): boolean {
  if (state.applying) return false;
  switch (step) {
    case 'relaunch':
      return relaunchPending(state.shell);
    case 'reload':
      // Also behind a dismissed manual notice, which outranks it in the ladder.
      return reloadPending(state.ui, state.server);
    case 'retry':
      // A failed auto-update behind a manual notice can still be retried.
      return (state.shell.status === 'failed' || (state.shell.manual && state.shell.phase === 'failed'))
        && state.shell.recoverable === true;
    case 'download':
      return state.shell.status === 'available' && !state.shell.manual;
  }
}

/** Runs the clicked action only if still offered, otherwise `'stale'`, so a
 *  relaunch never runs for another click. An older renderer that names no
 *  action gets whatever is offered now. */
export function resolveApplyAction(state: UpdateCoordinatorState, clicked?: unknown): ApplyStep | 'stale' | null {
  if (clicked === undefined) return isApplyStep(state.action) ? state.action : null;
  if (clicked === null || clicked === 'open-download-page') return null;
  if (!isApplyStep(clicked)) return 'stale';
  return stepStillOffered(state, clicked) ? clicked : 'stale';
}

/** Per channel: absent or `error` leaves that layer's offer, an answer
 *  replaces it. */
export interface OtaCheck {
  ui?: { updateAvailable: boolean; newVersion?: string; error?: boolean };
  server?: { updateAvailable: boolean; latestVersion?: string; component?: 'cowork-server' | 'anton-agent'; error?: boolean };
}

function normalizeOffer(offer: OtaOffer): OtaOffer | null {
  return offer.ui || offer.server ? offer : null;
}

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

/** A layer this pass applies is left to the apply, so an auto-applied update
 *  is never offered on the way in. Stream repairs are never offered. */
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

/** `ui` is absent when the apply did not try the UI. */
export interface OtaApplyOutcome {
  server?: { landed: true; version?: string };
  ui?: { result: 'landed' | 'rolled-back' | 'failed' | 'nothing'; version?: string };
}

/** The apply re-reads the manifest, so it can land a newer release than the
 *  one offered. An offer newer than the outcome was made meanwhile and stands. */
function outcomeCovers(offered: { version?: string } | null, version: string | undefined): boolean {
  if (!offered) return false;
  return versionReaches(version, offered.version);
}

/** A landed server update reloads the window, so it counts as applied even
 *  if the UI failed. `stale` means nothing ran: the offer was already gone. */
export type ApplyRunResult = 'applied' | 'failed' | 'stale';

export function applyRunResult(run: { serverTried: boolean; serverOk: boolean; ui?: OtaApplyOutcome['ui'] }): ApplyRunResult {
  if (run.serverTried) return run.serverOk ? 'applied' : 'failed';
  if (run.ui?.result === 'landed' || run.ui?.result === 'rolled-back') return 'applied';
  if (run.ui?.result === 'failed') return 'failed';
  return 'stale';
}

/** A rolled-back UI's offer goes, or Restart would re-apply it. A failed
 *  download keeps its offer for the retry. */
export function offerAfterApply(prev: OtaOffer | null, outcome: OtaApplyOutcome): OtaOffer | null {
  if (!prev) return null;
  const next: OtaOffer = { ...prev };
  if (outcome.server?.landed && outcomeCovers(prev.server, outcome.server.version)) next.server = null;
  if (outcome.ui && outcome.ui.result !== 'failed' && outcomeCovers(prev.ui, outcome.ui.version)) next.ui = null;
  return normalizeOffer(next);
}

/** `version` keeps the legacy "whichever we have" value for older renderers. */
export function availableStatus(
  ui: { updateAvailable: boolean; newVersion?: string },
  server: { updateAvailable: boolean; latestVersion?: string; component?: 'cowork-server' | 'anton-agent' },
): OtaStatus {
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

export function legacyOfferStatus(offer: OtaOffer | null): OtaStatus {
  if (!offer) return { phase: 'idle' };
  return availableStatus(
    { updateAvailable: !!offer.ui, newVersion: offer.ui?.version },
    { updateAvailable: !!offer.server, latestVersion: offer.server?.version, component: offer.server?.component },
  );
}

/** Older shells set only `serverUpdate`, and `version` names the UI update
 *  when one is pending, else the server label. */
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

/** An older shell's summary has no per-channel errors and reports ok if any
 *  channel found something, so an omitted channel is an answer only when
 *  nothing was found. */
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

/** Cleared unless the auto-updater is the fallback; an unreachable manifest
 *  leaves it. */
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

export interface ApplyRun {
  running: boolean;
  queued: number;
  navigationPending: boolean;
}

/** A queued request owns the progress. A navigation commit ends it, since it
 *  belonged to the torn-down page. */
export function applyProgressSettles(run: ApplyRun, at: 'navigation' | 'apply-end' | 'request-end'): boolean {
  if (run.queued > 0) return false;
  if (at === 'navigation') return true;
  if (run.navigationPending) return false;
  return at === 'apply-end' || !run.running;
}

/** The server updater reports no completion, so its busy phase clears here.
 *  Failures stay for the banner. */
export function settledApplyInput(input: UpdateCoordinatorInput): Partial<UpdateCoordinatorInput> {
  const partial: Partial<UpdateCoordinatorInput> = {};
  if (applyInFlight(input.otaApply)) partial.otaApply = null;
  if (input.server?.phase === 'downloading' || input.server?.phase === 'restarting') partial.server = null;
  return partial;
}

export interface ApplyStepHandlers<R> {
  relaunch(): Promise<R>;
  reload(): Promise<R>;
  retry(): Promise<{ phase: string }>;
  download(): Promise<{ phase: string }>;
}

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
      // `open-download-page` runs in the renderer.
      return false;
  }
}

/** Download ticks change byte counts and speed, but only a rendered change,
 *  such as the rounded percent, is worth a push. */
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

export interface UpdateCoordinator {
  /** Listeners run only when the rendered state changed. `ota` is a legacy status. */
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
        // Keep the fresh snapshot for the next pull, without a push.
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
