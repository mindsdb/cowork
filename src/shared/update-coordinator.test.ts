import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_UPDATE_INPUT,
  applyProgressSettles,
  applyRunResult,
  availableStatus,
  checkFromSummary,
  coordinateUpdates,
  createUpdateCoordinator,
  dispatchApplyStep,
  legacyAvailableOffer,
  legacyOfferStatus,
  legacyOtaInput,
  manualNoticeAfterCheck,
  offerAfterApply,
  offerAfterCheck,
  otaOfferVersion,
  pollOfferCheck,
  renderedStateKey,
  resolveApplyAction,
  settledApplyInput,
  shellAutoIsPending,
  versionReaches,
  isNewerVersion,
  type OtaOffer,
  type OtaStatus,
  type ShellSnapshot,
  type UpdateCoordinatorInput,
} from './update-coordinator';

const shell = (phase: ShellSnapshot['phase'], over: Partial<ShellSnapshot> = {}): ShellSnapshot => ({
  phase, mode: 'auto', channel: 'prod', currentVersion: '2.26.10.1.1', ...over,
});
type LooseInput = Partial<UpdateCoordinatorInput> & { ota?: OtaStatus | null };
const state = ({ ota, ...rest }: LooseInput) => coordinateUpdates({
  ...EMPTY_UPDATE_INPUT,
  ...(ota !== undefined ? legacyOtaInput(ota) : {}),
  ...rest,
});
const offer = (ui?: string | null, server?: string | null, component?: 'cowork-server' | 'anton-agent'): OtaOffer | null => {
  const o: OtaOffer = {
    ui: ui == null ? null : { version: ui },
    server: server == null ? null : { version: server, ...(component ? { component } : {}) },
  };
  return o.ui || o.server ? o : null;
};

const X = '2.26.10.7.1';
const Y = '2.26.10.8.1';
const Z = '2.26.10.9.1';
const UI = { phase: 'available', version: 'ui' } as const;

describe('coordinateUpdates', () => {
  // The scenario table from docs/update-behavior.md, plus the ladder's edges.
  it.each<[string, LooseInput, Record<string, unknown>]>([
    ['nothing pending', {}, { action: null, applying: null, shell: { status: 'idle' } }],
    ['shell disabled', { shell: shell('disabled') }, { action: null, shell: { status: 'disabled' } }],
    ['OTA only', { ota: { phase: 'available', version: X, uiUpdate: true, uiVersion: X, serverUpdate: false } },
      { action: 'reload', version: X, ui: { status: 'ready', version: X }, server: { status: 'idle' } }],
    ['server and UI', { ota: { phase: 'available', version: X, uiUpdate: true, uiVersion: X, serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server' } },
      { action: 'reload', ui: { status: 'ready', version: X }, server: { status: 'ready', version: '0.26.10.7.1', component: 'cowork-server' } }],
    ['server only, older main', { ota: { phase: 'available', version: 'anton-agent 0.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'anton-agent' } },
      { version: 'anton-agent 0.26.10.7.1', ui: { status: 'idle' }, server: { status: 'ready', component: 'anton-agent' } }],
    ['bare version with no server update is the UI', { ota: { phase: 'available', version: X } }, { ui: { status: 'ready', version: X } }],
    ['all three pending: relaunch owns the action', { shell: shell('ready-to-install', { targetVersion: X }), ota: { phase: 'available', version: X, uiUpdate: true, serverUpdate: true, serverVersion: '0.26.10.7.1' } },
      { action: 'relaunch', version: X, shell: { status: 'ready', manual: false } }],
    ['stranded shell install at boot', { shell: shell('installing', { targetVersion: X, installSource: 'boot' }), otaOffer: offer(X) },
      { action: null, applying: 'installing', shell: { snapshot: { installSource: 'boot' } } }],
    ['OTA downloading', { ota: { phase: 'downloading', version: '0.26.10.7.1' } }, { applying: 'downloading', action: null }],
    ['OTA reloading beside a shell download', { ota: { phase: 'reloading' }, shell: shell('downloading') }, { applying: 'reloading', action: null }],
    ['shell downloading', { shell: shell('downloading', { targetVersion: X, progress: { percent: 42 } }) }, { action: null, shell: { status: 'downloading', progress: { percent: 42 } } }],
    ['shell ready', { shell: shell('ready-to-install', { targetVersion: X }) }, { action: 'relaunch', version: X }],
    ['shell available in manual mode', { shell: shell('available', { mode: 'manual', targetVersion: X }) }, { action: 'download' }],
    ['manual installer notice', { shell: shell('disabled', { disabledReason: 'rollout-disabled' }), shellManual: { version: X, downloadUrl: 'https://x/y.pkg' } },
      { action: 'open-download-page', version: X, shell: { status: 'available', manual: true, manualDownloadUrl: 'https://x/y.pkg' } }],
    ['manual notice outranks an OTA', { shellManual: { version: 'v' }, ota: UI }, { action: 'open-download-page' }],
    ['active auto-update outranks a manual notice', { shellManual: { version: 'v' }, shell: shell('ready-to-install', { targetVersion: 'v' }) }, { action: 'relaunch', shell: { manual: false } }],
    ['targeted failure, recoverable, outranks an OTA', { shell: shell('failed', { targetVersion: 'v', recoverable: true }), ota: UI }, { action: 'retry' }],
    ['targeted failure, terminal', { shell: shell('failed', { targetVersion: 'v', recoverable: false }) }, { action: 'open-download-page', shell: { manual: false } }],
    ['targetless failure never hides an OTA', { shell: shell('failed', { recoverable: true, errorCode: 'update-request-failed' }), ota: UI }, { action: 'reload' }],
    ['targetless failure under a manual notice', { shell: shell('failed', { recoverable: true, errorCode: 'update-request-failed' }), shellManual: { version: 'v' } }, { action: 'open-download-page' }],
    ['targetless failure alone keeps Retry', { shell: shell('failed', { recoverable: true, errorCode: 'update-request-failed' }) }, { action: 'retry' }],
    ['a check that produced no answer is silent', { shell: shell('failed', { recoverable: true, errorCode: 'check-stalled' }) }, { action: null, silentShellFailure: true }],
    ['shell check in flight', { shell: shell('checking') }, { action: null }],
    ['shell check in flight does not hide an OTA', { shell: shell('checking'), ota: UI }, { action: 'reload' }],
    ['failed OTA apply offers the reload again', { ota: { phase: 'error', version: X } }, { action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: X } }],
    ['rolled-back bundle has nothing to click', { ota: { phase: 'rolled-back' } }, { action: null, ui: { status: 'failed', error: 'rolled-back' } }],
    ['server reinstall in flight', { server: { phase: 'downloading', to: '0.26.10.7.1' } }, { server: { status: 'applying', version: '0.26.10.7.1' } }],
    ['critical server error', { server: { phase: 'error', critical: true, error: 'rollback failed' } }, { server: { status: 'failed', error: 'rollback failed' } }],
    ['a server offer reads as applying while installed', { otaOffer: offer(null, '0.26.10.7.1'), server: { phase: 'restarting' } }, { server: { status: 'applying' } }],
    ['aborted install keeps the relaunch and its reason', { shell: shell('ready-to-install', { targetVersion: 'v', recoverable: true, errorCode: 'update-request-failed', errorMessage: 'installer launch failed' }) },
      { action: 'relaunch', shell: { errorCode: 'update-request-failed', errorMessage: 'installer launch failed' } }],
  ])('%s', (_name, input, expected) => {
    expect(state(input)).toMatchObject(expected);
  });

  it('shellAutoIsPending: a failure owns the shell only with a known target', () => {
    expect(shellAutoIsPending(shell('failed', { recoverable: true, targetVersion: 'sh-1' }))).toBe(true);
    expect(shellAutoIsPending(shell('failed', { recoverable: true }))).toBe(false);
    expect(shellAutoIsPending(shell('ready-to-install'))).toBe(true);
    expect(shellAutoIsPending(shell('idle'))).toBe(false);
    expect(shellAutoIsPending(null)).toBe(false);
  });

  it('is serializable and carries no revision from the pure reducer', () => {
    const s = state({ shell: shell('ready-to-install', { targetVersion: 'v' }), ota: UI });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.revision).toBeUndefined();
  });
});

describe('an offer and an apply never overwrite each other', () => {
  it.each<[string, LooseInput, Record<string, unknown>]>([
    ['an offer found mid-apply waits behind the progress', { otaOffer: offer(Y), otaApply: { phase: 'downloading', version: X } },
      { applying: 'downloading', action: null, ui: { status: 'applying', version: X } }],
    ['a failed apply shows over an offer for the same version', { otaOffer: offer(X), otaApply: { phase: 'error', version: X } },
      { action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: X } }],
    ['a failure of a newer release than offered still shows', { otaOffer: offer(X), otaApply: { phase: 'error', version: Y } },
      { action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: Y } }],
    ['only a newer offer replaces a failure', { otaOffer: offer(Z), otaApply: { phase: 'error', version: Y } },
      { action: 'reload', ui: { status: 'ready', version: Z } }],
    ['a rolled-back bundle stays a failure', { otaApply: { phase: 'rolled-back', version: X } },
      { action: null, ui: { status: 'failed', error: 'rolled-back' } }],
    ['a newer UI offer replaces a rollback', { otaOffer: offer(Y), otaApply: { phase: 'rolled-back', version: X } },
      { action: 'reload', ui: { status: 'ready', version: Y } }],
  ])('%s', (_name, input, expected) => {
    expect(state(input)).toMatchObject(expected);
  });

  it('the waiting offer shows once the apply settles', () => {
    const input = { ...EMPTY_UPDATE_INPUT, otaOffer: offer(Y), otaApply: { phase: 'reloading' as const } };
    expect(coordinateUpdates({ ...input, ...settledApplyInput(input) }))
      .toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: Y } });
  });
});

describe('createUpdateCoordinator', () => {
  it('notifies and numbers only rendered changes, and unsubscribes', () => {
    const c = createUpdateCoordinator();
    const seen = vi.fn();
    const off = c.subscribe(seen);
    expect(c.getState().revision).toBe(0);
    c.feed({ shell: shell('checking') });
    c.feed({ shell: shell('checking') });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(c.getState().revision).toBe(1);
    c.feed({ ota: UI });
    expect(c.getState()).toMatchObject({ action: 'reload', revision: 2 });
    expect(c.getInput().shell?.phase).toBe('checking');
    off();
    c.feed({ ota: { phase: 'idle' } });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('routes the legacy shell-available push to the manual notice', () => {
    const c = createUpdateCoordinator();
    c.feed({ ota: { phase: 'shell-available', version: X, currentVersion: '2.26.10.1.1', downloadUrl: 'https://x/y.pkg' } });
    expect(c.getInput()).toMatchObject({ otaOffer: null, otaApply: null, shellManual: { version: X, currentVersion: '2.26.10.1.1', downloadUrl: 'https://x/y.pkg' } });
    expect(c.getState().action).toBe('open-download-page');
  });

  it('a download tick that changes no rendered value is kept for the next pull but not pushed', () => {
    const downloading = (percent: number, bytesPerSecond: number) => shell('downloading', {
      targetVersion: 'v', progress: { transferred: percent * 10, total: 1000, percent, bytesPerSecond },
    });
    expect(renderedStateKey(state({ shell: downloading(41.2, 1000) }))).toBe(renderedStateKey(state({ shell: downloading(41.4, 9000) })));
    const c = createUpdateCoordinator();
    const seen = vi.fn();
    c.subscribe(seen);
    c.feed({ shell: downloading(41.2, 1000) });
    c.feed({ shell: downloading(41.4, 1500) });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(c.getState().shell.snapshot?.progress?.bytesPerSecond).toBe(1500);
    c.feed({ shell: downloading(42.6, 1500) });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('resolveApplyAction: a click runs only what the state still offers', () => {
  const states = {
    relaunch: state({ shell: shell('ready-to-install', { targetVersion: 'v' }), ota: UI }),
    reload: state({ ota: UI }),
    retry: state({ shell: shell('failed', { targetVersion: 'v', recoverable: true }) }),
    download: state({ shell: shell('available', { mode: 'manual', targetVersion: 'v' }) }),
    'open-download-page': state({ shellManual: { version: 'v' } }),
    applying: state({ ota: { phase: 'downloading', version: 'ui' } }),
    idle: state({}),
  } as const;
  type Name = keyof typeof states;

  // Rows: the state a click lands on. Columns: relaunch, reload, retry, download.
  const table: Record<Name, [string, string, string, string]> = {
    relaunch: ['relaunch', 'reload', 'stale', 'stale'],
    reload: ['stale', 'reload', 'stale', 'stale'],
    retry: ['stale', 'stale', 'retry', 'stale'],
    download: ['stale', 'stale', 'stale', 'download'],
    'open-download-page': ['stale', 'stale', 'stale', 'stale'],
    applying: ['stale', 'stale', 'stale', 'stale'],
    idle: ['stale', 'stale', 'stale', 'stale'],
  };
  const clicks = ['relaunch', 'reload', 'retry', 'download'] as const;
  it.each(Object.keys(table) as Name[])('on a %s state', (name) => {
    expect(states[name].action).toBe(name === 'applying' || name === 'idle' ? null : name);
    expect(clicks.map((click) => resolveApplyAction(states[name], click))).toEqual(table[name]);
  });

  it.each<[string, Parameters<typeof resolveApplyAction>[0], unknown, unknown]>([
    ['no named action takes the relaunch', states.relaunch, undefined, 'relaunch'],
    ['no named action takes the reload', states.reload, undefined, 'reload'],
    ['no named action on the installer page runs nothing', states['open-download-page'], undefined, null],
    ['no named action when idle runs nothing', states.idle, undefined, null],
    ['the installer page is the renderer\'s own', states['open-download-page'], 'open-download-page', null],
    ['a null click runs nothing', states.reload, null, null],
    ['an unknown action is stale', states.reload, 'format-disk', 'stale'],
    ['the reload behind a manual notice runs by name', state({ ota: UI, shellManual: { version: 'v' } }), 'reload', 'reload'],
    ['a recoverable failure behind a manual notice retries by name', state({ shell: shell('failed', { recoverable: true }), shellManual: { version: 'v' } }), 'retry', 'retry'],
    ['a terminal failure behind a manual notice does not', state({ shell: shell('failed', { recoverable: false }), shellManual: { version: 'v' } }), 'retry', 'stale'],
  ])('%s', (_name, s, click, expected) => {
    expect(resolveApplyAction(s, click)).toBe(expected);
  });

  it('never relaunches for anything but a relaunch click', () => {
    for (const click of ['reload', 'retry', 'download', 'open-download-page', null, 'nonsense']) {
      expect(resolveApplyAction(states.relaunch, click)).not.toBe('relaunch');
    }
  });
});

describe('versions are matched by order, not exact spelling', () => {
  it.each<[string | undefined, string | undefined, boolean, boolean]>([
    // [version, target, versionReaches, isNewerVersion]
    [Y, X, true, true],
    [X, X, true, false],
    [X, Y, false, false],
    [undefined, X, false, false],
    [X, undefined, true, true],
    ['A', 'B', false, true],
  ])('%s against %s', (a, b, reaches, newer) => {
    expect(versionReaches(a, b)).toBe(reaches);
    expect(isNewerVersion(a, b)).toBe(newer);
  });

  it('OTA progress is named by the offer, never by a manual notice\'s version', () => {
    expect(otaOfferVersion(offer(X, '0.26.10.7.1'))).toBe(X);
    expect(otaOfferVersion(offer(null, '0.26.10.7.1'))).toBe('0.26.10.7.1');
    expect(otaOfferVersion(offer(null, '0.26.10.7.1', 'anton-agent'))).toBe('anton-agent 0.26.10.7.1');
    expect(otaOfferVersion(null)).toBeUndefined();
    expect(state({ otaOffer: offer(X), shellManual: { version: '2.26.12.1.1' } })).toMatchObject({ version: '2.26.12.1.1', ui: { status: 'ready', version: X } });
  });
});

describe('offerAfterCheck and offerAfterApply', () => {
  const found = { ui: { updateAvailable: true, newVersion: X }, server: { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'cowork-server' as const } };
  const both = offer(X, '0.26.10.7.1', 'cowork-server');

  it.each<[string, OtaOffer | null, Parameters<typeof offerAfterCheck>[1], OtaOffer | null]>([
    ['a channel that found something offers it', null, found, both],
    ['channels that found nothing clear their layers', both, { ui: { updateAvailable: false }, server: { updateAvailable: false } }, null],
    ['a server channel that errored keeps its offer', both, { ...found, server: { updateAvailable: false, error: true } }, both],
    ['a UI channel that errored keeps its offer', both, { ui: { updateAvailable: false, error: true }, server: { updateAvailable: false } }, offer(X, null)],
    ['a channel that was not checked keeps its offer', offer(X), { server: { updateAvailable: false } }, offer(X)],
  ])('check: %s', (_name, prev, check, expected) => {
    expect(offerAfterCheck(prev, check)).toEqual(expected);
  });

  it.each<[string, OtaOffer | null, Parameters<typeof offerAfterApply>[1], OtaOffer | null]>([
    ['a landed server clears only the server', offer('X', 'Y'), { server: { landed: true, version: 'Y' } }, offer('X', null)],
    ['a landed UI keeps the server offered beside it', offer('X', 'Y'), { ui: { result: 'landed', version: 'X' } }, offer(null, 'Y')],
    ['a newer offer made meanwhile stands', offer('B'), { ui: { result: 'landed', version: 'A' } }, offer('B')],
    ['a newer offer stands over a no-op', offer('B'), { ui: { result: 'nothing', version: 'A' } }, offer('B')],
    ['a no-op apply drops the stale offer', offer('X'), { ui: { result: 'nothing', version: 'X' } }, null],
    ['a rollback drops its offer', offer('X'), { ui: { result: 'rolled-back', version: 'X' } }, null],
    ['a failed download keeps its offer for the retry', offer('X'), { ui: { result: 'failed', version: 'X' } }, offer('X')],
    ['an unversioned offer is the one answered', { ui: {}, server: null }, { ui: { result: 'landed', version: 'X' } }, null],
    ['a newer release landing clears the older offer', offer(X), { ui: { result: 'landed', version: Y } }, null],
    ['a newer server landing clears the older offer', offer(null, '0.26.10.6.1'), { server: { landed: true, version: '0.26.10.7.1' } }, null],
    ['an offer newer than what landed stands', offer(Z), { ui: { result: 'landed', version: Y } }, offer(Z)],
    ['a newer release rolling back quarantines the older offer', offer(X), { ui: { result: 'rolled-back', version: Y } }, null],
    ['nothing offered stays nothing', null, { ui: { result: 'landed', version: X } }, null],
  ])('apply: %s', (_name, prev, outcome, expected) => {
    expect(offerAfterApply(prev, outcome)).toEqual(expected);
  });

  it.each<[string, Parameters<typeof applyRunResult>[0], string]>([
    ['nothing ran', { serverTried: false, serverOk: true, ui: { result: 'nothing', version: X } }, 'stale'],
    ['nothing tried', { serverTried: false, serverOk: true }, 'stale'],
    ['UI failed', { serverTried: false, serverOk: true, ui: { result: 'failed', version: X } }, 'failed'],
    ['UI landed', { serverTried: false, serverOk: true, ui: { result: 'landed', version: X } }, 'applied'],
    ['UI rolled back', { serverTried: false, serverOk: true, ui: { result: 'rolled-back', version: X } }, 'applied'],
    ['server failed', { serverTried: true, serverOk: false }, 'failed'],
    ['server landed beside a failed UI', { serverTried: true, serverOk: true, ui: { result: 'failed', version: X } }, 'applied'],
  ])('run result: %s', (_name, run, expected) => {
    expect(applyRunResult(run)).toBe(expected);
  });
});

describe('pollOfferCheck: what a boot or periodic poll offers', () => {
  const uiFound = { updateAvailable: true, newVersion: X };
  const uiNone = { updateAvailable: false };
  const serverFound = { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'cowork-server' as const };
  const serverNone = { updateAvailable: false };
  type PollInput = Parameters<typeof pollOfferCheck>[0];
  const poll = (ui: PollInput['ui'], server: PollInput['server'], surfaceServer: boolean, applyServer = false, applyUi = false) =>
    state({ otaOffer: offerAfterCheck(null, pollOfferCheck({ ui, server, surfaceServer, applyServer, applyUi })) });

  it.each<[string, ReturnType<typeof poll>, Record<string, unknown>]>([
    ['everything current', poll(uiNone, serverNone, false), { action: null }],
    ['OTA only names the UI', poll(uiFound, serverNone, false), { action: 'reload', version: X, ui: { status: 'ready' }, server: { status: 'idle' } }],
    ['server and UI name both', poll(uiFound, serverFound, true), { action: 'reload', server: { status: 'ready', component: 'cowork-server' } }],
    ['an auto-applied pass offers nothing on the way in', poll(uiFound, serverFound, true, true, true), { action: null }],
    ['a stream repair is never offered', poll(uiNone, serverFound, false), { action: null }],
  ])('%s', (_name, s, expected) => {
    expect(s).toMatchObject(expected);
  });

  it('reports only what the pass leaves to the offer', () => {
    expect(pollOfferCheck({ ui: uiFound, server: serverFound, surfaceServer: true, applyServer: true, applyUi: false })).toEqual({ ui: uiFound });
    // Manifest host down: the UI is not reported, the server still is.
    expect(pollOfferCheck({ ui: null, server: serverFound, surfaceServer: true, applyServer: false, applyUi: false }))
      .toEqual({ server: { ...serverFound, updateAvailable: true } });
    expect(offerAfterCheck(offer(X), pollOfferCheck({ ui: null, server: serverNone, surfaceServer: false, applyServer: false, applyUi: false })))
      .toEqual(offer(X));
  });
});

describe('the legacy channel', () => {
  it.each<[string, OtaStatus, OtaOffer | null]>([
    ['UI and server named only by version and serverUpdate', { phase: 'available', version: X, serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server' }, offer(X, '0.26.10.7.1', 'cowork-server')],
    ['server only, bare', { phase: 'available', version: '0.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1' }, offer(null, '0.26.10.7.1')],
    ['server only, labelled', { phase: 'available', version: 'anton-agent 0.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'anton-agent' }, offer(null, '0.26.10.7.1', 'anton-agent')],
    ['server only, no version', { phase: 'available', serverUpdate: true, serverVersion: '0.26.10.7.1' }, offer(null, '0.26.10.7.1')],
    ['no server update is a UI update', { phase: 'available', version: X }, offer(X)],
    ['no server update and no version', { phase: 'available' }, { ui: {}, server: null }],
    ['explicit fields win', { phase: 'available', version: 'v', uiUpdate: false, serverUpdate: true, serverVersion: 's' }, offer(null, 's')],
  ])('available: %s', (_name, status, expected) => {
    expect(legacyAvailableOffer(status)).toEqual(expected);
  });

  it('round-trips the status main builds for an offer', () => {
    for (const o of [offer('X'), offer(null, 'Y', 'anton-agent'), offer('X', 'Y', 'cowork-server')]) {
      expect(legacyAvailableOffer(legacyOfferStatus(o))).toEqual(o);
    }
    expect(legacyOfferStatus(null)).toEqual({ phase: 'idle' });
    expect(availableStatus({ updateAvailable: true, newVersion: X }, { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'cowork-server' })).toEqual({
      phase: 'available', version: X, uiUpdate: true, uiVersion: X,
      serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server',
    });
    expect(availableStatus({ updateAvailable: false }, { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'anton-agent' }))
      .toMatchObject({ version: 'anton-agent 0.26.10.7.1', uiUpdate: false, uiVersion: undefined });
  });

  it.each<[OtaStatus | null, Partial<UpdateCoordinatorInput>]>([
    [{ phase: 'idle' }, { otaOffer: null }],
    [{ phase: 'reloading' }, { otaApply: { phase: 'reloading' } }],
    [{ phase: 'error', version: 'v' }, { otaApply: { phase: 'error', version: 'v' } }],
    [{ phase: 'shell-available' }, { shellManual: null }],
    [null, { otaOffer: null, otaApply: null }],
  ])('splits %j into its input', (status, expected) => {
    expect(legacyOtaInput(status)).toEqual(expected);
  });

  it.each<[string, Parameters<typeof checkFromSummary>[0], ReturnType<typeof checkFromSummary>]>([
    ['nothing found and nothing errored answers no on both', { ok: true, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false }, { ui: { updateAvailable: false }, server: { updateAvailable: false } }],
    ['a reported channel answers; one left out may have errored', { ok: true, updateAvailable: true, uiUpdateAvailable: true, serverUpdateAvailable: false, uiVersion: X }, { ui: { updateAvailable: true, newVersion: X } }],
    ['an inconclusive summary says nothing', { ok: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false }, {}],
  ])('older shell summary: %s', (_name, summary, expected) => {
    expect(checkFromSummary(summary)).toEqual(expected);
  });
});

describe('manualNoticeAfterCheck', () => {
  const notice = { version: '2.26.12.1.1', currentVersion: '2.26.9.1.1', downloadUrl: 'https://x/y.pkg' };
  it.each<[string, Parameters<typeof manualNoticeAfterCheck>[1], boolean, unknown]>([
    ['raised while the auto-updater is the fallback', { available: true, latestVersion: notice.version, currentVersion: notice.currentVersion, downloadUrl: notice.downloadUrl }, true, notice],
    ['cleared when the auto-updater is not the fallback', { available: true, latestVersion: notice.version }, false, null],
    ['kept when the manifest was unreachable', { available: false, error: true }, true, notice],
    ['kept when there was no check', null, true, notice],
    ['cleared by a definitive no', { available: false }, true, null],
  ])('%s', (_name, result, isFallback, expected) => {
    expect(manualNoticeAfterCheck(notice, result, isFallback)).toEqual(expected);
  });
});

describe('settling an apply\'s progress', () => {
  const run = (over: Partial<Parameters<typeof applyProgressSettles>[0]> = {}) => ({ running: false, queued: 0, navigationPending: false, ...over });
  it.each<[string, ReturnType<typeof run>, 'navigation' | 'apply-end' | 'request-end', boolean]>([
    ['a queued request owns it at a navigation', run({ queued: 1 }), 'navigation', false],
    ['a queued request owns it at an apply end', run({ queued: 1 }), 'apply-end', false],
    ['a queued request owns it at a request end', run({ queued: 1 }), 'request-end', false],
    ['a navigation commit settles the running apply', run({ running: true, navigationPending: true }), 'navigation', true],
    ['an apply end waits for the commit', run({ navigationPending: true }), 'apply-end', false],
    ['an apply end settles', run(), 'apply-end', true],
    ['a request end settles with nothing running', run(), 'request-end', true],
    ['a request end waits for a running apply', run({ running: true }), 'request-end', false],
  ])('%s', (_name, r, at, expected) => {
    expect(applyProgressSettles(r, at)).toBe(expected);
  });

  it('clears only what is in flight', () => {
    expect(settledApplyInput({ ...EMPTY_UPDATE_INPUT, otaApply: { phase: 'reloading' }, server: { phase: 'restarting' } })).toEqual({ otaApply: null, server: null });
    expect(settledApplyInput({ ...EMPTY_UPDATE_INPUT, otaApply: { phase: 'rolled-back' }, server: { phase: 'error', critical: true } })).toEqual({});
  });
});

describe('dispatchApplyStep', () => {
  const handlers = () => ({
    relaunch: vi.fn(async (): Promise<unknown> => ({ confirm: true, runningTasks: 2 })),
    reload: vi.fn(async (): Promise<unknown> => true),
    retry: vi.fn(async () => ({ phase: 'checking' })),
    download: vi.fn(async () => ({ phase: 'downloading' })),
  });

  it('runs only the chosen step; retry and download succeed by the phase they reach', async () => {
    const h = handlers();
    expect(await dispatchApplyStep('relaunch', h)).toEqual({ confirm: true, runningTasks: 2 });
    expect(await dispatchApplyStep('reload', h)).toBe(true);
    expect(await dispatchApplyStep('retry', h)).toBe(true);
    h.retry.mockResolvedValueOnce({ phase: 'failed' });
    expect(await dispatchApplyStep('retry', h)).toBe(false);
    expect(await dispatchApplyStep('download', h)).toBe(true);
    h.download.mockResolvedValueOnce({ phase: 'idle' });
    expect(await dispatchApplyStep('download', h)).toBe(false);
  });

  it('a stale click and nothing pending run nothing', async () => {
    const h = handlers();
    expect(await dispatchApplyStep('stale', h)).toBe('stale');
    expect(await dispatchApplyStep(null, h)).toBe(false);
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });
});
