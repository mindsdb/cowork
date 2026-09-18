import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerRendererPermissions } from './renderer-permissions';

describe('main renderer permissions', () => {
  const setup = (url = 'file:///app/index.html') => {
    const session = { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() };
    const renderer = { session, isDestroyed: () => false, getURL: () => url } as unknown as WebContents;
    registerRendererPermissions(renderer);
    return { renderer, check: session.setPermissionCheckHandler.mock.calls[0][0], request: session.setPermissionRequestHandler.mock.calls[0][0] };
  };
  it.each(['file:///app/index.html', 'http://localhost:5173/'])('allows app notifications for %s through both permission paths', url => {
    const { renderer, check, request } = setup(url);
    const details = { isMainFrame: true, requestingUrl: url };
    expect(check(renderer, 'notifications', '', details)).toBe(true);
    const callback = vi.fn();
    request(renderer, 'notifications', callback, details);
    expect(callback).toHaveBeenCalledWith(true);
  });
  it('rejects embedded pages, other web contents, workers and unrelated permissions', () => {
    const { renderer, check, request } = setup();
    for (const [requester, permission, isMainFrame, requestingUrl] of [
      [renderer, 'notifications', false, 'file:///app/index.html'],
      [renderer, 'notifications', true, 'https://example.com/'],
      [{}, 'notifications', true, 'file:///app/index.html'],
      [null, 'notifications', true, 'file:///app/index.html'],
      [renderer, 'geolocation', true, 'file:///app/index.html'],
    ]) {
      const details = { isMainFrame, requestingUrl };
      expect(check(requester, permission, '', details)).toBe(false);
      const callback = vi.fn();
      request(requester, permission, callback, details);
      expect(callback).toHaveBeenCalledWith(false);
    }
  });
  it('retains microphone support', () => {
    const { renderer, check } = setup();
    expect(check(renderer, 'media', '', {})).toBe(true);
  });
});
