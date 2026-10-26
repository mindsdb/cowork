import { afterEach, describe, expect, it, vi } from 'vitest';

import { zipBytes } from '../../../../../tests/helpers/zipBytes';
import type { DocumentRenderer, FrameToParent, GuardedZip, RendererContext, RenderSummary } from '../contract';
import { previewError } from '../errors';
import { startPreviewFrame } from './frame';
import { newPreviewToken, PREVIEW_TOKEN_META_NAME } from './protocol';

const SUMMARY: RenderSummary = { type: 'docx', units: 1, truncated: false };

/* A stand-in for the frame's window: its own document with the token meta,
   a parent whose postMessage is a spy, and the window events the runtime uses. */
function frameWindow(token: string | null) {
  const doc = document.implementation.createHTMLDocument('frame');
  if (token !== null) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', PREVIEW_TOKEN_META_NAME);
    meta.setAttribute('content', token);
    doc.head.append(meta);
  }
  const parent = { postMessage: vi.fn() };
  const win = Object.assign(new EventTarget(), {
    document: doc,
    parent,
    matchMedia: () => ({ matches: false }),
  });
  return { win: win as unknown as Window, doc, parent };
}

interface Session {
  received: FrameToParent[];
  port: MessagePort;
  next(): Promise<FrameToParent>;
}

const channels: MessageChannel[] = [];

/* Hands the frame a port the way the parent does, and collects what it posts. */
function sendPort(win: Window, token: string): Session {
  const channel = new MessageChannel();
  channels.push(channel);
  const received: FrameToParent[] = [];
  const waiting: Array<(message: FrameToParent) => void> = [];
  channel.port1.onmessage = (event: MessageEvent) => {
    const waiter = waiting.shift();
    if (waiter) waiter(event.data);
    else received.push(event.data);
  };
  win.dispatchEvent(new MessageEvent('message', { data: { type: 'port', token }, ports: [channel.port2] }));
  return {
    received,
    port: channel.port1,
    next: () => {
      const queued = received.shift();
      return queued ? Promise.resolve(queued) : new Promise((resolve) => { waiting.push(resolve); });
    },
  };
}

function sendDocument(session: Session, token: string, bytes: ArrayBuffer, previewType: 'docx' | 'xlsx' = 'docx') {
  session.port.postMessage({ token, type: 'document', previewType, bytes });
}

function renderer(render: DocumentRenderer['render'] = async () => SUMMARY): DocumentRenderer & { render: ReturnType<typeof vi.fn> } {
  return { type: 'docx', render: vi.fn(render) };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 20); });

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

describe('startPreviewFrame handshake', () => {
  it('removes the token meta and posts ready with the token before it is given any byte', () => {
    const token = newPreviewToken();
    const { win, doc, parent } = frameWindow(token);
    const docx = renderer();

    startPreviewFrame(docx, win);

    expect(doc.querySelector(`meta[name="${PREVIEW_TOKEN_META_NAME}"]`)).toBeNull();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith({ source: 'cowork-document-preview', type: 'ready', token }, '*');
    expect(docx.render).not.toHaveBeenCalled();
  });

  it('does nothing without a well-formed token meta', () => {
    for (const token of [null, '', 'not-a-token']) {
      const { win, parent } = frameWindow(token);
      startPreviewFrame(renderer(), win);
      expect(parent.postMessage).not.toHaveBeenCalled();
    }
  });

  it('ignores a port with a wrong or missing token', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    const docx = renderer();
    startPreviewFrame(docx, win);

    for (const wrong of [newPreviewToken(), '']) {
      const session = sendPort(win, wrong);
      sendDocument(session, wrong, new ArrayBuffer(4));
    }
    await flush();

    expect(docx.render).not.toHaveBeenCalled();
  });

  it('takes the first port with its token and ignores a second one', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    const docx = renderer();
    startPreviewFrame(docx, win);

    const first = sendPort(win, token);
    const second = sendPort(win, token);
    sendDocument(second, token, new ArrayBuffer(2));
    await flush();
    expect(docx.render).not.toHaveBeenCalled();

    sendDocument(first, token, new ArrayBuffer(3));
    expect(await first.next()).toEqual({ token, type: 'rendered', summary: SUMMARY });
    expect(docx.render).toHaveBeenCalledTimes(1);
    expect(second.received).toEqual([]);
  });

  it('drops a document with a wrong token on its port, and renders only the first document', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    const docx = renderer();
    startPreviewFrame(docx, win);
    const session = sendPort(win, token);

    sendDocument(session, newPreviewToken(), new ArrayBuffer(1));
    sendDocument(session, token, new ArrayBuffer(5));
    sendDocument(session, token, new ArrayBuffer(6));
    await session.next();
    await flush();

    expect(docx.render).toHaveBeenCalledTimes(1);
    expect((docx.render.mock.calls[0][0] as ArrayBuffer).byteLength).toBe(5);
  });

  it('renders into a root in the body, with the device caps', async () => {
    const token = newPreviewToken();
    const { win, doc } = frameWindow(token);
    let context: RendererContext | null = null;
    startPreviewFrame(renderer(async (_bytes, ctx) => { context = ctx; return SUMMARY; }), win);
    const session = sendPort(win, token);
    sendDocument(session, token, new ArrayBuffer(1));
    await session.next();

    expect(context!.root.parentElement).toBe(doc.body);
    expect(context!.limits.maxPdfCanvasPixels).toBe(16_777_216);
    expect(context!.signal.aborted).toBe(false);
  });

  /* Renderers stop on ctx.signal, and pagehide is what aborts it when the
     frame goes away mid-render. */
  it('aborts ctx.signal when the frame window hides', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    let context: RendererContext | null = null;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const rendering = new Promise<void>((resolve) => { started = resolve; });
    startPreviewFrame(renderer(async (_bytes, ctx) => {
      context = ctx;
      started();
      await held;
      return SUMMARY;
    }), win);
    const session = sendPort(win, token);
    sendDocument(session, token, new ArrayBuffer(1));
    await rendering;

    expect(context!.signal.aborted).toBe(false);
    win.dispatchEvent(new Event('pagehide'));
    expect(context!.signal.aborted).toBe(true);

    release();
    await session.next();
  });
});

describe('render outcomes', () => {
  async function outcomeOf(render: DocumentRenderer['render'], bytes = new ArrayBuffer(1)) {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    const docx = renderer(render);
    startPreviewFrame(docx, win);
    const session = sendPort(win, token);
    sendDocument(session, token, bytes);
    return { message: await session.next(), docx, token };
  }

  it('reports a PreviewError the frame may raise with its own code', async () => {
    const { message, token } = await outcomeOf(async () => { throw previewError('unsupported', 'No charts.'); });
    expect(message).toEqual({ token, type: 'error', code: 'unsupported', detail: 'No charts.' });
  });

  it('reports any other rejection as internal', async () => {
    const { message } = await outcomeOf(async () => { throw new TypeError('boom'); });
    expect(message).toMatchObject({ type: 'error', code: 'internal' });
  });

  it('reports a parent-owned code from a renderer as internal', async () => {
    const { message } = await outcomeOf(async () => { throw previewError('timeout'); });
    expect(message).toMatchObject({ type: 'error', code: 'internal' });
  });

  it('reports too-large from a renderer with the frame-owned limit it names', async () => {
    const { message, token } = await outcomeOf(async () => {
      throw previewError('too-large', 'This document is too large to preview.', { limit: 'maxDocxNodes' });
    });
    expect(message).toEqual({ token, type: 'error', code: 'too-large', limit: 'maxDocxNodes', detail: 'This document is too large to preview.' });
  });

  it.each([
    { label: 'no limit', limit: undefined },
    { label: "the parent's byte cap", limit: 'maxBytes' as const },
  ])('reports too-large from a renderer that names $label as internal', async ({ limit }) => {
    const { message } = await outcomeOf(async () => { throw previewError('too-large', 'too large', { limit }); });
    expect(message).toMatchObject({ type: 'error', code: 'internal' });
    expect(message).not.toHaveProperty('limit');
  });

  it('reports a summary for another type as internal', async () => {
    const { message } = await outcomeOf(async () => ({ type: 'pdf', units: 1, truncated: false }));
    expect(message).toMatchObject({ type: 'error', code: 'internal' });
  });
});

describe('archive guard before render', () => {
  it('ends an archive past the caps in zip-limit, and render() never runs', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    const docx = renderer();
    startPreviewFrame(docx, win);
    const session = sendPort(win, token);

    sendDocument(session, token, zipBytes([{ name: 'word/document.xml', data: new Uint8Array(1) }], { statedEntries: 20_000 }));

    expect(await session.next()).toMatchObject({ type: 'error', code: 'zip-limit', limit: 'maxZipEntries' });
    expect(docx.render).not.toHaveBeenCalled();
  });

  it('hands the checked archive to ctx.openZip', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    const opened: GuardedZip[] = [];
    startPreviewFrame(renderer(async (bytes, ctx) => {
      opened.push(await ctx.openZip(bytes), await ctx.openZip(bytes));
      return SUMMARY;
    }), win);
    const session = sendPort(win, token);

    sendDocument(session, token, zipBytes([{ name: 'word/document.xml', data: new TextEncoder().encode('<w/>') }]));
    await session.next();

    expect(opened[0]).toBe(opened[1]);
    expect(opened[0].names()).toEqual(['word/document.xml']);
  });

  it('fails ctx.openZip on a file that is not an archive with parse-failed', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    startPreviewFrame(renderer(async (bytes, ctx) => { await ctx.openZip(bytes); return SUMMARY; }), win);
    const session = sendPort(win, token);
    sendDocument(session, token, new TextEncoder().encode('plain text').buffer as ArrayBuffer);
    expect(await session.next()).toMatchObject({ type: 'error', code: 'parse-failed' });
  });
});

describe('asset requests', () => {
  it('asks the parent by name with the token and takes only the matching reply', async () => {
    const token = newPreviewToken();
    const { win } = frameWindow(token);
    let asset: Uint8Array | null | undefined;
    startPreviewFrame(renderer(async (_bytes, ctx) => {
      asset = await ctx.requestAsset('UniJIS-UCS2-H.bcmap');
      return SUMMARY;
    }), win);
    const session = sendPort(win, token);
    sendDocument(session, token, new ArrayBuffer(1));

    const request = await session.next();
    expect(request).toEqual({ token, type: 'asset-request', requestId: 0, name: 'UniJIS-UCS2-H.bcmap' });
    session.port.postMessage({ token: newPreviewToken(), type: 'asset', requestId: 0, name: 'UniJIS-UCS2-H.bcmap', bytes: new ArrayBuffer(9) });
    session.port.postMessage({ token, type: 'asset', requestId: 0, name: 'other.bcmap', bytes: new ArrayBuffer(8) });
    session.port.postMessage({ token, type: 'asset', requestId: 0, name: 'UniJIS-UCS2-H.bcmap', bytes: new Uint8Array([1, 2]).buffer });

    expect(await session.next()).toMatchObject({ type: 'rendered' });
    expect(asset).toEqual(new Uint8Array([1, 2]));
  });
});

describe('link guard', () => {
  function frameWithLinks(markup: string) {
    const token = newPreviewToken();
    const { win, doc } = frameWindow(token);
    startPreviewFrame(renderer(), win);
    doc.body.innerHTML = markup;
    return doc;
  }

  function click(element: Element, type = 'click') {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('cancels every link click, middle click and form submit in the frame', () => {
    const doc = frameWithLinks(`
      <a id="plain" href="https://docs.google.com/x">a</a>
      <a id="top" href="http://localhost:26866/" target="_top"><span id="inner">b</span></a>
      <map name="m"><area id="area" href="http://127.0.0.1:26866/" shape="rect" coords="0,0,1,1"></map>
      <svg><a id="svg" href="https://drive.google.com/x"><text>c</text></a></svg>
      <form id="form" action="/api/v1/x"></form>`);
    for (const id of ['plain', 'inner', 'area', 'svg']) {
      expect(click(doc.getElementById(id)!)).toBe(true);
      expect(click(doc.getElementById(id)!, 'auxclick')).toBe(true);
    }
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    doc.getElementById('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });

  it('scrolls to a #fragment target instead of navigating', () => {
    const doc = frameWithLinks('<a id="jump" href="#totals">jump</a><p id="totals">totals</p>');
    const target = doc.getElementById('totals')!;
    target.scrollIntoView = vi.fn();
    expect(click(doc.getElementById('jump')!)).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('leaves clicks on anything but a link alone', () => {
    const doc = frameWithLinks('<button id="button">b</button>');
    expect(click(doc.getElementById('button')!)).toBe(false);
  });
});
