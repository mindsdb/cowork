import { describe, it, expect } from 'vitest';
import { deriveBootStatus } from './boot-status';
import { coordinateUpdates, type ShellSnapshot, type UpdateCoordinatorInput } from './update-coordinator';

const shell = (phase: ShellSnapshot['phase']): ShellSnapshot => ({ phase, mode: 'auto', channel: 'prod', currentVersion: '1' });
const from = (input: Partial<UpdateCoordinatorInput>) => deriveBootStatus(coordinateUpdates({ shell: null, ota: null, server: null, shellManual: null, ...input }));

describe('deriveBootStatus', () => {
  it('returns null when no boot-time OTA is in flight', () => {
    expect(deriveBootStatus(null)).toBeNull();
    expect(deriveBootStatus(undefined)).toBeNull();
    expect(from({})).toBeNull();
    expect(from({ ota: { phase: 'idle' } })).toBeNull();
    // `available`/`error`/`shell-available` are banner concerns, not boot ones.
    expect(from({ ota: { phase: 'available' } })).toBeNull();
    expect(from({ ota: { phase: 'error' } })).toBeNull();
    expect(from({ shellManual: { version: 'v' } })).toBeNull();
  });

  it('downloading → "Downloading the latest update…"', () => {
    expect(from({ ota: { phase: 'downloading' } })).toBe('Downloading the latest update…');
  });

  it('reloading → "Finishing up…", never a completion claim', () => {
    const out = from({ ota: { phase: 'reloading' } });
    expect(out).toBe('Finishing up…');
    expect(out).not.toBe('Almost ready…');
  });

  it('ignores a shell update the gate does not apply', () => {
    for (const phase of ['available', 'downloading', 'ready-to-install', 'failed'] as const) {
      expect(from({ ota: { phase: 'reloading' }, shell: shell(phase) })).toBe('Finishing up…');
      expect(from({ shell: shell(phase) })).toBeNull();
    }
  });

  it('installing → says the app will reopen, over any OTA line', () => {
    const installing = 'Installing the update — Cowork will reopen…';
    expect(from({ shell: shell('installing') })).toBe(installing);
    expect(from({ ota: { phase: 'downloading' }, shell: shell('installing') })).toBe(installing);
  });
});
