import { afterEach, describe, expect, it, vi } from 'vitest';
import { handBackBrowser, registerHandBackViewer, resetHandBack } from './browserHandBack';

afterEach(() => resetHandBack());

describe('handBackBrowser', () => {
  it("is the in-app browser's Done on the desktop", async () => {
    const desktopHandBack = vi.fn(async () => {});
    expect(await handBackBrowser('t-a', { desktop: true, desktopHandBack })).toBe('sent');
    expect(desktopHandBack).toHaveBeenCalledWith('t-a');
  });

  it("is the viewer's Done on the web, sent at once or as soon as the viewer is there", async () => {
    const send = vi.fn();
    const unregister = registerHandBackViewer('t-a', send);
    expect(await handBackBrowser('t-a', { desktop: false })).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    unregister();
    expect(await handBackBrowser('t-a', { desktop: false })).toBe('waiting');
    const later = vi.fn();
    registerHandBackViewer('t-a', later);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('has nothing to hand back with no browser', async () => {
    expect(await handBackBrowser(null, { desktop: false })).toBe('none');
  });
});
