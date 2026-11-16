import { describe, expect, it } from 'vitest';
import { FRAMES_PHASE_MS } from '../shared/browser-contract';
import { type FakeCdpDebugger, fakeCdpDebugger, type FakeFrame, MAIN_FRAME, sentOf } from '../../tests/browser-fake-cdp';
import { type DebuggerSession, FRAME_READ_MS, FrameReads, withDebugger } from './browser-frames';
import type { SecretLook } from './browser-page-script';

const STRIPE = { id: 'card', url: 'https://js.stripe.com/v3/elements-inner-card', parentId: MAIN_FRAME, remote: true };
const WIDGET = { id: 'widget', url: 'https://login.other.test/embed', parentId: MAIN_FRAME, remote: true };

describe('DebuggerSession', () => {
  it("refuses, before it reaches the debugger, a method off the allow-list, one that makes Chromium report to the protocol, and anything but a world's reads and its frames' owners' boxes on a frame's session", async () => {
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
      // The frames of another site inside the card's frame, which only its own session attaches.
      await session.attachFrames('card');
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

  it("finds a frame's owner on the session of the process that holds it, and, as Chromium 157 answers, no such frame on a session outside the frame's own target, and a frame of another target on one above it or the frame's own", async () => {
    const dbg = fakeCdpDebugger({
      frames: [
        // Two frames of other sites in the page; the second holds a frame of its own site and one of yet another.
        { id: 'a', url: 'https://a.other.test/', parentId: MAIN_FRAME, remote: true },
        { id: 'b', url: 'https://b.other.test/', parentId: MAIN_FRAME, remote: true },
        { id: 'c', url: 'https://b.other.test/c', parentId: 'b' },
        { id: 'd', url: 'https://d.other.test/', parentId: 'b', remote: true },
      ],
    });
    const asked: Array<[string, string | undefined, string]> = [];
    await withDebugger(dbg, async (session) => {
      await session.mainFrame();
      await session.attachFrames();
      await session.attachFrames('b');
      for (const sessionId of [undefined, 'session-a', 'session-b', 'session-d']) {
        for (const frameId of ['b', 'c', 'd']) {
          const answer = await session.send('DOM.getFrameOwner', { frameId }, sessionId).then(() => 'found', (error: Error) => error.message);
          asked.push([frameId, sessionId, answer]);
        }
      }
    });
    const notFound = 'Frame with the given id was not found.';
    const elsewhere = 'Frame with the given id does not belong to the target.';
    expect(asked).toEqual([
      ['b', undefined, 'found'], ['c', undefined, elsewhere], ['d', undefined, elsewhere],
      ['b', 'session-a', notFound], ['c', 'session-a', notFound], ['d', 'session-a', notFound],
      ['b', 'session-b', elsewhere], ['c', 'session-b', 'found'], ['d', 'session-b', 'found'],
      ['b', 'session-d', notFound], ['c', 'session-d', notFound], ['d', 'session-d', elsewhere],
    ]);
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

  it("blacks out whole each secret frame a frame keeps where its own world's search can't reach (a closed shadow root), placed through the frame's own view, and leaves an ordinary frame there unmasked", async () => {
    /* An owner's boxes as the session of the process that holds it gives them. */
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const dbg = fakeCdpDebugger({
      frames: [
        // Another site's donation form, drawn at (0, 200), whose own world counts no frame owner: it keeps its frames in a closed shadow root.
        { id: 'donate', url: 'https://donate.other.test/wrapper', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200) },
        // A vendor's card frame showing its card field and a payment provider's frame there, their owners placed in the form's own view.
        { id: 'vault', url: 'https://vault.vendor.test/card', parentId: 'donate', remote: true, holds: true, secrets: { secrets: [box(5, 2, 80, 10)] }, owner: at(10, 40, 100, 20) },
        { id: 'adyen', url: 'https://checkoutshopper-test.adyen.com/card', parentId: 'donate', remote: true, owner: at(10, 70, 100, 20) },
        // An ad there holds no secret.
        { id: 'slot', url: 'https://ads.third.test/slot', parentId: 'donate', remote: true, owner: at(120, 10, 60, 60) },
        // A frame of another origin of the page's site, in the page's process at (300, 0), that keeps a card frame so: its owner is placed in the page's view.
        { id: 'sibling', url: 'https://b.a.test/', parentId: MAIN_FRAME, origin: 'https://b.a.test', owner: owner(300, 0) },
        { id: 'card', url: 'https://vault.vendor.test/card2', parentId: 'sibling', remote: true, holds: true, secrets: { secrets: [box(5, 2, 60, 10)] }, owner: at(310, 20, 80, 20) },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(3);
    expect(masks).toEqual(expect.arrayContaining([box(10, 240, 100, 20), box(10, 270, 100, 20), box(310, 20, 80, 20)]));
    expect(sentOf(dbg, 'DOM.getFrameOwner').filter(({ params }) => ['vault', 'adyen'].includes(String(params.frameId))).map(({ sessionId }) => sessionId)).toEqual(['session-donate', 'session-donate']);
    expect(dbg.sent.filter(([, , sessionId]) => sessionId === 'session-adyen')).toEqual([]);
  });

  it("reads a frame of that frame's origin there for its own secret fields, so one its search entered is never blacked out whole, and blacks out whole the secret frame it keeps in a closed shadow root", async () => {
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const dbg = fakeCdpDebugger({
      frames: [
        // Another site's donation form, at (0, 200), whose search counts and enters its one billing frame, and finds the field in it.
        { id: 'donate', url: 'https://donate.other.test/wrapper', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200), secrets: { owners: 1, secrets: [box(15, 35, 50, 10)] } },
        // The billing frame, of the form's origin and in its process, holds a password field and keeps a card frame in a closed shadow root.
        { id: 'billing', url: 'https://donate.other.test/billing', parentId: 'donate', owner: at(10, 30, 180, 60), secrets: { secrets: [box(5, 5, 50, 10)] } },
        { id: 'vault', url: 'https://vault.vendor.test/card', parentId: 'billing', remote: true, holds: true, secrets: { secrets: [box(5, 2, 80, 10)] }, owner: at(10, 60, 100, 20) },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toEqual(expect.arrayContaining([box(15, 235, 50, 10), box(10, 260, 100, 20)]));
    expect(masks).not.toContainEqual(box(10, 230, 180, 60));
  });

  it("blacks out whole a frame another site's frame keeps in a closed shadow root for what a screenshot blacks out elsewhere, a shown secret or card field or a payment frame, at any depth, and shows a sign-in step's frame that holds a username field and no secret one", async () => {
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const dbg = fakeCdpDebugger({
      frames: [
        // Another site's form at (0, 200), whose own world counts no frame owner: it keeps its frames in a closed shadow root.
        { id: 'donate', url: 'https://donate.other.test/wrapper', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200) },
        // A sign-in step's frame: a username field, which marks a page read's frame secret, and no secret field yet.
        { id: 'signin', url: 'https://login.partner.test/step1', parentId: 'donate', remote: true, holds: true, owner: at(10, 5, 100, 15) },
        // A vendor's card frame showing its card field.
        { id: 'vault', url: 'https://vault.vendor.test/card', parentId: 'donate', remote: true, holds: true, secrets: { secrets: [box(5, 2, 80, 10)] }, owner: at(10, 25, 100, 15) },
        // A frame before its first document, its owner naming a payment provider's page.
        { id: 'early', url: '', parentId: 'donate', src: 'https://checkoutshopper-test.adyen.com/card', owner: at(10, 45, 100, 15) },
        // A widget whose own document shows nothing secret, holding another site's frame that shows a password field.
        { id: 'widget', url: 'https://widget.other.test/', parentId: 'donate', remote: true, owner: at(120, 5, 70, 40) },
        { id: 'auth', url: 'https://auth.third.test/', parentId: 'widget', remote: true, holds: true, secrets: { secrets: [box(1, 1, 30, 8)] }, owner: at(1, 1, 60, 30) },
        // An ad holding a helper frame it drops after the debugger lists it.
        { id: 'ad', url: 'https://ads.other.test/slot', parentId: 'donate', remote: true, owner: at(120, 60, 70, 30) },
        { id: 'helper', url: 'https://ads.third.test/helper', parentId: 'ad', remote: true, gone: true },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(3);
    expect(masks).toEqual(expect.arrayContaining([box(10, 225, 100, 15), box(10, 245, 100, 15), box(120, 205, 70, 40)]));
    expect(masks, 'the sign-in step and the ad stay shown').not.toEqual(expect.arrayContaining([box(10, 205, 100, 15)]));
  });

  it("blacks out whole a frame another site's frame keeps in a closed shadow root that holds a card field, shown or not, as the pod host does, and shows one there that holds only a hidden password field", async () => {
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const dbg = fakeCdpDebugger({
      frames: [
        // Another site's billing form at (0, 200), whose own world counts no frame owner: it keeps its frames in a closed shadow root.
        { id: 'billing', url: 'https://billing.other.test/form', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200) },
        // A vendor's card frame showing its card field.
        { id: 'vault', url: 'https://vault.vendor.test/card', parentId: 'billing', remote: true, holds: true, secrets: { secrets: [box(5, 2, 80, 10)] }, owner: at(10, 10, 180, 20) },
        // A third site's payment step, drawn, whose card section is collapsed: its card field is display: none.
        { id: 'step', url: 'https://pay.third.test/step', parentId: 'billing', remote: true, holds: true, cardField: true, owner: at(10, 40, 180, 20) },
        // A third site's notes frame, drawn, that holds a hidden password field and no card field.
        { id: 'notes', url: 'https://notes.third.test/', parentId: 'billing', remote: true, holds: true, owner: at(10, 70, 180, 20) },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(2);
    expect(masks).toEqual(expect.arrayContaining([box(10, 210, 180, 20), box(10, 240, 180, 20)]));
  });

  it("shows a frame another site's frame keeps in a closed shadow root while the frame it holds a card field in draws nothing, a card option not picked, and blacks it out whole once that frame draws", async () => {
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const dbg = fakeCdpDebugger({
      frames: [
        // Another site's billing form at (0, 200), whose own world counts no frame owner: it keeps its frames in a closed shadow root.
        { id: 'billing', url: 'https://billing.other.test/form', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200) },
        // A third site's payment step, drawn, whose card option is a vendor's frame it doesn't draw (display: none).
        { id: 'step', url: 'https://pay.third.test/step', parentId: 'billing', remote: true, owner: at(10, 10, 180, 40) },
        { id: 'option', url: 'https://vault.vendor.test/card', parentId: 'step', remote: true, holds: true, cardField: true, owner: null },
        // The same step where the person picked the card: its vendor's frame draws.
        { id: 'picked', url: 'https://pay.third.test/step?2', parentId: 'billing', remote: true, owner: at(10, 60, 180, 40) },
        { id: 'card', url: 'https://vault.vendor.test/card?2', parentId: 'picked', remote: true, holds: true, cardField: true, owner: at(5, 5, 100, 20) },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toEqual([box(10, 260, 180, 40)]);
  });

  it("blacks out whole a frame that keeps a secret frame where its world's search can't reach only when the debugger can't place that frame's owner, which draws, and looks no further where the search counted every frame", async () => {
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const card = { secrets: [box(5, 5, 80, 10)] };
    const dbg = fakeCdpDebugger({
      frames: [
        // A billing form of another site that keeps two card options in a closed shadow root: the one not picked is display: none, so its owner lays out no box.
        { id: 'billing', url: 'https://billing.other.test/form', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200) },
        { id: 'unpicked', url: 'https://vault.vendor.test/card', parentId: 'billing', remote: true, holds: true, secrets: card, owner: null },
        { id: 'picked', url: 'https://vault.vendor.test/card?2', parentId: 'billing', remote: true, holds: true, secrets: card, owner: at(10, 60, 100, 20) },
        // A pledge form whose card frame's owner the debugger finds in no process it asks.
        { id: 'pledge', url: 'https://pledge.other.test/form', parentId: MAIN_FRAME, remote: true, owner: owner(300, 0) },
        { id: 'elsewhere', url: 'https://vault.vendor.test/card?3', parentId: 'pledge', remote: true, holds: true, secrets: card, owner: at(10, 10, 100, 20), unplaced: true },
        // A checkout whose world found its one frame and blacks it out whole.
        { id: 'checkout', url: 'https://checkout.other.test/', parentId: MAIN_FRAME, remote: true, owner: owner(600, 0), secrets: { owners: 1, otherSiteFrames: [box(0, 0, 100, 50)] } },
        { id: 'fields', url: 'https://vault.vendor.test/card2', parentId: 'checkout', remote: true, holds: true },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    // The billing form stays shown but for its drawn card frame; the pledge form is blacked out whole.
    expect(masks).toHaveLength(3);
    expect(masks).toEqual(expect.arrayContaining([box(10, 260, 100, 20), box(298, -2, 204, 104), box(600, 0, 100, 50)]));
    expect(sentOf(dbg, 'Page.createIsolatedWorld').map(({ params }) => params.frameId)).not.toContain('fields');
  });

  it("shows a frame of another site whose frame of its own origin, which its search entered, is gone by the time it is read, blacks out whole one there whose read fails, and still blacks out the card frame it keeps in a closed shadow root", async () => {
    const at = (x: number, y: number, width: number, height: number) => ({ content: box(x, y, width, height), border: box(x, y, width, height) });
    const dbg = fakeCdpDebugger({
      frames: [
        // A donation form of another site at (0, 200) whose helper frame of its own origin is dropped after the debugger lists it.
        { id: 'donate', url: 'https://donate.other.test/wrapper', parentId: MAIN_FRAME, remote: true, owner: owner(0, 200) },
        { id: 'helper', url: 'https://donate.other.test/helper', parentId: 'donate', owner: at(0, 0, 1, 1), gone: true },
        { id: 'vault', url: 'https://vault.vendor.test/card', parentId: 'donate', remote: true, holds: true, secrets: { secrets: [box(5, 5, 80, 10)] }, owner: at(10, 60, 100, 20) },
        // The same form at (300, 0), whose frame of its own origin draws but its world's read fails.
        { id: 'pledge', url: 'https://pledge.other.test/wrapper', parentId: MAIN_FRAME, remote: true, owner: owner(300, 0) },
        { id: 'notes', url: 'https://pledge.other.test/notes', parentId: 'pledge', owner: at(10, 10, 120, 30), throws: true },
      ],
    });
    const masks = await withDebugger(dbg, (session) => new FrameReads(session).frameMasks());
    expect(masks).toHaveLength(2);
    expect(masks).toEqual(expect.arrayContaining([box(10, 260, 100, 20), box(310, 10, 120, 30)]));
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

describe('FrameReads.frameSecrets', () => {
  /* What a page read's world left for the debugger: each listed frame by its place, its owner's path and its address. */
  const look = (frames: FakeFrame[], more: Partial<SecretLook> = {}): SecretLook => ({
    frames: frames.map((frame, at) => ({ at, path: frame.path!, url: frame.url })), unplaced: [], nestedUnplaced: [], readUrls: [], ...more,
  });
  const secrets = (dbg: FakeCdpDebugger, request: SecretLook, ms: number = FRAMES_PHASE_MS) =>
    withDebugger(dbg, (session) => new FrameReads(session).frameSecrets(request, Date.now() + ms));
  const worldsOf = (dbg: FakeCdpDebugger) => sentOf(dbg, 'Page.createIsolatedWorld').map(({ params, sessionId }) => [params.frameId, sessionId]);

  it("finds a card field in another site's frame on a host on no list, in a frame of the shop's own other host in the page's process, and a framed sign-in form, each in its own world, and none in an ad, a video, a chat widget, a Google sign-in button or a newsletter box", async () => {
    const frames: FakeFrame[] = [
      { id: 'vault', url: 'https://vault.vendor.test/card', parentId: MAIN_FRAME, remote: true, holds: true, path: [0] },
      { id: 'pci', url: 'https://secure.a.test/payments/card', parentId: MAIN_FRAME, origin: 'https://secure.a.test', holds: true, path: [1] },
      { id: 'signin', url: 'https://login.partner.test/frame', parentId: MAIN_FRAME, remote: true, holds: true, path: [2] },
      { id: 'ad', url: 'https://ads.other.test/banner', parentId: MAIN_FRAME, remote: true, path: [3] },
      { id: 'video', url: 'https://video.other.test/embed/7', parentId: MAIN_FRAME, remote: true, path: [4] },
      { id: 'chat', url: 'https://chat.other.test/widget', parentId: MAIN_FRAME, remote: true, path: [5] },
      { id: 'gsi', url: 'https://accounts.google.com/gsi/button', parentId: MAIN_FRAME, remote: true, path: [6] },
      { id: 'news', url: 'https://forms.other.test/newsletter', parentId: MAIN_FRAME, remote: true, path: [7] },
    ];
    const dbg = fakeCdpDebugger({ frames });
    const found = await secrets(dbg, look(frames));
    expect([...found.frames].sort()).toEqual([0, 1, 2]);
    expect(worldsOf(dbg)).toEqual(expect.arrayContaining([
      [MAIN_FRAME, undefined], ['vault', 'session-vault'], ['pci', undefined], ['signin', 'session-signin'], ['gsi', 'session-gsi'], ['news', 'session-news'],
    ]));
  });

  it("finds a payment frame or a card field in a frame of yet another site inside another site's frame, through that frame's own auto-attach, and opens no world in, or attaches inside, a payment frame", async () => {
    const frames: FakeFrame[] = [
      // A donation form of another site whose card fields are a payment provider's frames.
      { id: 'donate', url: 'https://donate.other.test/form', parentId: MAIN_FRAME, remote: true, holds: null, path: [0] },
      { id: 'card', url: 'https://js.stripe.com/v3/elements-inner-card', parentId: 'donate', remote: true },
      // A checkout of another site whose card field is a vendor's frame on no list.
      { id: 'checkout', url: 'https://checkout.other.test/', parentId: MAIN_FRAME, remote: true, holds: null, path: [1] },
      { id: 'fields', url: 'https://vault.vendor.test/card', parentId: 'checkout', remote: true, holds: true },
      // An ad that holds another ad.
      { id: 'ad', url: 'https://ads.other.test/banner', parentId: MAIN_FRAME, remote: true, holds: null, path: [2] },
      { id: 'slot', url: 'https://ads.third.test/slot', parentId: 'ad', remote: true, holds: false },
      // A payment provider's frame on the page itself.
      { id: 'paypal', url: 'https://www.paypal.com/smart/buttons', parentId: MAIN_FRAME, remote: true, holds: false, path: [3] },
    ];
    const dbg = fakeCdpDebugger({ frames });
    const found = await secrets(dbg, look(frames.filter((frame) => frame.path)));
    expect([...found.frames].sort()).toEqual([0, 1, 3]);
    expect(sentOf(dbg, 'Target.setAutoAttach').map(({ sessionId }) => sessionId)).toEqual(expect.arrayContaining([undefined, 'session-donate', 'session-checkout', 'session-ad']));
    for (const payment of ['session-card', 'session-paypal']) expect(dbg.sent.filter(([, , sessionId]) => sessionId === payment), payment).toEqual([]);
    expect(worldsOf(dbg).map(([frameId]) => frameId)).not.toEqual(expect.arrayContaining(['card']));
    expect(worldsOf(dbg).map(([frameId]) => frameId)).not.toEqual(expect.arrayContaining(['paypal']));
  });

  it("finds a payment frame or a card field in a frame another site's frame keeps where its own world finds none (a closed shadow root), through the frames the debugger knows in it, and none in an ad holding an ad there", async () => {
    const frames: FakeFrame[] = [
      // A donation form of another site whose world sees no frame: it keeps a vendor's card frame in a closed shadow root.
      { id: 'donate', url: 'https://donate.other.test/wrapper', parentId: MAIN_FRAME, remote: true, holds: false, path: [0] },
      { id: 'vault', url: 'https://vault.vendor.test/card', parentId: 'donate', remote: true, holds: true },
      // The same with a payment provider's frame.
      { id: 'pay', url: 'https://donate.other.test/pay', parentId: MAIN_FRAME, remote: true, holds: false, path: [1] },
      { id: 'adyen', url: 'https://checkoutshopper-test.adyen.com/card', parentId: 'pay', remote: true },
      // A billing form of another site that keeps a frame of its own origin, in its process, holding a card field.
      { id: 'billing', url: 'https://billing.other.test/', parentId: MAIN_FRAME, remote: true, holds: false, path: [2] },
      { id: 'number', url: 'https://billing.other.test/number', parentId: 'billing', holds: true },
      // An ad whose world finds nothing, holding another ad.
      { id: 'ad', url: 'https://ads.other.test/banner', parentId: MAIN_FRAME, remote: true, holds: false, path: [3] },
      { id: 'slot', url: 'https://ads.third.test/slot', parentId: 'ad', remote: true, holds: false },
    ];
    const dbg = fakeCdpDebugger({ frames });
    const found = await secrets(dbg, look(frames.filter((frame) => frame.path)));
    expect([...found.frames].sort()).toEqual([0, 1, 2]);
    expect(worldsOf(dbg)).toEqual(expect.arrayContaining([['vault', 'session-vault'], ['number', 'session-billing']]));
    expect(dbg.sent.filter(([, , sessionId]) => sessionId === 'session-adyen')).toEqual([]);
  });

  it("finds a payment provider's frame still loading in a frame another site's frame keeps in a closed shadow root, by the address its owner names, and none in an ordinary frame still loading there", async () => {
    const frames: FakeFrame[] = [
      // A donation form of another site whose world sees no frame: in a closed shadow root it keeps an iframe naming a payment provider's address, still at its first about:blank.
      { id: 'donate', url: 'https://donate.other.test/wrapper', parentId: MAIN_FRAME, remote: true, holds: false, path: [0] },
      { id: 'loading', url: 'about:blank', origin: 'https://donate.other.test', parentId: 'donate', src: 'https://checkoutshopper-test.adyen.com/checkoutshopper/securedfields/card.html' },
      // The same before its first document, at '', and an object naming the provider's address relative to the form's.
      { id: 'pay', url: 'https://pay.other.test/wrapper', parentId: MAIN_FRAME, remote: true, holds: false, path: [1] },
      { id: 'early', url: '', parentId: 'pay', ownerTag: 'object', src: '//checkoutshopper-test.adyen.com/card' },
      // A news widget of another site keeping an ad still loading.
      { id: 'news', url: 'https://news.other.test/widget', parentId: MAIN_FRAME, remote: true, holds: false, path: [2] },
      { id: 'slot', url: 'about:blank', origin: 'https://news.other.test', parentId: 'news', src: 'https://ads.third.test/slot' },
    ];
    const dbg = fakeCdpDebugger({ frames });
    const found = await secrets(dbg, look(frames.filter((frame) => frame.path)));
    expect([...found.frames].sort()).toEqual([0, 1]);
    // No world opens in a frame about to show a payment provider's page.
    expect(worldsOf(dbg).map(([frameId]) => frameId)).not.toEqual(expect.arrayContaining(['loading']));
    expect(sentOf(dbg, 'DOM.getFrameOwner').filter(({ params }) => ['loading', 'early'].includes(String(params.frameId))).map(({ sessionId }) => sessionId))
      .toEqual(['session-donate', 'session-pay']);
  });

  it("finds a card field in a frame inside another site's frame as soon as its world answers, though a frame beside it never answers", async () => {
    const frames: FakeFrame[] = [
      { id: 'checkout', url: 'https://checkout.other.test/', parentId: MAIN_FRAME, remote: true, holds: null, path: [0] },
      { id: 'tracker', url: 'https://ads.third.test/pixel', parentId: 'checkout', remote: true, hangs: true },
      { id: 'fields', url: 'https://vault.vendor.test/card', parentId: 'checkout', remote: true, holds: true },
    ];
    const found = await secrets(fakeCdpDebugger({ frames }), look(frames.filter((frame) => frame.path)));
    expect([...found.frames]).toEqual([0]);
  });

  it("looks into a frame the page's DOM can't place by its address, among the page's own frames, or among those of a frame the read read", async () => {
    const dbg = fakeCdpDebugger({
      frames: [
        { id: 'sealed', url: 'https://vault.vendor.test/card', parentId: MAIN_FRAME, remote: true, holds: true },
        { id: 'quiet', url: 'https://ads.other.test/x', parentId: MAIN_FRAME, remote: true },
        { id: 'panel', url: 'https://a.test/panel', parentId: MAIN_FRAME, origin: 'https://a.test' },
        { id: 'login', url: 'https://login.other.test/frame#step', parentId: 'panel', remote: true, holds: true },
        // The same address directly in the page: not inside the frame read.
        { id: 'elsewhere', url: 'https://forms.other.test/quiet', parentId: MAIN_FRAME, remote: true, holds: true },
        { id: 'inside', url: 'https://forms.other.test/quiet', parentId: 'panel', remote: true },
      ],
    });
    const found = await secrets(dbg, look([], {
      unplaced: ['https://vault.vendor.test/card', 'https://ads.other.test/x'],
      nestedUnplaced: ['https://login.other.test/frame', 'https://forms.other.test/quiet'],
      readUrls: ['https://a.test/panel'],
    }));
    expect([...found.unplaced]).toEqual(['https://vault.vendor.test/card']);
    expect([...found.nestedUnplaced]).toEqual(['https://login.other.test/frame']);
  });

  it("leaves out a frame its look doesn't finish by the deadline it is given, and one whose owner the page has moved since the read", async () => {
    const frames: FakeFrame[] = [
      { id: 'slow', url: 'https://vault.vendor.test/card', parentId: MAIN_FRAME, remote: true, holds: true, hangs: true, path: [0] },
      { id: 'moved', url: 'https://login.other.test/frame', parentId: MAIN_FRAME, remote: true, holds: true, path: [5] },
      { id: 'card', url: 'https://secure.other.test/card', parentId: MAIN_FRAME, remote: true, holds: true, path: [2] },
    ];
    const dbg = fakeCdpDebugger({ frames });
    const listed = look(frames);
    listed.frames[1].path = [1];
    const started = Date.now();
    const found = await secrets(dbg, listed, 300);
    expect(Date.now() - started).toBeLessThan(FRAMES_PHASE_MS);
    expect([...found.frames]).toEqual([2]);
    // Past the deadline already: nothing is sent.
    const late = fakeCdpDebugger({ frames });
    expect([...(await secrets(late, look(frames), 0)).frames]).toEqual([]);
    expect(late.sent).toEqual([]);
  });
});
