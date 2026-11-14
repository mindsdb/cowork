import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropHandBack, handBackBrowser, handedBack, registerHandBackViewer, resetHandBack } from './browserHandBack';

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

  it('says when a waiting hand-back went, or the browser came back without it', async () => {
    const order = [];
    expect(await handBackBrowser('t-a', { desktop: false })).toBe('waiting');
    expect(await handBackBrowser('t-b', { desktop: false })).toBe('waiting');
    void handedBack('t-a').then((end) => order.push(`a:${end}`));
    void handedBack('t-b').then((end) => order.push(`b:${end}`));
    await Promise.resolve();
    expect(order).toEqual([]);
    const send = vi.fn();
    registerHandBackViewer('t-a', send);
    // t-b's viewer says the agent holds the browser: nothing to send.
    registerHandBackViewer('t-b', null);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['a:sent', 'b:sent']);
    // Settled: a later viewer gets no stale hand-back.
    const later = vi.fn();
    registerHandBackViewer('t-b', later);
    expect(later).not.toHaveBeenCalled();
  });

  /* The watch handed the browser back before the person's Done reached it:
     a Done kept waiting would hand back Anton's next hand-over unasked. */
  it('leaves nothing waiting while the viewer says the agent holds the browser', async () => {
    const unregister = registerHandBackViewer('t-a', null);
    expect(await handBackBrowser('t-a', { desktop: false })).toBe('sent');
    await expect(handedBack('t-a')).resolves.toBe('sent');
    // Anton hands over again: the new hand-over gets no Done from before.
    unregister();
    const next = vi.fn();
    registerHandBackViewer('t-a', next);
    expect(next).not.toHaveBeenCalled();
  });

  it('is back at once when no hand-back waits', async () => {
    await expect(handedBack('t-a')).resolves.toBe('sent');
    await expect(handedBack(null)).resolves.toBe('sent');
  });

  /* The pane can't open that browser's viewer: nothing would end the wait,
     and a viewer that comes much later would hand back a later hand-over. */
  it('ends a waiting hand-back no viewer will come for, and sends it to no later viewer', async () => {
    expect(await handBackBrowser('t-a', { desktop: false })).toBe('waiting');
    expect(await handBackBrowser('t-b', { desktop: false })).toBe('waiting');
    const ends = [handedBack('t-a'), handedBack('t-a')];
    dropHandBack('t-a');
    await expect(Promise.all(ends)).resolves.toEqual(['unreachable', 'unreachable']);
    const later = vi.fn();
    registerHandBackViewer('t-a', later);
    expect(later).not.toHaveBeenCalled();
    // Another browser's hand-back still waits for its own viewer.
    const other = vi.fn();
    registerHandBackViewer('t-b', other);
    expect(other).toHaveBeenCalledTimes(1);
    dropHandBack(null);
  });

  it('has nothing to hand back with no browser', async () => {
    expect(await handBackBrowser(null, { desktop: false })).toBe('none');
  });
});
