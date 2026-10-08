import { describe, it, expect } from 'vitest';
import { deriveUpdateBanner, debInstallStep, SHELL_AUTO_BANNER_PHASES } from './update-banner';
import { coordinateUpdates, type ShellSnapshot, type UpdateCoordinatorInput } from './update-coordinator';
import { transitionShellUpdate, type ShellUpdateSnapshot } from '../main/shell-update-state';

// Every case drives the real reducer, so the banner is asserted against the
// state the sidebar and Settings actually receive.
type Loose = { ota?: Partial<UpdateCoordinatorInput['ota']> | null; shellAuto?: Partial<ShellSnapshot> | null; shellManual?: { version?: string; debInstaller?: boolean } | null };
function bannerFor(input: Loose, options: { dismissed?: string | null } = {}) {
  const shell = input.shellAuto
    ? { mode: 'auto' as const, channel: 'prod' as const, currentVersion: '1.0.0', ...input.shellAuto } as ShellSnapshot
    : null;
  const state = coordinateUpdates({
    shell,
    ota: (input.ota as UpdateCoordinatorInput['ota']) ?? null,
    server: null,
    shellManual: input.shellManual?.version ? { version: input.shellManual.version } : null,
  });
  return deriveUpdateBanner(state, { debInstaller: input.shellManual?.debInstaller, dismissedManualVersion: options.dismissed ?? null });
}

describe('deriveUpdateBanner', () => {
  it('returns null when nothing is pending', () => {
    expect(deriveUpdateBanner(null)).toBeNull();
    expect(bannerFor({})).toBeNull();
    expect(bannerFor({ ota: null, shellAuto: null, shellManual: null })).toBeNull();
    expect(bannerFor({ ota: { phase: 'reloading' } })).toBeNull();
    expect(bannerFor({ ota: { phase: 'downloading' } })).toBeNull();
  });

  describe('OTA only', () => {
    it('available → single "Restart now" banner, layer-agnostic title', () => {
      const b = bannerFor({ ota: { phase: 'available', version: '0.26.8.1' } });
      expect(b).toMatchObject({ kind: 'ota-ready', tone: 'ready', title: 'Update ready', actionLabel: 'Restart now', action: 'reload', disabled: false, dismissible: false, version: '0.26.8.1' });
    });

    it('error → amber "Try again" banner', () => {
      const b = bannerFor({ ota: { phase: 'error', version: '0.26.8.1' } });
      expect(b).toMatchObject({ kind: 'ota-error', tone: 'error', actionLabel: 'Try again', action: 'reload' });
      expect(b?.title).toContain('0.26.8.1');
    });

    it('names the server component when that is what moves', () => {
      const b = bannerFor({ ota: { phase: 'available', serverUpdate: true, serverVersion: '0.26.8.1', serverComponent: 'anton-agent' } });
      expect(b?.version).toBe('anton-agent 0.26.8.1');
    });

    it('ota-ready hints the next-launch path; ota-error does not', () => {
      expect(bannerFor({ ota: { phase: 'available', version: '0.26.8.1' } })?.hint)
        .toBe('Restarts the app to finish updating to 0.26.8.1. It also applies on its own the next time you open the app.');
      expect(bannerFor({ ota: { phase: 'available' } })?.hint).toContain('the next time you open the app');
      expect(bannerFor({ ota: { phase: 'error', version: 'ui-1' } })?.hint).toBeUndefined();
    });
  });

  describe('shell auto-update only', () => {
    it('available → "Download"', () => {
      const b = bannerFor({ shellAuto: { phase: 'available' } });
      expect(b).toMatchObject({ kind: 'shell-auto', tone: 'ready', title: 'New version available', actionLabel: 'Download', action: 'download', disabled: false });
    });

    it('downloading → progress, disabled, no action, with percent', () => {
      const b = bannerFor({ shellAuto: { phase: 'downloading', progress: { percent: 42.4 } } });
      expect(b).toMatchObject({ kind: 'shell-auto', tone: 'progress', actionLabel: null, action: null, disabled: true });
      expect(b?.title).toBe('Downloading update (42%)');
    });

    it('downloading without a percent falls back to an ellipsis', () => {
      expect(bannerFor({ shellAuto: { phase: 'downloading' } })?.title).toBe('Downloading update…');
      expect(bannerFor({ shellAuto: { phase: 'downloading', progress: { percent: null } } })?.title).toBe('Downloading update…');
    });

    it('ready-to-install → "Restart now", the same words as the OTA restart', () => {
      const b = bannerFor({ shellAuto: { phase: 'ready-to-install' } });
      expect(b).toMatchObject({ tone: 'ready', title: 'Update ready', actionLabel: 'Restart now', action: 'relaunch', disabled: false });
    });

    it('ready-to-install after an aborted install says why and offers Try again', () => {
      const b = bannerFor({ shellAuto: {
        phase: 'ready-to-install', mode: 'auto', targetVersion: '25.9.1',
        errorCode: 'update-request-failed', errorMessage: 'installer launch failed',
      } });
      expect(b).toMatchObject({ tone: 'error', title: 'Last restart attempt failed', actionLabel: 'Try again', action: 'relaunch', disabled: false });
      expect(b?.hint).toBe('Last restart attempt failed: installer launch failed. The update is still downloaded. Try again to restart.');
      // No message: still says it failed, still offers the retry.
      expect(bannerFor({ shellAuto: { phase: 'ready-to-install', errorCode: 'update-request-failed' } })?.hint)
        .toBe('The last restart attempt failed. The update is still downloaded. Try again to restart.');
    });

    it('ready-to-install in auto mode hints the install-on-quit path', () => {
      expect(bannerFor({ shellAuto: { phase: 'ready-to-install', mode: 'auto', targetVersion: '25.9.1' } })?.hint)
        .toBe('The new version (25.9.1) is downloaded. Restart now to use it, or it installs on its own the next time you quit the app.');
      expect(bannerFor({ shellAuto: { phase: 'ready-to-install', mode: 'auto' } })?.hint).toContain('the next time you quit the app');
    });

    it('ready-to-install in manual mode promises no install on quit', () => {
      expect(bannerFor({ shellAuto: { phase: 'ready-to-install', mode: 'manual', targetVersion: '25.9.1' } })?.hint).toBeUndefined();
    });

    it('no hint on in-flight or failed shell phases', () => {
      for (const phase of ['available', 'downloading', 'installing'] as const) {
        expect(bannerFor({ shellAuto: { phase } })?.hint).toBeUndefined();
      }
      expect(bannerFor({ shellAuto: { phase: 'failed', recoverable: true, targetVersion: 'sh-1' } })?.hint).toBeUndefined();
    });

    it('installing → progress, disabled', () => {
      const b = bannerFor({ shellAuto: { phase: 'installing' } });
      expect(b).toMatchObject({ tone: 'progress', title: 'Installing update…', actionLabel: null, action: null, disabled: true });
    });

    it('recoverable failure → "Retry"; terminal failure → "Download" (routes to installer page)', () => {
      expect(bannerFor({ shellAuto: { phase: 'failed', recoverable: true, targetVersion: 'sh-1' } })).toMatchObject({ tone: 'error', title: 'Update failed', actionLabel: 'Retry', action: 'retry' });
      expect(bannerFor({ shellAuto: { phase: 'failed', recoverable: false, targetVersion: 'sh-1' } })).toMatchObject({ tone: 'error', title: 'Update failed', actionLabel: 'Download', action: 'open-download-page', dismissible: false });
    });

    it('a targetless failure is still SHOWN (Retry survives a failed retry check), not dropped', () => {
      const b = bannerFor({ shellAuto: { phase: 'failed', recoverable: true } });
      expect(b).toMatchObject({ kind: 'shell-auto', actionLabel: 'Retry', action: 'retry' });
    });

    it('passive phases surface no shell banner', () => {
      for (const phase of ['disabled', 'idle', 'checking', 'complete'] as const) {
        expect(bannerFor({ shellAuto: { phase } })).toBeNull();
      }
    });
  });

  describe('shell manual notice only', () => {
    it('renders a dismissible "Download" banner', () => {
      const b = bannerFor({ shellManual: { version: '0.26.8.2' } });
      expect(b).toMatchObject({ kind: 'shell-manual', actionLabel: 'Download', action: 'open-download-page', dismissible: true });
      expect(b?.title).toContain('0.26.8.2');
    });

    it('is the only banner a dismissal can hide, per version', () => {
      expect(bannerFor({ shellManual: { version: '0.26.8.2' } }, { dismissed: '0.26.8.2' })).toBeNull();
      expect(bannerFor({ shellManual: { version: '0.26.8.3' } }, { dismissed: '0.26.8.2' })?.kind).toBe('shell-manual');
      expect(bannerFor({ shellAuto: { phase: 'ready-to-install', targetVersion: 'v' } }, { dismissed: 'v' })?.kind).toBe('shell-auto');
    });

    it('carries the caller\'s .deb flag so both surfaces name the real install step', () => {
      expect(bannerFor({ shellManual: { version: '0.26.8.2', debInstaller: true } })?.debInstaller).toBe(true);
      expect(bannerFor({ shellManual: { version: '0.26.8.2', debInstaller: false } })?.debInstaller).toBe(false);
      expect(bannerFor({ shellManual: { version: '0.26.8.2' } })?.debInstaller).toBe(false);
    });
  });

  describe('debInstallStep', () => {
    it('narrows the glob to the offered version, so a stale .deb in the same folder is not swept in', () => {
      expect(debInstallStep('2.26.9.7.1')).toBe('run sudo apt install ./mindshub-cowork-2.26.9.7.1*.deb from the directory you downloaded it to');
    });

    it('falls back to the bare glob when the version is unknown', () => {
      expect(debInstallStep()).toBe('run sudo apt install ./mindshub-cowork-*.deb from the directory you downloaded it to');
    });
  });

  describe('shell-first priority (the double-banner bug)', () => {
    it('an active shell auto-update suppresses an available OTA banner', () => {
      expect(bannerFor({ ota: { phase: 'available', version: '0.26.8.1' }, shellAuto: { phase: 'available' } })?.kind).toBe('shell-auto');
    });

    it('a shell ready-to-install wins over an OTA error too', () => {
      expect(bannerFor({ ota: { phase: 'error' }, shellAuto: { phase: 'ready-to-install' } })?.kind).toBe('shell-auto');
    });

    it('every active shell phase suppresses OTA (failed needs a real target)', () => {
      for (const phase of SHELL_AUTO_BANNER_PHASES) {
        expect(bannerFor({ ota: { phase: 'available' }, shellAuto: { phase, targetVersion: 'sh-1' } })?.kind).toBe('shell-auto');
      }
    });

    it('a check-only shell failure does NOT outrank OTA (feed outage must not hide Restart)', () => {
      expect(bannerFor({ ota: { phase: 'available', version: 'ui-1' }, shellAuto: { phase: 'failed', recoverable: true } })?.kind).toBe('ota-ready');
    });

    it('a check that produced no answer raises no banner at all, while a rejected check still offers Retry', () => {
      expect(bannerFor({ shellAuto: { phase: 'failed', recoverable: true, errorCode: 'check-stalled' } })).toBeNull();
      expect(bannerFor({ shellAuto: { phase: 'failed', recoverable: true, errorCode: 'download-stalled', targetVersion: 'sh-1' } }))
        .toMatchObject({ tone: 'error', actionLabel: 'Retry' });
      expect(bannerFor({ shellAuto: { phase: 'failed', recoverable: true, errorCode: 'update-request-failed' } }))
        .toMatchObject({ tone: 'error', actionLabel: 'Retry' });
    });

    it('a check-only shell failure does NOT outrank the manual notice either', () => {
      expect(bannerFor({ shellManual: { version: 'man-1' }, shellAuto: { phase: 'failed', recoverable: true } })?.kind).toBe('shell-manual');
    });

    it('a real failed shell update (with target) still suppresses OTA', () => {
      expect(bannerFor({ ota: { phase: 'available', version: 'ui-1' }, shellAuto: { phase: 'failed', recoverable: true, targetVersion: 'sh-2' } })?.kind).toBe('shell-auto');
    });

    it('the manual notice suppresses OTA (unchanged historical behavior)', () => {
      expect(bannerFor({ ota: { phase: 'available' }, shellManual: { version: '0.26.8.2' } })?.kind).toBe('shell-manual');
    });

    it('OTA surfaces only once no shell update is pending (passive shell phase)', () => {
      expect(bannerFor({ ota: { phase: 'available' }, shellAuto: { phase: 'idle' }, shellManual: null })?.kind).toBe('ota-ready');
    });

    it('an active auto-update outranks a stray manual notice', () => {
      expect(bannerFor({ shellAuto: { phase: 'ready-to-install' }, shellManual: { version: '0.26.8.2' } })?.kind).toBe('shell-auto');
    });
  });

  it('never returns more than one banner, and at most one restart, for any combination of the three sources', () => {
    const otaStates = [null, { phase: 'available' as const, version: 'ui' }, { phase: 'error' as const }, { phase: 'idle' as const }];
    const autoStates: Array<Partial<ShellSnapshot> | null> = [null, { phase: 'idle' }, { phase: 'available' }, { phase: 'downloading' }, { phase: 'ready-to-install' }, { phase: 'installing' }, { phase: 'failed', recoverable: true }, { phase: 'failed', recoverable: false }, { phase: 'failed', recoverable: true, targetVersion: 'sh-1' }, { phase: 'complete' }];
    const manualStates = [null, { version: '0.26.8.2' }];
    for (const ota of otaStates) {
      for (const shellAuto of autoStates) {
        for (const shellManual of manualStates) {
          const b = bannerFor({ ota, shellAuto, shellManual });
          expect(b === null || typeof b === 'object').toBe(true);
          if (b?.actionLabel === 'Restart now') expect(['reload', 'relaunch']).toContain(b.action);
        }
      }
    }
  });

  // Drives the real shell reducer so the target-clearing behavior the ranking
  // depends on can't silently change underneath the coordinator.
  describe('sequence: download failure → Retry → check failure (against the real state machine)', () => {
    it('keeps Retry alive and never hides OTA across the retry', () => {
      let s: ShellUpdateSnapshot = { phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '1.0.0' };
      s = transitionShellUpdate(s, { type: 'CHECK_REQUESTED', trigger: 'periodic' });
      s = transitionShellUpdate(s, { type: 'UPDATE_FOUND', targetVersion: '2.0.0' });
      s = transitionShellUpdate(s, { type: 'FAILED', code: 'download-failed', recoverable: true });

      // A real download failure retains the target → owns the top slot over OTA.
      expect(s.phase).toBe('failed');
      expect(s.targetVersion).toBe('2.0.0');
      expect(bannerFor({ ota: { phase: 'available' }, shellAuto: s })?.kind).toBe('shell-auto');

      // Retry starts a fresh check, clearing the target; the check then fails.
      s = transitionShellUpdate(s, { type: 'CHECK_REQUESTED', trigger: 'retry' });
      expect(s.targetVersion).toBeUndefined();
      s = transitionShellUpdate(s, { type: 'FAILED', code: 'check-failed', recoverable: true });
      expect(s.phase).toBe('failed');

      // Now targetless: it must no longer hide OTA…
      expect(bannerFor({ ota: { phase: 'available' }, shellAuto: s })?.kind).toBe('ota-ready');
      // …but the Retry affordance survives when nothing else is pending.
      expect(bannerFor({ shellAuto: s })).toMatchObject({ kind: 'shell-auto', actionLabel: 'Retry' });
    });
  });
});
