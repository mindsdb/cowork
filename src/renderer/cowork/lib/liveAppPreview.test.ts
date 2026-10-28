import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ revokeLiveAppPreviews: vi.fn(async () => {}) }));
vi.mock('../api', () => api);
import { closeLiveAppPreviews, closeLiveAppPreviewsForSignOut, liveAppPreviewOrigin } from './liveAppPreview';

const realLocation = window.location;
// happy-dom's location is read-only; replace the descriptor for the case.
function at(origin: string) {
  const url = new URL(origin);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { protocol: url.protocol, hostname: url.hostname, port: url.port, origin: url.origin },
  });
}
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
  api.revokeLiveAppPreviews.mockReset().mockResolvedValue(undefined);
  vi.useRealTimers();
});

const state = { state: 'running', slot: 1, launchId: '11111111-1111-4111-8111-111111111111', address: 'http://app1.view.localhost:8080/' };
describe('preview origin', () => {
  it('accepts the exact server-selected slot', () => {
    at('http://cowork.localhost:8080');
    expect(liveAppPreviewOrigin(state)).toBe('http://app1.view.localhost:8080');
  });
  it('follows the web UI to another port', () => {
    at('http://cowork.localhost:8081');
    expect(liveAppPreviewOrigin({ ...state, address: 'http://app1.view.localhost:8081/' })).toBe('http://app1.view.localhost:8081');
    expect(liveAppPreviewOrigin(state)).toBe('');
  });
  it('shows no pane outside the stack web UI', () => {
    at('https://cowork.example.com');
    expect(liveAppPreviewOrigin(state)).toBe('');
  });
  it.each([
    { slot: 0 }, { slot: 17 }, { slot: 1.1 }, { launchId: '' }, { state: 'stopped' },
    { address: 'http://cowork.localhost:8080/' }, { address: 'http://localhost:8000/' },
    { address: 'http://app2.view.localhost:8080/' }, { address: 'http://app1.view.localhost:8080/?token=x' },
    { address: 'http://app1.view.localhost:8080/#x' }, { address: 'http://user@app1.view.localhost:8080/' },
    { address: 'http://app1.view.localhost:8080.evil.test/' },
  ])('refuses an invalid launch or address: %s', change => {
    at('http://cowork.localhost:8080');
    expect(liveAppPreviewOrigin({ ...state, ...change })).toBe('');
  });
});

describe('closing previews', () => {
  it('lets an organization switch fail when the revoke does', async () => {
    at('http://cowork.localhost:8080');
    api.revokeLiveAppPreviews.mockRejectedValueOnce(new Error('unavailable'));
    await expect(closeLiveAppPreviews()).rejects.toThrow('unavailable');
  });
  it('never fails sign-out on the revoke', async () => {
    at('http://cowork.localhost:8080');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.revokeLiveAppPreviews.mockRejectedValueOnce(new Error('unavailable'));
    await expect(closeLiveAppPreviewsForSignOut()).resolves.toBeUndefined();
    expect(api.revokeLiveAppPreviews).toHaveBeenCalledOnce();
  });
  it('never waits on a hung revoke for sign-out', async () => {
    at('http://cowork.localhost:8080');
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.revokeLiveAppPreviews.mockReturnValueOnce(new Promise<void>(() => {}));
    const closing = closeLiveAppPreviewsForSignOut();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(closing).resolves.toBeUndefined();
  });
  it('skips the revoke where previews never run', async () => {
    at('https://cowork.example.com');
    await closeLiveAppPreviewsForSignOut();
    expect(api.revokeLiveAppPreviews).not.toHaveBeenCalled();
  });
});
