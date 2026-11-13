import { describe, expect, it } from 'vitest';
import { type FakeCdpDebugger, fakeCdpDebugger, MAIN_FRAME, sentOf } from '../../tests/browser-fake-cdp';
import { type DebuggerSession, FRAME_READ_MS, FrameReads, withDebugger } from './browser-frames';

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

  it('calls a function only in an isolated world this attach made, never on an object, and resolves a node only into such a world', async () => {
    const dbg = fakeCdpDebugger({ frames: [WIDGET] });
    await withDebugger(dbg, async (session) => {
      await session.mainFrame();
      const { executionContextId } = await session.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: MAIN_FRAME });
      await expect(session.send('Runtime.callFunctionOn', { functionDeclaration: 'function () {}' })).rejects.toThrow(/isolated world this attach made/);
      // On an object, the function runs in whatever world holds it: the page's own, for one the page handed out.
      await expect(session.send('Runtime.callFunctionOn', { functionDeclaration: 'function () {}', objectId: 'page-object', executionContextId })).rejects.toThrow(/not on an object/);
      await expect(session.send('DOM.resolveNode', { backendNodeId: 1 })).rejects.toThrow(/resolve into an isolated world this attach made/);
      await expect(session.send('DOM.resolveNode', { backendNodeId: 1, executionContextId: executionContextId + 100 })).rejects.toThrow(/resolve into an isolated world/);
      // A world of the page's session is no world of a frame's session.
      await session.attachFrames();
      await expect(session.send('DOM.resolveNode', { backendNodeId: 1, executionContextId }, 'session-widget')).rejects.toThrow(/resolve into an isolated world/);
      await expect(session.send('Runtime.callFunctionOn', { functionDeclaration: 'function () {}', executionContextId }, 'session-widget')).rejects.toThrow(/isolated world/);
      // One in this attach's world reaches the debugger.
      await session.send('Runtime.callFunctionOn', { functionDeclaration: 'function () {}', executionContextId, arguments: [] }).catch(() => {});
    });
    expect(sentOf(dbg, 'DOM.resolveNode')).toEqual([]);
    expect(sentOf(dbg, 'Runtime.callFunctionOn')).toHaveLength(1);
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

describe('FrameReads.frameMasks', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const owner = (x: number, y: number) => ({ content: box(x, y, 200, 100), border: box(x - 2, y - 2, 204, 104) });
  const secret = { secrets: [box(5, 5, 50, 10)] };

  it("reads each frame the page's world can't search in its own world, wherever it sits, and each it searched for its own secret fields", async () => {
    const dbg = fakeCdpDebugger({
      frames: [
        // Searched by the page's world: of the page's origin, in its process.
        { id: 'same', url: 'https://a.test/inner', parentId: MAIN_FRAME, origin: 'https://a.test', owner: owner(0, 0), secrets: secret },
        // Another site's frame inside it, in its own process.
        { id: 'nested', url: 'https://forms.other.test/', parentId: 'same', remote: true, owner: owner(0, 200), secrets: secret },
        // Another origin of the same site, in the page's process.
        { id: 'sibling', url: 'https://b.a.test/', parentId: MAIN_FRAME, origin: 'https://b.a.test', owner: owner(300, 0), secrets: secret },
        // A frame its owner doesn't draw.
        { id: 'hidden', url: 'https://ads.other.test/', parentId: MAIN_FRAME, remote: true, owner: null, secrets: secret },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(3);
    expect(masks).toEqual(expect.arrayContaining([box(5, 5, 50, 10), box(305, 5, 50, 10), box(5, 205, 50, 10)]));
    const worlds = sentOf(dbg, 'Page.createIsolatedWorld').map(({ params, sessionId }) => [params.frameId, sessionId]);
    expect(worlds).toHaveLength(3);
    expect(worlds).toEqual(expect.arrayContaining([['same', undefined], ['sibling', undefined], ['nested', 'session-nested']]));
  });

  it("places a secret field through a frame's transform, scaled as the frame is drawn at twice or half its size, and blacks out whole a frame a transform turns", async () => {
    const field = { secrets: [box(10, 20, 50, 10)], viewport: { width: 200, height: 100 } };
    const dbg = fakeCdpDebugger({
      frames: [
        // Drawn at twice its 200 by 100 size, at (100, 0).
        { ...WIDGET, owner: { content: box(100, 0, 400, 200), border: box(100, 0, 400, 200) }, secrets: field },
        // Drawn at half its size, at (600, 0).
        { id: 'half', url: 'https://pay.other.test/', parentId: MAIN_FRAME, remote: true, owner: { content: box(600, 0, 100, 50), border: box(600, 0, 100, 50) }, secrets: field },
        // Turned a few degrees: its content quad's corners don't line up.
        { id: 'turned', url: 'https://forms.other.test/', parentId: MAIN_FRAME, remote: true, owner: { content: box(0, 300, 200, 100), border: box(-5, 295, 210, 110), quad: [0, 300, 200, 310, 195, 410, -5, 400] }, secrets: field },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(3);
    expect(masks).toEqual(expect.arrayContaining([box(120, 40, 100, 20), box(605, 10, 25, 5), box(-5, 295, 210, 110)]));
  });

  it("reads a frame the page's world searched for the secret fields of its own document alone, since that search can't reach one in a closed shadow root, and leaves its frames to their own reads", async () => {
    const dbg = fakeCdpDebugger({
      frames: [
        // Its own world finds its field, and boxes for its frames, which are read on their own.
        { id: 'same', url: 'https://a.test/inner', parentId: MAIN_FRAME, origin: 'https://a.test', owner: owner(0, 0), secrets: { secrets: [box(5, 5, 50, 10)], otherSiteFrames: [box(0, 0, 200, 100)] } },
        { id: 'deeper', url: 'https://a.test/deeper', parentId: 'same', origin: 'https://a.test', owner: owner(0, 300), secrets: secret },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(2);
    expect(masks).toEqual(expect.arrayContaining([box(5, 5, 50, 10), box(5, 305, 50, 10)]));
    const reads = sentOf(dbg, 'Runtime.evaluate').map(({ params }) => String(params.expression)).filter((expression) => expression.includes('"kind":"secretBoxes"'));
    expect(reads).toHaveLength(2);
    expect(reads.every((expression) => expression.includes('"depth":0'))).toBe(true);
  });

  it("blacks out the copies a reflection inside a frame draws of the frames in it, whole, in a frame the page's world searched too", async () => {
    const dbg = fakeCdpDebugger({
      frames: [
        { id: 'same', url: 'https://a.test/inner', parentId: MAIN_FRAME, origin: 'https://a.test', owner: owner(0, 0), secrets: { mirroredFrames: [box(0, 50, 100, 40)] } },
        { ...WIDGET, owner: owner(0, 200), secrets: { mirroredFrames: [box(100, 60, 200, 80)] } },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(2);
    expect(masks).toEqual(expect.arrayContaining([box(0, 50, 100, 40), box(100, 260, 100, 40)]));
  });

  it("blacks out whole a payment provider's frame, which no world opens in, and keeps each mask inside its frame", async () => {
    const dbg = fakeCdpDebugger({
      frames: [
        { ...STRIPE, owner: owner(0, 0) },
        { ...WIDGET, owner: owner(0, 200), secrets: { secrets: [box(150, 80, 100, 100)], otherSiteFrames: [box(-20, 0, 40, 40)] } },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toEqual([box(-2, -2, 204, 104), box(150, 280, 50, 20), box(0, 200, 20, 40)]);
    expect(sentOf(dbg, 'Page.createIsolatedWorld').map(({ params }) => params.frameId)).toEqual(['widget']);
  });
});

describe('FrameReads.focusToken', () => {
  const token = (dbg: FakeCdpDebugger) => withDebugger(dbg, (session) => new FrameReads(session).focusToken());
  /* The page's world sees the focus rest on a frame element it can't read into. */
  const onFrame = { secret: false, otherSite: true, sealed: false };

  it("names the element of a payment provider's frame the focus rests in, which no world opens in, so a focus that moves from one such frame to another while a card waits changes the token", async () => {
    // The card number's frame and the security code's, each its own frame element in the page (nodes 21 and 22).
    const dbg = fakeCdpDebugger({
      main: { focus: onFrame, focused: 21 },
      frames: [{ ...STRIPE, id: 'number' }, { ...STRIPE, id: 'cvc', url: 'https://js.stripe.com/v3/elements-inner-cvc' }],
      focusedOwnerOf: 'number',
    });
    const first = await token(dbg);
    expect(first).toBe(`${MAIN_FRAME}:21`);
    expect(await token(dbg), 'the focus stays').toBe(first);
    dbg.page.frames[0].focused = 22;
    dbg.page.focusedOwnerOf = 'cvc';
    expect(await token(dbg)).toBe(`${MAIN_FRAME}:22`);
    expect(sentOf(dbg, 'Page.createIsolatedWorld').map(({ params }) => params.frameId)).toEqual([MAIN_FRAME, MAIN_FRAME, MAIN_FRAME]);
  });

  it("names the element of a frame of yet another site inside another site's frame, read in that frame's own world, so a focus that moves from one such frame to another changes the token", async () => {
    const dbg = fakeCdpDebugger({
      main: { focus: onFrame },
      // The widget's own world sees the focus rest on one of its frame elements (nodes 31 and 32).
      frames: [
        { ...WIDGET, focus: onFrame, focused: 31 },
        { id: 'inner-a', url: 'https://a.test/fields', parentId: 'widget', remote: true, focused: 5 },
        { id: 'inner-b', url: 'https://a.test/fields', parentId: 'widget', remote: true, focused: 5 },
      ],
      focusedOwnerOf: 'widget',
    });
    expect(await token(dbg)).toBe('widget:31');
    dbg.page.frames[1].focused = 32;
    expect(await token(dbg)).toBe('widget:32');
    expect(sentOf(dbg, 'Page.createIsolatedWorld').map(({ params }) => params.frameId)).not.toContain('inner-a');
  });

  it('names the frame element the focus rests on when the debugger names no frame of it, or the frame went before its world opened', async () => {
    const noFrame = fakeCdpDebugger({ main: { focus: onFrame, focused: 41 }, frames: [WIDGET], focusedOwnerOf: null });
    expect(await token(noFrame)).toBe(`${MAIN_FRAME}:41`);
    const gone = fakeCdpDebugger({ main: { focus: onFrame, focused: 42 }, frames: [WIDGET], focusedOwnerOf: 'gone' });
    expect(await token(gone)).toBe(`${MAIN_FRAME}:42`);
  });

  it('names the deepest node it reaches when the focus sits past the closed shadow roots it follows', async () => {
    const sealed = { secret: false, otherSite: false, sealed: true };
    const dbg = fakeCdpDebugger({ main: { focus: sealed, closedRoots: Array.from({ length: 12 }, () => sealed), focused: 51 } });
    expect(await token(dbg)).toBe(`${MAIN_FRAME}:51`);
    expect(sentOf(dbg, 'DOM.resolveNode').length).toBeGreaterThan(1);
  });

  it(`leaves the focus out while nothing has it, and when the read takes longer than ${FRAME_READ_MS} ms`, async () => {
    expect(await token(fakeCdpDebugger())).toBeNull();
    const hung = fakeCdpDebugger({ main: { focus: onFrame, focused: 61 }, frames: [{ ...WIDGET, hangs: true }], focusedOwnerOf: 'widget' });
    expect(await token(hung)).toBeNull();
  });
});
