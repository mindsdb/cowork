import { describe, it, expect } from 'vitest';
import { deriveBootStatus } from './boot-status';

describe('deriveBootStatus', () => {
  it('returns null when no boot-time OTA is in flight', () => {
    expect(deriveBootStatus({})).toBeNull();
    expect(deriveBootStatus({ ota: null })).toBeNull();
    expect(deriveBootStatus({ ota: { phase: 'idle' } })).toBeNull();
    // `available`/`error`/`shell-available` are banner concerns, not boot ones.
    expect(deriveBootStatus({ ota: { phase: 'available' } })).toBeNull();
    expect(deriveBootStatus({ ota: { phase: 'error' } })).toBeNull();
    expect(deriveBootStatus({ ota: { phase: 'shell-available' } })).toBeNull();
  });

  it('downloading → "Downloading the latest update…"', () => {
    expect(deriveBootStatus({ ota: { phase: 'downloading' } })).toBe('Downloading the latest update…');
  });

  // ENG-2296's concern, met by copy rather than by reading the shell channel:
  // the last phase the gate waits on must not read as "done", because a shell
  // update may still be pending behind it.
  it('reloading → "Finishing up…", never a completion claim', () => {
    const out = deriveBootStatus({ ota: { phase: 'reloading' } });
    expect(out).toBe('Finishing up…');
    expect(out).not.toBe('Almost ready…');
  });

  // ENG-2764: the boot gate waits on the OTA poll alone. The shell auto-updater
  // downloads on its own timer and installs on quit, so its phases must never
  // reach this line — announcing a download the gate cannot finish is what made
  // the old flow promise an update it then asked the user to apply by hand.
  it('ignores any shell-channel input', () => {
    const shellOnly = { shell: { phase: 'downloading' }, manualShellPending: true };
    expect(deriveBootStatus(shellOnly as never)).toBeNull();
    for (const phase of ['available', 'downloading', 'ready-to-install', 'installing', 'failed']) {
      expect(deriveBootStatus({ ota: { phase: 'reloading' }, shell: { phase } } as never))
        .toBe('Finishing up…');
      expect(deriveBootStatus({ shell: { phase } } as never)).toBeNull();
    }
  });
});
