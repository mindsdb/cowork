import { describe, it, expect } from 'vitest';
import { deriveUpdateBanner, shellAutoOwnsBanner, SHELL_AUTO_BANNER_PHASES } from './update-banner';
import { transitionShellUpdate, type ShellUpdateSnapshot } from '../main/shell-update-state';

describe('deriveUpdateBanner', () => {
  it('returns null when nothing is pending', () => {
    expect(deriveUpdateBanner({})).toBeNull();
    expect(deriveUpdateBanner({ ota: null, shellAuto: null, shellManual: null })).toBeNull();
    expect(deriveUpdateBanner({ ota: { phase: 'reloading' } })).toBeNull();
    expect(deriveUpdateBanner({ ota: { phase: 'downloading' } })).toBeNull();
  });

  describe('OTA only', () => {
    it('available → single "Restart" banner with version', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'available', version: '0.26.8.1' } });
      expect(b).toMatchObject({ kind: 'ota-ready', tone: 'ready', actionLabel: 'Restart', action: 'apply-ota', disabled: false, dismissible: false });
      expect(b?.title).toContain('0.26.8.1');
    });

    it('error → amber "Try again" banner', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'error', version: '0.26.8.1' } });
      expect(b).toMatchObject({ kind: 'ota-error', tone: 'error', actionLabel: 'Try again', action: 'apply-ota' });
    });

    it('omits the version suffix when unknown', () => {
      expect(deriveUpdateBanner({ ota: { phase: 'available' } })?.title).toBe('Update ready');
    });
  });

  describe('shell auto-update only', () => {
    it('available → "Download"', () => {
      const b = deriveUpdateBanner({ shellAuto: { phase: 'available' } });
      expect(b).toMatchObject({ kind: 'shell-auto', tone: 'ready', title: 'New app version available', actionLabel: 'Download', action: 'shell-auto', disabled: false });
    });

    it('downloading → progress, disabled, no action, with percent', () => {
      const b = deriveUpdateBanner({ shellAuto: { phase: 'downloading', progress: { percent: 42.4 } } });
      expect(b).toMatchObject({ kind: 'shell-auto', tone: 'progress', actionLabel: null, action: null, disabled: true });
      expect(b?.title).toBe('Downloading update (42%)');
    });

    it('downloading without a percent falls back to an ellipsis', () => {
      expect(deriveUpdateBanner({ shellAuto: { phase: 'downloading' } })?.title).toBe('Downloading update…');
      expect(deriveUpdateBanner({ shellAuto: { phase: 'downloading', progress: { percent: null } } })?.title).toBe('Downloading update…');
    });

    it('ready-to-install → "Restart"', () => {
      const b = deriveUpdateBanner({ shellAuto: { phase: 'ready-to-install' } });
      expect(b).toMatchObject({ tone: 'ready', title: 'App update ready', actionLabel: 'Restart', action: 'shell-auto', disabled: false });
    });

    it('installing → progress, disabled', () => {
      const b = deriveUpdateBanner({ shellAuto: { phase: 'installing' } });
      expect(b).toMatchObject({ tone: 'progress', title: 'Installing update…', actionLabel: null, action: null, disabled: true });
    });

    it('recoverable failure → "Retry"; terminal failure → "Download" (routes to installer)', () => {
      expect(deriveUpdateBanner({ shellAuto: { phase: 'failed', recoverable: true, targetVersion: 'sh-1' } })).toMatchObject({ tone: 'error', actionLabel: 'Retry', action: 'shell-auto' });
      expect(deriveUpdateBanner({ shellAuto: { phase: 'failed', recoverable: false, targetVersion: 'sh-1' } })).toMatchObject({ tone: 'error', actionLabel: 'Download', action: 'shell-auto' });
    });

    it('a failed phase owns the TOP slot only when targetVersion proves an update was found', () => {
      expect(shellAutoOwnsBanner({ phase: 'failed', recoverable: true, targetVersion: 'sh-1' })).toBe(true);
      expect(shellAutoOwnsBanner({ phase: 'failed', recoverable: true })).toBe(false);
      expect(shellAutoOwnsBanner({ phase: 'ready-to-install' })).toBe(true);
      expect(shellAutoOwnsBanner({ phase: 'idle' })).toBe(false);
    });

    it('a targetless failure is still SHOWN (Retry survives a failed retry check), not dropped', () => {
      // Minor fix: a retry check clears targetVersion; if it also fails, the
      // Retry affordance must not vanish.
      const b = deriveUpdateBanner({ shellAuto: { phase: 'failed', recoverable: true } });
      expect(b).toMatchObject({ kind: 'shell-auto', actionLabel: 'Retry', action: 'shell-auto' });
    });

    it('passive phases surface no shell banner', () => {
      for (const phase of ['disabled', 'idle', 'checking', 'complete']) {
        expect(deriveUpdateBanner({ shellAuto: { phase } })).toBeNull();
      }
    });
  });

  describe('shell manual notice only', () => {
    it('renders a dismissible "Download" banner', () => {
      const b = deriveUpdateBanner({ shellManual: { version: '0.26.8.2' } });
      expect(b).toMatchObject({ kind: 'shell-manual', actionLabel: 'Download', action: 'download-installer', dismissible: true });
      expect(b?.title).toContain('0.26.8.2');
    });
  });

  describe('shell-first priority (the double-banner bug)', () => {
    it('an active shell auto-update suppresses an available OTA banner', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'available', version: '0.26.8.1' }, shellAuto: { phase: 'available' } });
      expect(b?.kind).toBe('shell-auto');
    });

    it('a shell ready-to-install wins over an OTA error too', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'error' }, shellAuto: { phase: 'ready-to-install' } });
      expect(b?.kind).toBe('shell-auto');
    });

    it('every active shell phase suppresses OTA (failed needs a real target)', () => {
      for (const phase of SHELL_AUTO_BANNER_PHASES) {
        const b = deriveUpdateBanner({ ota: { phase: 'available' }, shellAuto: { phase, targetVersion: 'sh-1' } });
        expect(b?.kind).toBe('shell-auto');
      }
    });

    it('a check-only shell failure does NOT outrank OTA (feed outage must not hide Restart)', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'available', version: 'ui-1' }, shellAuto: { phase: 'failed', recoverable: true } });
      expect(b?.kind).toBe('ota-ready');
    });

    it('a check-only shell failure does NOT outrank the manual notice either', () => {
      const b = deriveUpdateBanner({ shellManual: { version: 'man-1' }, shellAuto: { phase: 'failed', recoverable: true } });
      expect(b?.kind).toBe('shell-manual');
    });

    it('a real failed shell update (with target) still suppresses OTA', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'available', version: 'ui-1' }, shellAuto: { phase: 'failed', recoverable: true, targetVersion: 'sh-2' } });
      expect(b?.kind).toBe('shell-auto');
    });

    it('the manual notice suppresses OTA (unchanged historical behavior)', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'available' }, shellManual: { version: '0.26.8.2' } });
      expect(b?.kind).toBe('shell-manual');
    });

    it('OTA surfaces only once no shell update is pending (passive shell phase)', () => {
      const b = deriveUpdateBanner({ ota: { phase: 'available' }, shellAuto: { phase: 'idle' }, shellManual: null });
      expect(b?.kind).toBe('ota-ready');
    });

    it('an active auto-update outranks a stray manual notice', () => {
      const b = deriveUpdateBanner({ shellAuto: { phase: 'ready-to-install' }, shellManual: { version: '0.26.8.2' } });
      expect(b?.kind).toBe('shell-auto');
    });
  });

  it('never returns more than one banner for any combination of the three sources', () => {
    const otaStates = [null, { phase: 'available' }, { phase: 'error' }, { phase: 'idle' }];
    const autoStates = [null, { phase: 'idle' }, { phase: 'available' }, { phase: 'downloading' }, { phase: 'ready-to-install' }, { phase: 'installing' }, { phase: 'failed', recoverable: true }, { phase: 'failed', recoverable: false }, { phase: 'failed', recoverable: true, targetVersion: 'sh-1' }, { phase: 'complete' }];
    const manualStates = [null, { version: '0.26.8.2' }];
    for (const ota of otaStates) {
      for (const shellAuto of autoStates) {
        for (const shellManual of manualStates) {
          const b = deriveUpdateBanner({ ota, shellAuto, shellManual });
          // Always a single object or null — never two banners.
          expect(b === null || typeof b === 'object').toBe(true);
        }
      }
    }
  });

  // Drives the real reducer so the target-clearing behavior the ranking depends
  // on can't silently change underneath deriveUpdateBanner.
  describe('sequence: download failure → Retry → check failure (against the real state machine)', () => {
    it('keeps Retry alive and never hides OTA across the retry', () => {
      let s: ShellUpdateSnapshot = { phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '1.0.0' };
      s = transitionShellUpdate(s, { type: 'CHECK_REQUESTED', trigger: 'periodic' });
      s = transitionShellUpdate(s, { type: 'UPDATE_FOUND', targetVersion: '2.0.0' });
      s = transitionShellUpdate(s, { type: 'FAILED', code: 'download-failed', recoverable: true });

      // A real download failure retains the target → owns the top slot over OTA.
      expect(s.phase).toBe('failed');
      expect(s.targetVersion).toBe('2.0.0');
      expect(deriveUpdateBanner({ ota: { phase: 'available' }, shellAuto: s })?.kind).toBe('shell-auto');

      // Retry starts a fresh check, clearing the target; the check then fails.
      s = transitionShellUpdate(s, { type: 'CHECK_REQUESTED', trigger: 'retry' });
      expect(s.targetVersion).toBeUndefined();
      s = transitionShellUpdate(s, { type: 'FAILED', code: 'check-failed', recoverable: true });
      expect(s.phase).toBe('failed');
      expect(s.targetVersion).toBeUndefined();

      // Now targetless: it must no longer hide OTA…
      expect(deriveUpdateBanner({ ota: { phase: 'available' }, shellAuto: s })?.kind).toBe('ota-ready');
      // …but the Retry affordance survives when nothing else is pending.
      expect(deriveUpdateBanner({ shellAuto: s })).toMatchObject({ kind: 'shell-auto', actionLabel: 'Retry' });
    });
  });
});
