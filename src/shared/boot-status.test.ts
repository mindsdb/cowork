import { describe, it, expect } from 'vitest';
import { deriveBootStatus } from './boot-status';

describe('deriveBootStatus', () => {
  it('returns null when nothing update-related is in flight', () => {
    expect(deriveBootStatus({})).toBeNull();
    expect(deriveBootStatus({ ota: null, shell: null })).toBeNull();
    expect(deriveBootStatus({ ota: { phase: 'idle' }, shell: { phase: 'idle' } })).toBeNull();
    // `available`/`error`/`shell-available` are banner concerns, not boot ones.
    expect(deriveBootStatus({ ota: { phase: 'available' } })).toBeNull();
    expect(deriveBootStatus({ ota: { phase: 'shell-available' } })).toBeNull();
  });

  describe('OTA only (unchanged behavior)', () => {
    it('downloading → "Downloading the latest update…"', () => {
      expect(deriveBootStatus({ ota: { phase: 'downloading' } })).toBe('Downloading the latest update…');
    });

    it('reloading → "Almost ready…"', () => {
      expect(deriveBootStatus({ ota: { phase: 'reloading' } })).toBe('Almost ready…');
    });
  });

  describe('shell update pending: never signal completion (ENG-2296)', () => {
    // The regression this guards: OTA about to reload while a shell relaunch is
    // still pending used to show "Almost ready…", which reads as done.
    for (const shellPhase of ['available', 'ready-to-install', 'installing']) {
      it(`OTA reloading + shell ${shellPhase} → "Finishing update…", not "Almost ready…"`, () => {
        const out = deriveBootStatus({ ota: { phase: 'reloading' }, shell: { phase: shellPhase } });
        expect(out).toBe('Finishing update…');
        expect(out).not.toBe('Almost ready…');
      });
    }

    it('OTA reloading + shell downloading → "Downloading the latest update…"', () => {
      expect(deriveBootStatus({ ota: { phase: 'reloading' }, shell: { phase: 'downloading' } }))
        .toBe('Downloading the latest update…');
    });

    it('OTA downloading takes priority over any shell phase', () => {
      expect(deriveBootStatus({ ota: { phase: 'downloading' }, shell: { phase: 'ready-to-install' } }))
        .toBe('Downloading the latest update…');
    });
  });

  describe('shell-only progress at boot', () => {
    it('no OTA + shell downloading → "Downloading the latest update…"', () => {
      expect(deriveBootStatus({ shell: { phase: 'downloading' } })).toBe('Downloading the latest update…');
    });

    it('no OTA + shell ready-to-install → null (the sidebar banner owns the restart)', () => {
      expect(deriveBootStatus({ shell: { phase: 'ready-to-install' } })).toBeNull();
    });

    it('a failed shell update does not hold the boot copy hostage', () => {
      expect(deriveBootStatus({ shell: { phase: 'failed' } })).toBeNull();
      expect(deriveBootStatus({ ota: { phase: 'reloading' }, shell: { phase: 'failed' } })).toBe('Almost ready…');
    });
  });

  describe('manual shell-reinstall notice pending (ENG-849 fallback, ENG-2296)', () => {
    // The manual notice fires only when shell auto-update is disabled or
    // terminally failed, so the shell snapshot reads disabled/failed and the
    // phase set alone would miss the outstanding reinstall. The regression: OTA
    // reloading while a manual reinstall is pending used to show "Almost ready…".
    it('OTA reloading + manual notice → "Finishing update…", not "Almost ready…"', () => {
      const out = deriveBootStatus({ ota: { phase: 'reloading' }, manualShellPending: true });
      expect(out).toBe('Finishing update…');
      expect(out).not.toBe('Almost ready…');
    });

    it('OTA reloading + manual notice + disabled auto snapshot → "Finishing update…"', () => {
      expect(deriveBootStatus({
        ota: { phase: 'reloading' },
        shell: { phase: 'disabled' },
        manualShellPending: true,
      })).toBe('Finishing update…');
    });

    it('OTA downloading still takes priority over a pending manual notice', () => {
      expect(deriveBootStatus({ ota: { phase: 'downloading' }, manualShellPending: true }))
        .toBe('Downloading the latest update…');
    });

    it('manual notice alone (no OTA) shows nothing — the sidebar banner owns the reinstall', () => {
      expect(deriveBootStatus({ manualShellPending: true })).toBeNull();
      expect(deriveBootStatus({ shell: { phase: 'disabled' }, manualShellPending: true })).toBeNull();
    });
  });
});
