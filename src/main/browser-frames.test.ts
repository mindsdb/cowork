import { describe, expect, it } from 'vitest';
import { fakeCdpDebugger, MAIN_FRAME, sentOf } from '../../tests/browser-fake-cdp';
import { type DebuggerSession, withDebugger } from './browser-frames';

const STRIPE = { id: 'card', url: 'https://js.stripe.com/v3/elements-inner-card', parentId: MAIN_FRAME, remote: true };
const WIDGET = { id: 'widget', url: 'https://login.other.test/embed', parentId: MAIN_FRAME, remote: true };

describe('DebuggerSession', () => {
  it("refuses, before it reaches the debugger, a method off the allow-list, one that makes Chromium report to the protocol, and anything but a world's reads on a frame's session", async () => {
    const dbg = fakeCdpDebugger({ frames: [WIDGET] });
    await withDebugger(dbg, async (session) => {
      for (const method of ['Runtime.enable', 'Page.enable', 'Network.enable', 'Debugger.enable', 'Runtime.callFunctionOn', 'Page.navigate']) {
        await expect(session.send(method), method).rejects.toThrow(`refused to send ${method}`);
      }
      await session.attachFrames();
      await expect(session.send('Input.dispatchKeyEvent', { type: 'keyDown' }, 'session-widget')).rejects.toThrow(/refused/);
      await expect(session.send('DOM.getNodeForLocation', { x: 1, y: 1 }, 'session-widget')).rejects.toThrow(/refused/);
    });
    expect(dbg.sent.map(([method]) => method)).toEqual(['Target.setAutoAttach']);
  });

  it('evaluates only in an isolated world this attach made, on the session that made it', async () => {
    const dbg = fakeCdpDebugger({ frames: [WIDGET] });
    await withDebugger(dbg, async (session) => {
      await expect(session.send('Runtime.evaluate', { expression: 'document.title' })).rejects.toThrow(/isolated world this attach made/);
      await session.mainFrame();
      const { executionContextId } = await session.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: MAIN_FRAME });
      await expect(session.send('Runtime.evaluate', { expression: '1', contextId: executionContextId })).resolves.toBeDefined();
      // The same id on another session names another world.
      await session.attachFrames();
      await expect(session.send('Runtime.evaluate', { expression: '1', contextId: executionContextId }, 'session-widget')).rejects.toThrow(/isolated world/);
    });
  });

  it("opens no world in a payment provider's frame or one inside it, in a frame whose address isn't known, or with universal access", async () => {
    const inside = { id: 'inner', url: 'https://merchant.other.test/fields', parentId: 'card', remote: true };
    const dbg = fakeCdpDebugger({ frames: [STRIPE, inside, WIDGET] });
    await withDebugger(dbg, async (session: DebuggerSession) => {
      await expect(session.send('Page.createIsolatedWorld', { frameId: 'widget' })).rejects.toThrow(/address is not known/);
      await session.mainFrame();
      await session.attachFrames();
      for (const frameId of ['card', 'inner']) {
        await expect(session.send('Page.createIsolatedWorld', { frameId }, `session-${frameId}`), frameId).rejects.toThrow(/payment provider's frame/);
      }
      await expect(session.send('Page.createIsolatedWorld', { frameId: 'widget', grantUniveralAccess: true }, 'session-widget')).rejects.toThrow(/universal access/);
      await expect(session.send('Page.createIsolatedWorld', { frameId: 'widget' }, 'session-widget')).resolves.toMatchObject({ executionContextId: expect.any(Number) });
    });
    expect(sentOf(dbg, 'Page.createIsolatedWorld').map(({ params }) => params.frameId)).toEqual(['widget']);
  });

  it('auto-attaches without pausing a frame, and refuses an auto-attach that would', async () => {
    const dbg = fakeCdpDebugger();
    await withDebugger(dbg, async (session) => {
      await expect(session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })).rejects.toThrow(/must not pause a frame/);
      await session.attachFrames();
      await session.attachFrames();
    });
    expect(sentOf(dbg, 'Target.setAutoAttach')).toEqual([{ params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId: undefined }]);
  });
});

describe('withDebugger', () => {
  it('listens only while attached, and detaches after a failure too', async () => {
    const dbg = fakeCdpDebugger({ frames: [WIDGET] });
    await expect(withDebugger(dbg, async () => { throw new Error('gone'); })).rejects.toThrow('gone');
    expect(dbg.isAttached()).toBe(false);
    // A frame's session from an earlier attach is unknown to the next one.
    await withDebugger(dbg, async (session) => {
      await expect(session.send('Page.getFrameTree', {}, 'session-widget')).rejects.toThrow();
      await session.attachFrames();
      await expect(session.send('Page.getFrameTree', {}, 'session-widget')).resolves.toMatchObject({ frameTree: { frame: { id: 'widget' } } });
    });
    expect(dbg.detaches).toBe(2);
  });

  it('refuses while something else holds the debugger', async () => {
    const dbg = fakeCdpDebugger();
    dbg.attach();
    await expect(withDebugger(dbg, async () => 1)).rejects.toMatchObject({ code: 'page_busy' });
  });
});
