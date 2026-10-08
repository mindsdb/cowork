import { describe, it, expect, vi } from 'vitest';
import {
  coordinateUpdates,
  createUpdateCoordinator,
  resolveApplyAction,
  shellAutoIsPending,
  type ShellSnapshot,
  type UpdateCoordinatorInput,
} from './update-coordinator';

const shell = (phase: ShellSnapshot['phase'], over: Partial<ShellSnapshot> = {}): ShellSnapshot => ({
  phase, mode: 'auto', channel: 'prod', currentVersion: '2.26.10.1.1', ...over,
});
const state = (input: Partial<UpdateCoordinatorInput>) => coordinateUpdates({ shell: null, ota: null, server: null, shellManual: null, ...input });

describe('coordinateUpdates', () => {
  it('is idle with nothing pending', () => {
    const s = state({});
    expect(s).toMatchObject({ overall: 'idle', action: null, pending: { reload: false, relaunch: false }, applying: null });
    expect(s.shell.status).toBe('idle');
    expect(state({ shell: shell('disabled') }).shell.status).toBe('disabled');
  });

  // The scenario table from docs/update-behavior.md, "Sample scenarios".
  describe('scenarios', () => {
    it('OTA only, found mid-session: one reload', () => {
      const s = state({ ota: { phase: 'available', version: '2.26.10.7.1', uiUpdate: true, uiVersion: '2.26.10.7.1', serverUpdate: false } });
      expect(s).toMatchObject({ overall: 'ready', action: 'reload', pending: { reload: true, relaunch: false }, version: '2.26.10.7.1' });
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
      expect(s).toMatchObject({ overall: 'ready', action: 'relaunch', pending: { reload: true, relaunch: true }, version: '2.26.10.7.1' });
      expect(s.shell).toMatchObject({ status: 'ready', manual: false });
    });

    it('a stranded shell update being installed at boot: applying, no action, the overlay says so', () => {
      const s = state({ shell: shell('installing', { targetVersion: '2.26.10.7.1', installSource: 'boot' }) });
      expect(s).toMatchObject({ overall: 'applying', action: null, applying: 'installing' });
      expect(s.shell.snapshot?.installSource).toBe('boot');
    });

    it('a boot OTA apply: applying through download and reload, with no action', () => {
      expect(state({ ota: { phase: 'downloading', version: '0.26.10.7.1' } })).toMatchObject({ overall: 'applying', applying: 'downloading', action: null });
      expect(state({ ota: { phase: 'reloading' } })).toMatchObject({ overall: 'applying', applying: 'reloading', action: null });
      // A shell download in flight never hides a reload in flight.
      expect(state({ ota: { phase: 'reloading' }, shell: shell('downloading') }).applying).toBe('reloading');
    });

    it('shell only, auto mode: download in flight, then ready', () => {
      const dl = state({ shell: shell('downloading', { targetVersion: '2.26.10.7.1', progress: { percent: 42 } }) });
      expect(dl).toMatchObject({ overall: 'downloading', action: null });
      expect(dl.shell).toMatchObject({ status: 'downloading', progress: { percent: 42 } });
      const ready = state({ shell: shell('ready-to-install', { targetVersion: '2.26.10.7.1' }) });
      expect(ready).toMatchObject({ overall: 'ready', action: 'relaunch', pending: { relaunch: true, reload: false }, version: '2.26.10.7.1' });
    });

    it('shell only, manual mode: an explicit download first', () => {
      expect(state({ shell: shell('available', { mode: 'manual', targetVersion: '2.26.10.7.1' }) })).toMatchObject({ overall: 'ready', action: 'download' });
    });

    it('shell only, auto-update disabled or failed: the manual installer notice', () => {
      const s = state({ shell: shell('disabled', { disabledReason: 'rollout-disabled' }), shellManual: { version: '2.26.10.7.1', downloadUrl: 'https://x/y.pkg' } });
      expect(s).toMatchObject({ overall: 'ready', action: 'open-download-page', version: '2.26.10.7.1' });
      expect(s.shell).toMatchObject({ status: 'available', manual: true, manualDownloadUrl: 'https://x/y.pkg' });
      // The manual notice outranks an OTA, as it always did.
      expect(state({ shellManual: { version: 'v' }, ota: { phase: 'available', version: 'ui' } }).action).toBe('open-download-page');
      // An active auto-update outranks a stray manual notice.
      expect(state({ shellManual: { version: 'v' }, shell: shell('ready-to-install', { targetVersion: 'v' }) })).toMatchObject({ action: 'relaunch', shell: { manual: false } });
    });

    it('a failed shell update with a known target: retry, or the installer when terminal', () => {
      expect(state({ shell: shell('failed', { targetVersion: 'v', recoverable: true }) })).toMatchObject({ overall: 'failed', action: 'retry' });
      expect(state({ shell: shell('failed', { targetVersion: 'v', recoverable: false }) })).toMatchObject({ overall: 'failed', action: 'open-download-page', shell: { manual: false } });
      // It outranks a pending OTA, as a real shell update always has.
      expect(state({ shell: shell('failed', { targetVersion: 'v', recoverable: true }), ota: { phase: 'available', version: 'ui' } }).action).toBe('retry');
    });

    it('a targetless shell failure never hides an OTA restart, but keeps Retry when nothing else is pending', () => {
      const failed = shell('failed', { recoverable: true, errorCode: 'update-request-failed' });
      expect(state({ shell: failed, ota: { phase: 'available', version: 'ui' } })).toMatchObject({ action: 'reload', overall: 'ready' });
      expect(state({ shell: failed, shellManual: { version: 'v' } }).action).toBe('open-download-page');
      expect(state({ shell: failed })).toMatchObject({ action: 'retry', overall: 'failed' });
    });

    it('a check that produced no answer is silent', () => {
      const s = state({ shell: shell('failed', { recoverable: true, errorCode: 'check-stalled' }) });
      expect(s).toMatchObject({ action: null, overall: 'idle', silentShellFailure: true });
    });

    it('a shell check in flight is reported, and does not hide an OTA restart', () => {
      expect(state({ shell: shell('checking') })).toMatchObject({ overall: 'checking', action: null });
      expect(state({ shell: shell('checking'), ota: { phase: 'available', version: 'ui' } }).action).toBe('reload');
    });

    it('a failed OTA apply offers the reload again', () => {
      const s = state({ ota: { phase: 'error', version: '2.26.10.7.1' } });
      expect(s).toMatchObject({ overall: 'failed', action: 'reload' });
      expect(s.ui).toMatchObject({ status: 'failed', error: 'apply-failed', version: '2.26.10.7.1' });
    });

    it('a rolled-back bundle is a failed layer with nothing to click: it is quarantined', () => {
      const s = state({ ota: { phase: 'rolled-back' } });
      expect(s).toMatchObject({ overall: 'failed', action: null });
      expect(s.ui).toMatchObject({ status: 'failed', error: 'rolled-back' });
    });

    it('a server reinstall in flight is applying, and a critical server error is a failed server layer', () => {
      expect(state({ server: { phase: 'downloading', to: '0.26.10.7.1' } }).server).toMatchObject({ status: 'applying', version: '0.26.10.7.1' });
      const s = state({ server: { phase: 'error', critical: true, error: 'rollback failed' } });
      expect(s.server).toMatchObject({ status: 'failed', error: 'rollback failed' });
      expect(s.overall).toBe('failed');
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
    expect(c.getInput().ota).toBeNull();
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
