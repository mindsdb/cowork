import { describe, it, expect, beforeEach } from 'vitest';
import { hasBootedBefore, rememberBooted, welcomeFloorMs } from './bootWelcome';

describe('welcomeFloorMs', () => {
  const minMs = 1600;

  // ENG-1232: the whole point — a web session that has booted before pays no
  // artificial floor on refresh, however fast the checks were.
  it('returns 0 on web once the browser has booted before', () => {
    expect(welcomeFloorMs({ isWeb: true, bootedBefore: true, elapsedMs: 0, minMs })).toBe(0);
    expect(welcomeFloorMs({ isWeb: true, bootedBefore: true, elapsedMs: 5000, minMs })).toBe(0);
  });

  it('holds the floor on a first web visit (booted flag not yet set)', () => {
    expect(welcomeFloorMs({ isWeb: true, bootedBefore: false, elapsedMs: 200, minMs })).toBe(1400);
  });

  it('always holds the floor on Electron, even after booting before', () => {
    // Electron stays resident so it rarely re-mounts; keep the polished cold-start
    // floor unchanged there regardless of the booted flag.
    expect(welcomeFloorMs({ isWeb: false, bootedBefore: true, elapsedMs: 100, minMs })).toBe(1500);
    expect(welcomeFloorMs({ isWeb: false, bootedBefore: false, elapsedMs: 100, minMs })).toBe(1500);
  });

  it('never returns negative when the checks already outran the minimum', () => {
    expect(welcomeFloorMs({ isWeb: true, bootedBefore: false, elapsedMs: 2000, minMs })).toBe(0);
    expect(welcomeFloorMs({ isWeb: false, bootedBefore: false, elapsedMs: 2000, minMs })).toBe(0);
  });
});

describe('hasBootedBefore / rememberBooted', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* ignore */ }
  });

  it('is false before the first boot and true after rememberBooted', () => {
    expect(hasBootedBefore()).toBe(false);
    rememberBooted();
    expect(hasBootedBefore()).toBe(true);
  });
});
