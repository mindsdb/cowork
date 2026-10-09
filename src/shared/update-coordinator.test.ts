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
/** The derived state, from the new inputs and/or a legacy-channel status. */
type LooseInput = Partial<UpdateCoordinatorInput> & { ota?: OtaStatus | null };
const state = ({ ota, ...rest }: LooseInput) => coordinateUpdates({
  ...EMPTY_UPDATE_INPUT,
  ...(ota !== undefined ? legacyOtaInput(ota) : {}),
  ...rest,
});
const offer = (ui?: string | null, server?: string | null, component?: 'cowork-server' | 'anton-agent'): OtaOffer | null => {
  const o: OtaOffer = {
    ui: ui === undefined || ui === null ? null : { version: ui },
    server: server === undefined || server === null ? null : { version: server, ...(component ? { component } : {}) },
  };
  return o.ui || o.server ? o : null;
};

describe('coordinateUpdates', () => {
  it('is idle with nothing pending', () => {
    const s = state({});
    expect(s).toMatchObject({ action: null, applying: null });
    expect(s.shell.status).toBe('idle');
    expect(state({ shell: shell('disabled') }).shell.status).toBe('disabled');
  });

  // The scenario table from docs/update-behavior.md, "Sample scenarios".
  describe('scenarios', () => {
    it('OTA only, found mid-session: one reload', () => {
      const s = state({ ota: { phase: 'available', version: '2.26.10.7.1', uiUpdate: true, uiVersion: '2.26.10.7.1', serverUpdate: false } });
      expect(s).toMatchObject({ action: 'reload', version: '2.26.10.7.1' });
      expect(s.ui).toMatchObject({ status: 'ready', version: '2.26.10.7.1' });
      expect(s.server.status).toBe('idle');
    });

    it('server + UI pending: one reload that names both layers', () => {
      const s = state({ ota: {
        phase: 'available', version: '2.26.10.7.1', uiUpdate: true, uiVersion: '2.26.10.7.1',
        serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server',
      } });
      expect(s.action).toBe('reload');
      expect(s.ui).toMatchObject({ status: 'ready', version: '2.26.10.7.1' });
      expect(s.server).toMatchObject({ status: 'ready', version: '0.26.10.7.1', component: 'cowork-server' });
    });

    it('server only, from an older main that names no layers: inferred from serverUpdate', () => {
      const s = state({ ota: { phase: 'available', version: 'anton-agent 0.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'anton-agent' } });
      expect(s.ui.status).toBe('idle');
      expect(s.server).toMatchObject({ status: 'ready', version: '0.26.10.7.1', component: 'anton-agent' });
      expect(s.version).toBe('anton-agent 0.26.10.7.1');
      // And a bare version with no server update is the UI's.
      expect(state({ ota: { phase: 'available', version: '2.26.10.7.1' } }).ui).toMatchObject({ status: 'ready', version: '2.26.10.7.1' });
    });

    it('all three pending: the shell relaunch owns the one action, and the OTA is still marked pending', () => {
      const s = state({
        shell: shell('ready-to-install', { targetVersion: '2.26.10.7.1' }),
        ota: { phase: 'available', version: '2.26.10.7.1', uiUpdate: true, serverUpdate: true, serverVersion: '0.26.10.7.1' },
      });
      expect(s).toMatchObject({ action: 'relaunch', version: '2.26.10.7.1' });
      expect(s.shell).toMatchObject({ status: 'ready', manual: false });
      // The OTA is still pending behind it: a reload click would still run.
      expect(resolveApplyAction(s, 'reload')).toBe('reload');
    });

    it('a stranded shell update being installed at boot: applying, no action, the overlay says so', () => {
      const s = state({ shell: shell('installing', { targetVersion: '2.26.10.7.1', installSource: 'boot' }) });
      expect(s).toMatchObject({ action: null, applying: 'installing' });
      expect(s.shell.snapshot?.installSource).toBe('boot');
    });

    it('a boot OTA apply: applying through download and reload, with no action', () => {
      expect(state({ ota: { phase: 'downloading', version: '0.26.10.7.1' } })).toMatchObject({ applying: 'downloading', action: null });
      expect(state({ ota: { phase: 'reloading' } })).toMatchObject({ applying: 'reloading', action: null });
      // A shell download in flight never hides a reload in flight.
      expect(state({ ota: { phase: 'reloading' }, shell: shell('downloading') }).applying).toBe('reloading');
    });

    it('shell only, auto mode: download in flight, then ready', () => {
      const dl = state({ shell: shell('downloading', { targetVersion: '2.26.10.7.1', progress: { percent: 42 } }) });
      expect(dl).toMatchObject({ action: null });
      expect(dl.shell).toMatchObject({ status: 'downloading', progress: { percent: 42 } });
      const ready = state({ shell: shell('ready-to-install', { targetVersion: '2.26.10.7.1' }) });
      expect(ready).toMatchObject({ action: 'relaunch', version: '2.26.10.7.1' });
    });

    it('shell only, manual mode: an explicit download first', () => {
      expect(state({ shell: shell('available', { mode: 'manual', targetVersion: '2.26.10.7.1' }) })).toMatchObject({ action: 'download' });
    });

    it('shell only, auto-update disabled or failed: the manual installer notice', () => {
      const s = state({ shell: shell('disabled', { disabledReason: 'rollout-disabled' }), shellManual: { version: '2.26.10.7.1', downloadUrl: 'https://x/y.pkg' } });
      expect(s).toMatchObject({ action: 'open-download-page', version: '2.26.10.7.1' });
      expect(s.shell).toMatchObject({ status: 'available', manual: true, manualDownloadUrl: 'https://x/y.pkg' });
      // The manual notice outranks an OTA, as it always did.
      expect(state({ shellManual: { version: 'v' }, ota: { phase: 'available', version: 'ui' } }).action).toBe('open-download-page');
      // An active auto-update outranks a stray manual notice.
      expect(state({ shellManual: { version: 'v' }, shell: shell('ready-to-install', { targetVersion: 'v' }) })).toMatchObject({ action: 'relaunch', shell: { manual: false } });
    });

    it('a failed shell update with a known target: retry, or the installer when terminal', () => {
      expect(state({ shell: shell('failed', { targetVersion: 'v', recoverable: true }) })).toMatchObject({ action: 'retry' });
      expect(state({ shell: shell('failed', { targetVersion: 'v', recoverable: false }) })).toMatchObject({ action: 'open-download-page', shell: { manual: false } });
      // It outranks a pending OTA, as a real shell update always has.
      expect(state({ shell: shell('failed', { targetVersion: 'v', recoverable: true }), ota: { phase: 'available', version: 'ui' } }).action).toBe('retry');
    });

    it('a targetless shell failure never hides an OTA restart, but keeps Retry when nothing else is pending', () => {
      const failed = shell('failed', { recoverable: true, errorCode: 'update-request-failed' });
      expect(state({ shell: failed, ota: { phase: 'available', version: 'ui' } })).toMatchObject({ action: 'reload' });
      expect(state({ shell: failed, shellManual: { version: 'v' } }).action).toBe('open-download-page');
      expect(state({ shell: failed })).toMatchObject({ action: 'retry' });
    });

    it('a check that produced no answer is silent', () => {
      const s = state({ shell: shell('failed', { recoverable: true, errorCode: 'check-stalled' }) });
      expect(s).toMatchObject({ action: null, silentShellFailure: true });
    });

    it('a shell check in flight is reported, and does not hide an OTA restart', () => {
      expect(state({ shell: shell('checking') })).toMatchObject({ action: null });
      expect(state({ shell: shell('checking'), ota: { phase: 'available', version: 'ui' } }).action).toBe('reload');
    });

    it('a failed OTA apply offers the reload again', () => {
      const s = state({ ota: { phase: 'error', version: '2.26.10.7.1' } });
      expect(s).toMatchObject({ action: 'reload' });
      expect(s.ui).toMatchObject({ status: 'failed', error: 'apply-failed', version: '2.26.10.7.1' });
    });

    it('a rolled-back bundle is a failed layer with nothing to click: it is quarantined', () => {
      const s = state({ ota: { phase: 'rolled-back' } });
      expect(s).toMatchObject({ action: null });
      expect(s.ui).toMatchObject({ status: 'failed', error: 'rolled-back' });
    });

    it('a server reinstall in flight is applying, and a critical server error is a failed server layer', () => {
      expect(state({ server: { phase: 'downloading', to: '0.26.10.7.1' } }).server).toMatchObject({ status: 'applying', version: '0.26.10.7.1' });
      const s = state({ server: { phase: 'error', critical: true, error: 'rollback failed' } });
      expect(s.server).toMatchObject({ status: 'failed', error: 'rollback failed' });
    });

    it('an aborted install keeps the relaunch and carries the reason (ENG-3291)', () => {
      const s = state({ shell: shell('ready-to-install', { targetVersion: 'v', recoverable: true, errorCode: 'update-request-failed', errorMessage: 'installer launch failed' }) });
      expect(s).toMatchObject({ action: 'relaunch' });
      expect(s.shell).toMatchObject({ errorCode: 'update-request-failed', errorMessage: 'installer launch failed' });
    });
  });

  it('shellAutoIsPending: a failure owns the shell only with a known target', () => {
    expect(shellAutoIsPending(shell('failed', { recoverable: true, targetVersion: 'sh-1' }))).toBe(true);
    expect(shellAutoIsPending(shell('failed', { recoverable: true }))).toBe(false);
    expect(shellAutoIsPending(shell('ready-to-install'))).toBe(true);
    expect(shellAutoIsPending(shell('idle'))).toBe(false);
    expect(shellAutoIsPending(null)).toBe(false);
  });

  it('is serializable: the state survives a structured-clone round trip unchanged', () => {
    const s = state({ shell: shell('ready-to-install', { targetVersion: 'v' }), ota: { phase: 'available', version: 'ui' } });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('createUpdateCoordinator', () => {
  it('feeds each input independently and notifies only when the derived state changes', () => {
    const c = createUpdateCoordinator();
    const seen = vi.fn();
    c.subscribe(seen);
    c.feed({ shell: shell('checking') });
    expect(seen).toHaveBeenCalledTimes(1);
    // A snapshot that changes nothing derived is not republished.
    c.feed({ shell: shell('checking') });
    expect(seen).toHaveBeenCalledTimes(1);
    c.feed({ ota: { phase: 'available', version: 'ui' } });
    expect(c.getState().action).toBe('reload');
    expect(seen).toHaveBeenCalledTimes(2);
    expect(c.getInput().shell?.phase).toBe('checking');
  });

  it('routes the legacy shell-available push to the manual notice', () => {
    const c = createUpdateCoordinator();
    c.feed({ ota: { phase: 'shell-available', version: '2.26.10.7.1', currentVersion: '2.26.10.1.1', downloadUrl: 'https://x/y.pkg' } });
    expect(c.getInput()).toMatchObject({ otaOffer: null, otaApply: null });
    expect(c.getInput().shellManual).toEqual({ version: '2.26.10.7.1', currentVersion: '2.26.10.1.1', downloadUrl: 'https://x/y.pkg' });
    expect(c.getState().action).toBe('open-download-page');
  });

  it('unsubscribes', () => {
    const c = createUpdateCoordinator();
    const seen = vi.fn();
    c.subscribe(seen)();
    c.feed({ ota: { phase: 'available', version: 'ui' } });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('resolveApplyAction: a click runs only what the state still offers', () => {
  // One state per action the ladder can offer, plus an apply in flight.
  const states = {
    relaunch: state({ shell: shell('ready-to-install', { targetVersion: 'v' }), ota: { phase: 'available', version: 'ui' } }),
    reload: state({ ota: { phase: 'available', version: 'ui' } }),
    retry: state({ shell: shell('failed', { targetVersion: 'v', recoverable: true }) }),
    download: state({ shell: shell('available', { mode: 'manual', targetVersion: 'v' }) }),
    'open-download-page': state({ shellManual: { version: 'v' } }),
    applying: state({ ota: { phase: 'downloading', version: 'ui' } }),
    idle: state({}),
  } as const;
  const clicks = ['relaunch', 'reload', 'retry', 'download'] as const;

  it('offers each state the action the ladder picks', () => {
    expect(states.relaunch.action).toBe('relaunch');
    expect(states.reload.action).toBe('reload');
    expect(states.retry.action).toBe('retry');
    expect(states.download.action).toBe('download');
    expect(states['open-download-page'].action).toBe('open-download-page');
    expect(states.applying.action).toBeNull();
  });

  // Rows: the state the click lands on. Columns: the clicked action.
  const table: Record<keyof typeof states, Record<(typeof clicks)[number], string>> = {
    relaunch:             { relaunch: 'relaunch', reload: 'reload', retry: 'stale',  download: 'stale' },
    reload:               { relaunch: 'stale',    reload: 'reload', retry: 'stale',  download: 'stale' },
    retry:                { relaunch: 'stale',    reload: 'stale',  retry: 'retry',  download: 'stale' },
    download:             { relaunch: 'stale',    reload: 'stale',  retry: 'stale',  download: 'download' },
    'open-download-page': { relaunch: 'stale',    reload: 'stale',  retry: 'stale',  download: 'stale' },
    applying:             { relaunch: 'stale',    reload: 'stale',  retry: 'stale',  download: 'stale' },
    idle:                 { relaunch: 'stale',    reload: 'stale',  retry: 'stale',  download: 'stale' },
  };
  for (const [name, row] of Object.entries(table)) {
    for (const click of clicks) {
      it(`a ${click} click on a ${name} state runs ${row[click]}`, () => {
        expect(resolveApplyAction(states[name as keyof typeof states], click)).toBe(row[click]);
      });
    }
  }

  it('never relaunches for anything but a relaunch click', () => {
    for (const click of ['reload', 'retry', 'download', 'open-download-page', null, 'nonsense'] as const) {
      expect(resolveApplyAction(states.relaunch, click)).not.toBe('relaunch');
    }
  });

  it('a renderer that names nothing gets what the state offers now', () => {
    expect(resolveApplyAction(states.relaunch)).toBe('relaunch');
    expect(resolveApplyAction(states.reload)).toBe('reload');
    expect(resolveApplyAction(states['open-download-page'])).toBeNull();
    expect(resolveApplyAction(states.idle)).toBeNull();
  });

  it('the installer page is the renderer\'s own, and an unknown action is stale', () => {
    expect(resolveApplyAction(states['open-download-page'], 'open-download-page')).toBeNull();
    expect(resolveApplyAction(states.reload, null)).toBeNull();
    expect(resolveApplyAction(states.reload, 'format-disk')).toBe('stale');
  });

  it('the reload behind a dismissed manual notice still runs by name', () => {
    const behindNotice = state({ ota: { phase: 'available', version: 'ui' }, shellManual: { version: 'v' } });
    expect(behindNotice.action).toBe('open-download-page');
    expect(resolveApplyAction(behindNotice, 'reload')).toBe('reload');
  });
});

describe('createUpdateCoordinator: revision', () => {
  it('numbers each change, and only changes', () => {
    const c = createUpdateCoordinator();
    const start = c.getState().revision;
    expect(start).toBe(0);
    c.feed({ shell: shell('checking') });
    expect(c.getState().revision).toBe(1);
    c.feed({ shell: shell('checking') });
    expect(c.getState().revision).toBe(1);
    c.feed({ ota: { phase: 'available', version: 'ui' } });
    expect(c.getState().revision).toBe(2);
  });

  it('the pure reducer carries no revision', () => {
    expect(state({}).revision).toBeUndefined();
  });
});

// ---- the two OTA inputs ------------------------------------------------------

describe('an offer and an apply never overwrite each other', () => {
  it('an offer found mid-apply waits behind the progress, and shows once it settles', () => {
    const during = state({ otaOffer: offer('2.26.10.8.1'), otaApply: { phase: 'downloading', version: '2.26.10.7.1' } });
    expect(during).toMatchObject({ applying: 'downloading', action: null, ui: { status: 'applying', version: '2.26.10.7.1' } });
    const input = { ...EMPTY_UPDATE_INPUT, otaOffer: offer('2.26.10.8.1'), otaApply: { phase: 'reloading' as const } };
    const after = coordinateUpdates({ ...input, ...settledApplyInput(input) });
    expect(after).toMatchObject({ applying: null, action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
  });

  it('a failed apply shows until an offer for another version arrives, whose Restart is the retry', () => {
    expect(state({ otaOffer: offer('2.26.10.7.1'), otaApply: { phase: 'error', version: '2.26.10.7.1' } }))
      .toMatchObject({ action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: '2.26.10.7.1' } });
    expect(state({ otaOffer: offer('2.26.10.8.1'), otaApply: { phase: 'error', version: '2.26.10.7.1' } }))
      .toMatchObject({ action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
  });

  it('a rolled-back bundle stays a failure with nothing to click, unless a newer UI is offered', () => {
    expect(state({ otaApply: { phase: 'rolled-back', version: '2.26.10.7.1' } }))
      .toMatchObject({ action: null, ui: { status: 'failed', error: 'rolled-back' } });
    expect(state({ otaOffer: offer('2.26.10.8.1'), otaApply: { phase: 'rolled-back', version: '2.26.10.7.1' } }))
      .toMatchObject({ action: 'reload', ui: { status: 'ready', version: '2.26.10.8.1' } });
  });

  it('a server offer reads as applying while the server updater installs it', () => {
    expect(state({ otaOffer: offer(null, '0.26.10.7.1'), server: { phase: 'restarting' } }).server.status).toBe('applying');
  });
});

describe('offerAfterCheck: each channel that answered decides its own layer', () => {
  const found = { ui: { updateAvailable: true, newVersion: '2.26.10.7.1' }, server: { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'cowork-server' as const } };

  it('a channel that found something offers it, and one that found nothing clears its layer', () => {
    expect(offerAfterCheck(null, found)).toEqual(offer('2.26.10.7.1', '0.26.10.7.1', 'cowork-server'));
    expect(offerAfterCheck(offer('2.26.10.7.1', '0.26.10.7.1'), { ui: { updateAvailable: false }, server: { updateAvailable: false } })).toBeNull();
  });

  it('a channel that errored keeps the offer it had (round four, finding 1)', () => {
    const prev = offerAfterCheck(null, found);
    expect(offerAfterCheck(prev, { ...found, server: { updateAvailable: false, error: true } })).toEqual(prev);
    expect(offerAfterCheck(prev, { ui: { updateAvailable: false, error: true }, server: { updateAvailable: false } }))
      .toEqual(offer('2.26.10.7.1', null));
  });

  it('a channel that was not checked keeps its offer', () => {
    expect(offerAfterCheck(offer('2.26.10.7.1'), { server: { updateAvailable: false } })).toEqual(offer('2.26.10.7.1'));
  });
});

describe('offerAfterApply: what an apply used up', () => {
  it('a landed layer is no longer offered; one the apply did not try stands', () => {
    expect(offerAfterApply(offer('X', 'Y'), { server: { landed: true, version: 'Y' } })).toEqual(offer('X', null));
    expect(offerAfterApply(offer('X', 'Y'), { ui: { result: 'landed', version: 'X' } })).toEqual(offer(null, 'Y'));
  });

  it('a UI landing keeps the server update a check offered alongside it (round four, finding 3)', () => {
    expect(offerAfterApply(offer('X', 'Y'), { ui: { result: 'landed', version: 'X' } })).toEqual(offer(null, 'Y'));
  });

  it('a newer offer a check made meanwhile stands', () => {
    expect(offerAfterApply(offer('B'), { ui: { result: 'landed', version: 'A' } })).toEqual(offer('B'));
    expect(offerAfterApply(offer('B'), { ui: { result: 'nothing', version: 'A' } })).toEqual(offer('B'));
  });

  it('an apply that found nothing to apply drops the stale offer, so Restart cannot loop (round four, finding 4)', () => {
    expect(offerAfterApply(offer('X'), { ui: { result: 'nothing', version: 'X' } })).toBeNull();
  });

  it('a rolled-back UI drops its offer; a failed download keeps it for the retry', () => {
    expect(offerAfterApply(offer('X'), { ui: { result: 'rolled-back', version: 'X' } })).toBeNull();
    expect(offerAfterApply(offer('X'), { ui: { result: 'failed', version: 'X' } })).toEqual(offer('X'));
  });

  it('an offer with no version is the one the apply answered', () => {
    expect(offerAfterApply({ ui: {}, server: null }, { ui: { result: 'landed', version: 'X' } })).toBeNull();
  });
});

describe('pollOfferCheck: what a boot or periodic poll offers', () => {
  // The scenario table from docs/update-behavior.md, as the offer each poll
  // leaves for the reducer.
  const uiFound = { updateAvailable: true, newVersion: '2.26.10.7.1' };
  const uiNone = { updateAvailable: false };
  const serverFound = { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'cowork-server' as const };
  const serverNone = { updateAvailable: false };
  const after = (input: Parameters<typeof pollOfferCheck>[0], shellSnap: ShellSnapshot | null = null) =>
    state({ shell: shellSnap, otaOffer: offerAfterCheck(null, pollOfferCheck(input)) });

  it('everything current: nothing offered', () => {
    expect(after({ ui: uiNone, server: serverNone, surfaceServer: false, applyServer: false, applyUi: false }).action).toBeNull();
  });

  it('OTA only, mid-session: one reload naming the UI', () => {
    expect(after({ ui: uiFound, server: serverNone, surfaceServer: false, applyServer: false, applyUi: false }))
      .toMatchObject({ action: 'reload', version: '2.26.10.7.1', ui: { status: 'ready' }, server: { status: 'idle' } });
  });

  it('server + UI, mid-session: one reload naming both layers', () => {
    expect(after({ ui: uiFound, server: serverFound, surfaceServer: true, applyServer: false, applyUi: false }))
      .toMatchObject({ action: 'reload', ui: { status: 'ready', version: '2.26.10.7.1' }, server: { status: 'ready', version: '0.26.10.7.1', component: 'cowork-server' } });
  });

  it('a layer the poll auto-applies is not offered on the way in', () => {
    expect(after({ ui: uiFound, server: serverFound, surfaceServer: true, applyServer: true, applyUi: true }).action).toBeNull();
    expect(pollOfferCheck({ ui: uiFound, server: serverFound, surfaceServer: true, applyServer: true, applyUi: false }))
      .toEqual({ ui: uiFound });
  });

  it('a stream repair is never offered mid-session', () => {
    expect(after({ ui: uiNone, server: serverFound, surfaceServer: false, applyServer: false, applyUi: false }).action).toBeNull();
  });

  it('manifest host down: the UI is not reported, the server still is', () => {
    expect(pollOfferCheck({ ui: null, server: serverFound, surfaceServer: true, applyServer: false, applyUi: false }))
      .toEqual({ server: { ...serverFound, updateAvailable: true } });
    expect(offerAfterCheck(offer('2.26.10.7.1'), pollOfferCheck({ ui: null, server: serverNone, surfaceServer: false, applyServer: false, applyUi: false })))
      .toEqual(offer('2.26.10.7.1'));
  });

  it('all three pending: the relaunch owns the action, the OTA stays offered behind it', () => {
    const s = after({ ui: uiFound, server: serverFound, surfaceServer: true, applyServer: false, applyUi: false }, shell('ready-to-install', { targetVersion: '2.26.10.9.1' }));
    expect(s).toMatchObject({ action: 'relaunch', version: '2.26.10.9.1' });
    expect(resolveApplyAction(s, 'reload')).toBe('reload');
  });

  it('a stranded shell install at boot: applying, and an OTA offer does not displace it', () => {
    const s = after({ ui: uiFound, server: serverNone, surfaceServer: false, applyServer: false, applyUi: false }, shell('installing', { targetVersion: '2.26.10.9.1', installSource: 'boot' }));
    expect(s).toMatchObject({ applying: 'installing', action: null });
  });
});

describe('legacyAvailableOffer: an older main\'s `available`', () => {
  it('a UI and a server update named only by version and serverUpdate are both offered (round four, finding 5)', () => {
    expect(legacyAvailableOffer({ phase: 'available', version: '2.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server' }))
      .toEqual(offer('2.26.10.7.1', '0.26.10.7.1', 'cowork-server'));
    const c = createUpdateCoordinator();
    c.feed({ ota: { phase: 'available', version: '2.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server' } });
    expect(c.getState()).toMatchObject({ version: '2.26.10.7.1', ui: { status: 'ready', version: '2.26.10.7.1' }, server: { status: 'ready', version: '0.26.10.7.1' } });
  });

  it('a server-only update names the server, bare or labelled', () => {
    expect(legacyAvailableOffer({ phase: 'available', version: '0.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1' }))
      .toEqual(offer(null, '0.26.10.7.1'));
    expect(legacyAvailableOffer({ phase: 'available', version: 'anton-agent 0.26.10.7.1', serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'anton-agent' }))
      .toEqual(offer(null, '0.26.10.7.1', 'anton-agent'));
    expect(legacyAvailableOffer({ phase: 'available', serverUpdate: true, serverVersion: '0.26.10.7.1' })).toEqual(offer(null, '0.26.10.7.1'));
  });

  it('no server update means a UI update, with or without a version; explicit fields win', () => {
    expect(legacyAvailableOffer({ phase: 'available', version: '2.26.10.7.1' })).toEqual(offer('2.26.10.7.1'));
    expect(legacyAvailableOffer({ phase: 'available' })).toEqual({ ui: {}, server: null });
    expect(legacyAvailableOffer({ phase: 'available', version: 'v', uiUpdate: false, serverUpdate: true, serverVersion: 's' })).toEqual(offer(null, 's'));
  });

  it('round-trips the status main builds for an offer', () => {
    for (const o of [offer('X'), offer(null, 'Y', 'anton-agent'), offer('X', 'Y', 'cowork-server')]) {
      expect(legacyAvailableOffer(legacyOfferStatus(o))).toEqual(o);
    }
    expect(legacyOfferStatus(null)).toEqual({ phase: 'idle' });
  });

  it('splits every legacy status into the input it speaks for', () => {
    expect(legacyOtaInput({ phase: 'idle' })).toEqual({ otaOffer: null });
    expect(legacyOtaInput({ phase: 'reloading' })).toEqual({ otaApply: { phase: 'reloading' } });
    expect(legacyOtaInput({ phase: 'error', version: 'v' })).toEqual({ otaApply: { phase: 'error', version: 'v' } });
    expect(legacyOtaInput({ phase: 'shell-available' })).toEqual({ shellManual: null });
    expect(legacyOtaInput(null)).toEqual({ otaOffer: null, otaApply: null });
  });
});

describe('availableStatus', () => {
  it('names each layer and keeps the legacy version for older renderers', () => {
    expect(availableStatus({ updateAvailable: true, newVersion: '2.26.10.7.1' }, { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'cowork-server' })).toEqual({
      phase: 'available', version: '2.26.10.7.1', uiUpdate: true, uiVersion: '2.26.10.7.1',
      serverUpdate: true, serverVersion: '0.26.10.7.1', serverComponent: 'cowork-server',
    });
    expect(availableStatus({ updateAvailable: false }, { updateAvailable: true, latestVersion: '0.26.10.7.1', component: 'anton-agent' }))
      .toMatchObject({ version: 'anton-agent 0.26.10.7.1', uiUpdate: false, uiVersion: undefined });
  });
});

describe('checkFromSummary: what an older shell\'s check summary can vouch for', () => {
  const base = { ok: true, updateAvailable: true, uiUpdateAvailable: false, serverUpdateAvailable: false };
  it('nothing found anywhere, and nothing errored: both channels answered no', () => {
    expect(checkFromSummary({ ...base, updateAvailable: false })).toEqual({ ui: { updateAvailable: false }, server: { updateAvailable: false } });
  });
  it('a channel reported found is an answer; one left out may have errored, so it keeps its offer', () => {
    const check = checkFromSummary({ ...base, uiUpdateAvailable: true, uiVersion: '2.26.10.7.1' });
    expect(check).toEqual({ ui: { updateAvailable: true, newVersion: '2.26.10.7.1' } });
    expect(offerAfterCheck(offer(null, '0.26.10.7.1'), check)).toEqual(offer('2.26.10.7.1', '0.26.10.7.1'));
  });
  it('an inconclusive summary says nothing', () => {
    expect(checkFromSummary({ ...base, ok: false, updateAvailable: false })).toEqual({});
  });
});

describe('manualNoticeAfterCheck: the installer notice', () => {
  const notice = { version: '2.26.12.1.1', currentVersion: '2.26.9.1.1', downloadUrl: 'https://x/y.pkg' };
  it('raised only while the auto-updater is the fallback', () => {
    expect(manualNoticeAfterCheck(null, { available: true, latestVersion: notice.version, currentVersion: notice.currentVersion, downloadUrl: notice.downloadUrl }, true)).toEqual(notice);
    expect(manualNoticeAfterCheck(notice, { available: true, latestVersion: notice.version }, false)).toBeNull();
  });
  it('a check that could not reach the manifest keeps it (round four, finding 2); one that answered no clears it', () => {
    expect(manualNoticeAfterCheck(notice, { available: false, error: true }, true)).toEqual(notice);
    expect(manualNoticeAfterCheck(notice, null, true)).toEqual(notice);
    expect(manualNoticeAfterCheck(notice, { available: false }, true)).toBeNull();
  });
});

describe('settling an apply\'s progress', () => {
  const run = (over: Partial<Parameters<typeof applyProgressSettles>[0]> = {}) => ({ running: false, queued: 0, navigationPending: false, ...over });

  it('a request waiting for the lock owns its progress, whoever settles', () => {
    for (const at of ['navigation', 'apply-end', 'request-end'] as const) {
      expect(applyProgressSettles(run({ queued: 1 }), at)).toBe(false);
    }
  });

  it('a reload that commits settles the running apply; the apply\'s own end waits for that commit', () => {
    expect(applyProgressSettles(run({ running: true, navigationPending: true }), 'navigation')).toBe(true);
    expect(applyProgressSettles(run({ navigationPending: true }), 'apply-end')).toBe(false);
    expect(applyProgressSettles(run(), 'apply-end')).toBe(true);
  });

  it('a request that ends without applying gives its progress up, unless an apply is running', () => {
    expect(applyProgressSettles(run(), 'request-end')).toBe(true);
    expect(applyProgressSettles(run({ running: true }), 'request-end')).toBe(false);
  });

  it('clears only what is in flight: a failure and a server error are what shows next', () => {
    expect(settledApplyInput({ ...EMPTY_UPDATE_INPUT, otaApply: { phase: 'reloading' }, server: { phase: 'restarting' } }))
      .toEqual({ otaApply: null, server: null });
    expect(settledApplyInput({ ...EMPTY_UPDATE_INPUT, otaApply: { phase: 'rolled-back' }, server: { phase: 'error', critical: true } })).toEqual({});
  });
});

describe('dispatchApplyStep: one dispatch for main and the old-shell path', () => {
  const handlers = () => ({
    relaunch: vi.fn(async (): Promise<unknown> => ({ confirm: true, runningTasks: 2 })),
    reload: vi.fn(async (): Promise<unknown> => true),
    retry: vi.fn(async () => ({ phase: 'checking' })),
    download: vi.fn(async () => ({ phase: 'downloading' })),
  });

  it('runs only the chosen step and passes its answer through', async () => {
    const h = handlers();
    expect(await dispatchApplyStep('relaunch', h)).toEqual({ confirm: true, runningTasks: 2 });
    expect(await dispatchApplyStep('reload', h)).toBe(true);
    expect(h.retry).not.toHaveBeenCalled();
    expect(h.download).not.toHaveBeenCalled();
  });

  it('a retry or download succeeds by the phase it reaches', async () => {
    const h = handlers();
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

describe('change detection: only what the surfaces render', () => {
  const downloading = (percent: number, bytesPerSecond: number) => shell('downloading', {
    targetVersion: 'v', progress: { transferred: percent * 10, total: 1000, percent, bytesPerSecond },
  });

  it('a download tick that changes no rendered value is not pushed, but the next pull sees it', () => {
    const c = createUpdateCoordinator();
    const seen = vi.fn();
    c.subscribe(seen);
    c.feed({ shell: downloading(41.2, 1000) });
    expect(seen).toHaveBeenCalledTimes(1);
    c.feed({ shell: downloading(41.4, 1500) });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(c.getState().shell.snapshot?.progress?.bytesPerSecond).toBe(1500);
    expect(c.getState().revision).toBe(1);
    // The rounded percentage moved: that is a new state.
    c.feed({ shell: downloading(42.6, 1500) });
    expect(seen).toHaveBeenCalledTimes(2);
    expect(c.getState().revision).toBe(2);
  });

  it('the key ignores the byte counts and rounds the percentage', () => {
    const a = state({ shell: downloading(41.2, 1000) });
    const b = state({ shell: downloading(41.4, 9000) });
    expect(renderedStateKey(a)).toBe(renderedStateKey(b));
    expect(renderedStateKey(a)).not.toBe(renderedStateKey(state({ shell: downloading(43, 1000) })));
  });
});

describe('round five: a layer is matched by version order, not by exact version', () => {
  const X = '2.26.10.7.1';
  const Y = '2.26.10.8.1';
  const Z = '2.26.10.9.1';

  it('orders CalVer, and falls back to equality for versions it cannot order', () => {
    expect(versionReaches(Y, X)).toBe(true);
    expect(versionReaches(X, X)).toBe(true);
    expect(versionReaches(X, Y)).toBe(false);
    expect(versionReaches(undefined, X)).toBe(false);
    expect(versionReaches(X, undefined)).toBe(true);
    expect(versionReaches('A', 'B')).toBe(false);
    expect(isNewerVersion(Y, X)).toBe(true);
    expect(isNewerVersion(X, X)).toBe(false);
    expect(isNewerVersion(X, Y)).toBe(false);
    expect(isNewerVersion('B', 'A')).toBe(true);
    expect(isNewerVersion(undefined, X)).toBe(false);
  });

  it('a newer release that landed clears the older offer it answered (finding 1)', () => {
    expect(offerAfterApply(offer(X), { ui: { result: 'landed', version: Y } })).toBeNull();
    expect(offerAfterApply(offer(null, '0.26.10.6.1'), { server: { landed: true, version: '0.26.10.7.1' } })).toBeNull();
    // An offer newer than what landed is a check made meanwhile, and stands.
    expect(offerAfterApply(offer(Z), { ui: { result: 'landed', version: Y } })).toEqual(offer(Z));
    // A rolled-back newer release quarantines the older offer too.
    expect(offerAfterApply(offer(X), { ui: { result: 'rolled-back', version: Y } })).toBeNull();
  });

  it('a failed download of a release newer than the offer shows as a failure with a retry (finding 4)', () => {
    const failed = state({ otaOffer: offer(X), otaApply: { phase: 'error', version: Y } });
    expect(failed).toMatchObject({ action: 'reload', ui: { status: 'failed', error: 'apply-failed', version: Y } });
    // Only an offer for a newer release than the failure replaces it.
    expect(state({ otaOffer: offer(Z), otaApply: { phase: 'error', version: Y } })).toMatchObject({ action: 'reload', ui: { status: 'ready', version: Z } });
  });

  it('OTA progress and failures are named by the offer, not the banner version (finding 3)', () => {
    expect(otaOfferVersion(offer(X, '0.26.10.7.1'))).toBe(X);
    expect(otaOfferVersion(offer(null, '0.26.10.7.1'))).toBe('0.26.10.7.1');
    expect(otaOfferVersion(offer(null, '0.26.10.7.1', 'anton-agent'))).toBe('anton-agent 0.26.10.7.1');
    expect(otaOfferVersion(null)).toBeUndefined();
    // With a manual notice the banner names the installer; the offer still names the UI.
    const s = state({ otaOffer: offer(X), shellManual: { version: '2.26.12.1.1' } });
    expect(s.version).toBe('2.26.12.1.1');
    expect(s.ui).toMatchObject({ status: 'ready', version: X });
  });

  it('a failed auto-update behind a manual notice can still be retried by name (finding 6)', () => {
    const s = state({ shell: shell('failed', { recoverable: true }), shellManual: { version: 'v' } });
    expect(s.shell.manual).toBe(true);
    expect(resolveApplyAction(s, 'retry')).toBe('retry');
    expect(resolveApplyAction(state({ shell: shell('failed', { recoverable: false }), shellManual: { version: 'v' } }), 'retry')).toBe('stale');
  });

  it('an apply that ran nothing is stale; a landed server applies even beside a failed UI (finding 5)', () => {
    expect(applyRunResult({ serverTried: false, serverOk: true, ui: { result: 'nothing', version: X } })).toBe('stale');
    expect(applyRunResult({ serverTried: false, serverOk: true })).toBe('stale');
    expect(applyRunResult({ serverTried: false, serverOk: true, ui: { result: 'failed', version: X } })).toBe('failed');
    expect(applyRunResult({ serverTried: false, serverOk: true, ui: { result: 'landed', version: X } })).toBe('applied');
    expect(applyRunResult({ serverTried: false, serverOk: true, ui: { result: 'rolled-back', version: X } })).toBe('applied');
    expect(applyRunResult({ serverTried: true, serverOk: false })).toBe('failed');
    expect(applyRunResult({ serverTried: true, serverOk: true, ui: { result: 'failed', version: X } })).toBe('applied');
  });
});
