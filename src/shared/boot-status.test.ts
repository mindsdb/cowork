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

  it('reloading → "Finishing up…", never a completion claim', () => {
    const out = deriveBootStatus({ ota: { phase: 'reloading' } });
    expect(out).toBe('Finishing up…');
    expect(out).not.toBe('Almost ready…');
  });

  it('ignores a shell update the gate does not apply', () => {
    const shellOnly = { shell: { phase: 'downloading' }, manualShellPending: true };
    expect(deriveBootStatus(shellOnly as never)).toBeNull();
    for (const phase of ['available', 'downloading', 'ready-to-install', 'failed']) {
      expect(deriveBootStatus({ ota: { phase: 'reloading' }, shell: { phase } })).toBe('Finishing up…');
      expect(deriveBootStatus({ shell: { phase } })).toBeNull();
    }
  });

  it('installing → says the app will reopen, over any OTA line', () => {
    const installing = 'Installing the update — Cowork will reopen…';
    expect(deriveBootStatus({ shell: { phase: 'installing' } })).toBe(installing);
    expect(deriveBootStatus({ ota: { phase: 'downloading' }, shell: { phase: 'installing' } })).toBe(installing);
  });
});
