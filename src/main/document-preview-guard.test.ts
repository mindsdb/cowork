import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

import { PREVIEW_FRAME_NAME } from '../shared/document-preview';
import { guardDocumentPreviewFrames, type FrameNavigation, type GuardedFrame } from './document-preview-guard';

const openExternal = vi.hoisted(() => vi.fn());

/* The guard imports nothing from Electron today. The mock keeps it that way
   observable: a guard that started sending URLs to the OS browser would call
   this. */
vi.mock('electron', () => ({ shell: { openExternal } }));

const SERVER = 'http://127.0.0.1:26866';
const DISPOSED = 'Render frame was disposed before WebFrameMain could be accessed';

interface FakeFrame extends GuardedFrame {
  name: string;
  url: string;
}

/* What a test sets on a fake frame; the rest takes the defaults below. */
interface FakeFrameInit {
  name?: string;
  url?: string;
  parent?: GuardedFrame | null;
}

let nextFrameId = 1;

function frame(init: FakeFrameInit = {}): FakeFrame {
  return { frameTreeNodeId: nextFrameId++, name: init.name ?? '', url: init.url ?? '', parent: init.parent ?? null };
}

/* A frame whose render frame is gone: Electron throws on every read but the id. */
function disposedFrame(): GuardedFrame {
  const fail = (): never => { throw new Error(DISPOSED); };
  return { frameTreeNodeId: nextFrameId++, get name() { return fail(); }, get url() { return fail(); }, get parent() { return fail(); } };
}

function setup() {
  const contents = new EventEmitter();
  const guard = guardDocumentPreviewFrames(contents);
  const create = (created: GuardedFrame | null) => contents.emit('frame-created', {}, { frame: created });
  /* Emits will-frame-navigate and reports whether the guard cancelled it. */
  const navigate = (init: Omit<FrameNavigation, 'preventDefault'>): boolean => {
    const preventDefault = vi.fn();
    contents.emit('will-frame-navigate', { ...init, preventDefault });
    return preventDefault.mock.calls.length > 0;
  };
  /* Creates a preview frame under `parent` the way the renderer mounts one:
     named at creation, then committed at about:srcdoc. */
  const preview = (parent: GuardedFrame): FakeFrame => {
    const created = frame({ name: PREVIEW_FRAME_NAME, parent });
    create(created);
    created.url = 'about:srcdoc';
    return created;
  };
  return { guard, create, navigate, preview };
}

describe('the server token rule', () => {
  it('withholds the token from the frame created with the preview name', () => {
    const { guard, preview } = setup();
    expect(guard.mayCarryServerToken(preview(frame({ url: 'file:///app/index.html' })))).toBe(false);
  });

  it('keeps withholding it after the preview frame renames itself', () => {
    const { guard, preview } = setup();
    const renamed = preview(frame());
    renamed.name = 'renamed';

    expect(guard.mayCarryServerToken(renamed)).toBe(false);
  });

  it('withholds it from every frame nested inside the preview frame, whatever their names', () => {
    const { guard, create, preview } = setup();
    const outer = preview(frame());
    outer.name = 'renamed';
    const child = frame({ parent: outer, url: 'about:srcdoc' });
    create(child);
    const grandchild = frame({ parent: child, url: `${SERVER}/x` });

    expect(guard.mayCarryServerToken(child)).toBe(false);
    expect(guard.mayCarryServerToken(grandchild)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('withholds it from a request whose frame is %s', (_label, missing) => {
    const { guard } = setup();
    expect(guard.mayCarryServerToken(missing)).toBe(false);
  });

  it('keeps it for the main window, the HTML viewer and the visual editor', () => {
    const { guard, create, preview } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    const viewer = frame({ parent: main, url: `${SERVER}/api/v1/artifacts/drafts/local/a1/index.html` });
    const editor = frame({ parent: main, url: 'about:srcdoc' });
    for (const created of [main, viewer, editor]) create(created);
    preview(main);

    expect(guard.mayCarryServerToken(main)).toBe(true);
    expect(guard.mayCarryServerToken(viewer)).toBe(true);
    expect(guard.mayCarryServerToken(editor)).toBe(true);
  });

  it('marks only at creation, so a frame that takes the preview name later keeps the token', () => {
    const { guard, create } = setup();
    const other = frame({ url: 'about:srcdoc' });
    create(other);
    other.name = PREVIEW_FRAME_NAME;

    expect(guard.mayCarryServerToken(other)).toBe(true);
  });

  it('marks a frame whose name it cannot read at creation', () => {
    const { guard, create } = setup();
    const unreadable = disposedFrame();
    create(unreadable);

    expect(guard.mayCarryServerToken({ ...frame(), frameTreeNodeId: unreadable.frameTreeNodeId })).toBe(false);
  });

  it('ignores a frame-created event that carries no frame', () => {
    const { guard, create } = setup();
    expect(() => create(null)).not.toThrow();
    expect(guard.mayCarryServerToken(frame())).toBe(true);
  });

  it('withholds it when the frame chain cannot be read', () => {
    const { guard } = setup();
    expect(guard.mayCarryServerToken(frame({ parent: disposedFrame() }))).toBe(false);
  });
});

describe('the subframe navigation guard', () => {
  it.each(['about:srcdoc', 'about:srcdoc#section-2'])('cancels a subframe navigation from %s', (current) => {
    const { navigate } = setup();
    expect(navigate({ url: `${SERVER}/api/v1/x`, isMainFrame: false, frame: frame({ url: current }) })).toBe(true);
  });

  it('cancels a subframe navigation whose frame is null', () => {
    const { navigate } = setup();
    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: null })).toBe(true);
  });

  it('cancels a subframe navigation whose frame address cannot be read', () => {
    const { navigate } = setup();
    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: disposedFrame() })).toBe(true);
  });

  it('cancels a renamed preview frame without reading its name', () => {
    const { navigate, preview } = setup();
    const created = preview(frame());
    let nameReads = 0;
    const renamed: GuardedFrame = {
      frameTreeNodeId: created.frameTreeNodeId,
      url: created.url,
      parent: created.parent,
      get name() { nameReads += 1; return 'renamed'; },
    };

    expect(navigate({ url: `${SERVER}/`, isMainFrame: false, frame: renamed })).toBe(true);
    expect(nameReads).toBe(0);
  });

  it('cancels a frame nested in the preview frame that is still on its initial empty document', () => {
    const { navigate, preview } = setup();
    const nested = frame({ parent: preview(frame()) });
    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: nested })).toBe(true);
  });

  /* Electron reports no about: navigation today, so this pins the guard's
     answer for a later Electron that does. */
  it('would let the parent replace a srcdoc frame\'s document if Electron reported it', () => {
    const { navigate, preview } = setup();
    expect(navigate({ url: 'about:srcdoc', isMainFrame: false, frame: frame({ url: 'about:srcdoc' }) })).toBe(false);
    expect(navigate({ url: 'about:srcdoc', isMainFrame: false, frame: preview(frame()) })).toBe(false);
  });

  it('cancels a srcdoc frame directly under the main window, such as a comparison pane or the visual editor', () => {
    const { create, navigate } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    const pane = frame({ parent: main, url: 'about:srcdoc' });
    for (const created of [main, pane]) create(created);

    expect(navigate({ url: `${SERVER}/api/v1/x`, isMainFrame: false, frame: pane })).toBe(true);
  });

  it('lets a srcdoc frame inside a page loaded by URL, such as Code mode\'s preview, navigate, and that page too', () => {
    const { create, navigate } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    const devApp = frame({ parent: main, url: 'http://127.0.0.1:4173/' });
    const child = frame({ parent: devApp, url: 'about:srcdoc' });
    for (const created of [main, devApp, child]) create(created);

    expect(navigate({ url: 'http://127.0.0.1:4173/page2', isMainFrame: false, frame: child })).toBe(false);
    expect(navigate({ url: 'http://127.0.0.1:4173/about', isMainFrame: false, frame: devApp })).toBe(false);
  });

  it('lets a srcdoc frame inside another srcdoc frame of the main window navigate', () => {
    const { create, navigate } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    const pane = frame({ parent: main, url: 'about:srcdoc' });
    const inner = frame({ parent: pane, url: 'about:srcdoc' });
    for (const created of [main, pane, inner]) create(created);

    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: inner })).toBe(false);
  });

  it('cancels a srcdoc frame two levels inside the preview frame, by the mark', () => {
    const { create, navigate, preview } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    create(main);
    const outer = frame({ parent: preview(main), url: 'about:srcdoc' });
    const inner = frame({ parent: outer, url: 'about:srcdoc' });
    for (const created of [outer, inner]) create(created);

    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: inner })).toBe(true);
  });

  it('cancels a srcdoc frame whose parent chain it cannot read', () => {
    const { navigate } = setup();
    const child: GuardedFrame = {
      frameTreeNodeId: nextFrameId++,
      name: '',
      url: 'about:srcdoc',
      parent: disposedFrame(),
    };

    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: child })).toBe(true);
  });

  it('cancels a navigation the preview frame or a frame inside it starts, whatever frame it targets', () => {
    const { create, navigate, preview } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    create(main);
    const started = preview(main);
    const nested = frame({ parent: started });
    const sibling = frame({ parent: main, url: 'http://localhost:5173/' });
    for (const created of [nested, sibling]) create(created);

    expect(navigate({ url: `${SERVER}/api/v1/conversations`, isMainFrame: false, frame: sibling, initiator: started })).toBe(true);
    expect(navigate({ url: 'https://example.com/', isMainFrame: true, frame: main, initiator: started })).toBe(true);
    expect(navigate({ url: 'https://example.com/', isMainFrame: true, frame: main, initiator: nested })).toBe(true);
  });

  it('lets a navigation another frame starts through, as before', () => {
    const { create, navigate, preview } = setup();
    const main = frame({ url: 'file:///app/index.html' });
    create(main);
    preview(main);
    const sibling = frame({ parent: main, url: 'http://localhost:5173/' });
    create(sibling);

    expect(navigate({ url: `${SERVER}/api/v1/conversations`, isMainFrame: false, frame: sibling, initiator: main })).toBe(false);
    expect(navigate({ url: 'https://example.com/', isMainFrame: true, frame: main, initiator: main })).toBe(false);
    expect(navigate({ url: 'https://example.com/', isMainFrame: true, frame: main, initiator: null })).toBe(false);
  });

  it('cancels a navigation whose initiator\'s frame chain it cannot read', () => {
    const { navigate } = setup();
    expect(navigate({ url: 'https://example.com/', isMainFrame: true, frame: frame(), initiator: disposedFrame() })).toBe(true);
  });

  it('cancels a navigation whose initiator it cannot read at all', () => {
    const contents = new EventEmitter();
    guardDocumentPreviewFrames(contents);
    const preventDefault = vi.fn();
    /* Emitted directly: a spread would read the getter in the test. */
    contents.emit('will-frame-navigate', {
      url: 'https://example.com/',
      isMainFrame: true,
      frame: frame(),
      get initiator(): GuardedFrame | null { throw new Error(DISPOSED); },
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['an HTML viewer frame at the server', `${SERVER}/api/v1/artifacts/drafts/local/a1/index.html`],
    ['a frame still on its initial empty document', ''],
  ])('lets %s navigate', (_label, current) => {
    const { navigate } = setup();
    expect(navigate({ url: `${SERVER}/api/v1/artifacts/drafts/local/a1/next.html`, isMainFrame: false, frame: frame({ url: current }) })).toBe(false);
  });

  it.each([
    ['a dev-server reload', 'http://localhost:5173/', 'http://localhost:5173/'],
    ['a packaged self reload', 'file:///app/index.html', 'file:///app/index.html'],
    ['an external link', 'https://example.com/', 'file:///app/index.html'],
  ])('leaves %s of the main frame to the main window guard', (_label, url, current) => {
    const { navigate } = setup();
    expect(navigate({ url, isMainFrame: true, frame: frame({ url: current }) })).toBe(false);
    expect(navigate({ url, isMainFrame: true, frame: null })).toBe(false);
  });

  it('opens nothing in the OS browser for a cancelled navigation', () => {
    const { navigate, preview } = setup();
    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: preview(frame()) })).toBe(true);
    expect(navigate({ url: 'https://example.com/', isMainFrame: false, frame: null })).toBe(true);

    expect(openExternal).not.toHaveBeenCalled();
  });
});
