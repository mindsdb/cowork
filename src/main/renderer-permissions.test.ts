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
  it.each(['notifications', 'media'])('rejects %s from embedded pages, other web contents and workers', permission => {
    const { renderer, check, request } = setup();
    for (const [requester, isMainFrame, requestingUrl] of [
      [renderer, false, 'file:///app/index.html'],
      [renderer, false, 'https://example.com/'],
      [renderer, true, 'https://example.com/'],
      [{}, true, 'file:///app/index.html'],
      [null, true, 'file:///app/index.html'],
      [renderer, true, undefined],
    ]) {
      const details = { isMainFrame, requestingUrl };
      expect(check(requester, permission, '', details)).toBe(false);
      const callback = vi.fn();
      request(requester, permission, callback, details);
      expect(callback).toHaveBeenCalledWith(false);
    }
  });
  it('retains microphone support for the main app document only', () => {
    const { renderer, check, request } = setup();
    const details = { isMainFrame: true, requestingUrl: renderer.getURL() };
    expect(check(renderer, 'media', '', details)).toBe(true);
    for (const permission of ['media', 'audioCapture']) {
      const callback = vi.fn();
      request(renderer, permission, callback, details);
      expect(callback).toHaveBeenCalledWith(true);
      callback.mockClear();
      request(renderer, permission, callback, { ...details, isMainFrame: false });
      expect(callback).toHaveBeenCalledWith(false);
    }
  });
  it.each(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'pointerLock', 'openExternal', 'idle-detection', 'storage-access', 'geolocation'])(
    'preserves the existing check/request policy for %s', permission => {
      const { renderer, check, request } = setup();
      const details = { isMainFrame: true, requestingUrl: renderer.getURL() };
      expect(check(renderer, permission, '', details)).toBe(true);
      expect(check(null, permission, '', { isMainFrame: false })).toBe(true);
      const callback = vi.fn();
      request(renderer, permission, callback, details);
      expect(callback).toHaveBeenCalledWith(false);
    },
  );
  it('denies sensitive permissions after the app renderer is destroyed', () => {
    const { renderer, check, request } = setup();
    vi.spyOn(renderer, 'isDestroyed').mockReturnValue(true);
    for (const permission of ['media', 'notifications']) {
      const details = { isMainFrame: true, requestingUrl: renderer.getURL() };
      expect(check(renderer, permission, '', details)).toBe(false);
      const callback = vi.fn();
      request(renderer, permission, callback, details);
      expect(callback).toHaveBeenCalledWith(false);
    }
  });
});
