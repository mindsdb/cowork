import { describe, expect, it, vi } from 'vitest';

const controlPlane = vi.hoisted(() => ({ origin: 'https://code.example.test' }));
vi.mock('../../platform/host', () => ({ getCodeControlPlaneOrigin: () => controlPlane.origin }));

import { codeControlPlaneReachable, isLoopbackOrigin } from './controlPlane';


describe('isLoopbackOrigin', () => {
  it('recognises every spelling of this machine', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:26866')).toBe(true);
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:8000')).toBe(true);
  });

  it('treats a shared address, or garbage, as not loopback', () => {
    expect(isLoopbackOrigin('https://code.example.test')).toBe(false);
    expect(isLoopbackOrigin('http://192.168.1.20:26866')).toBe(false);
    expect(isLoopbackOrigin('not a url')).toBe(false);
  });
});


describe('codeControlPlaneReachable', () => {
  it('follows the configured control-plane origin', () => {
    controlPlane.origin = 'https://code.example.test';
    expect(codeControlPlaneReachable()).toBe(true);
    controlPlane.origin = 'http://127.0.0.1:26866';
    expect(codeControlPlaneReachable()).toBe(false);
  });
});
