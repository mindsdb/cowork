import { act, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { documentPreviewData } from '../../../../tests/helpers/documentPreviewData';
import { scriptSha256 } from '../../../../scripts/preview-bundles.mjs';
import { PREVIEW_FRAME_NAME } from '../../../shared/document-preview';
import type { PreviewAssetProvider, RenderSummary } from './contract';
import { DocumentPreviewFrame, MAX_OPEN_DRAWS, type DocumentPreviewFrameProps } from './DocumentPreviewFrame';
import { previewFramePolicy } from './frameDocument';
import { PREVIEW_PARENT_LIMITS } from './limits';
import type { LoadedPreviewBundle } from './runtime/bundle';
import { newPreviewToken } from './runtime/protocol';

const data = documentPreviewData();
const SCRIPT = 'void 0;';
const HASH = scriptSha256(SCRIPT);
const SUMMARY: RenderSummary = { type: 'xlsx', units: 2, truncated: false };

function frameBundle(assets: PreviewAssetProvider | null = null): LoadedPreviewBundle {
  return { scriptText: SCRIPT, scriptSha256: HASH, assets };
}

function frameProps(overrides: Partial<DocumentPreviewFrameProps> = {}): DocumentPreviewFrameProps {
  return {
    previewType: 'xlsx',
    bytes: new Uint8Array([1, 2, 3]).buffer,
    bundle: frameBundle(),
    title: 'Preview of report.xlsx',
    onRendered: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function mount(overrides: Partial<DocumentPreviewFrameProps> = {}) {
  const props = frameProps(overrides);
  const view = render(<DocumentPreviewFrame {...props} />);
  return { ...view, props };
}

const frames = (container: HTMLElement) => Array.from(container.querySelectorAll('iframe'));

function tokenOf(iframe: HTMLIFrameElement): string {
  return iframe.getAttribute('srcdoc')!.match(/name="cowork-preview-token" content="([0-9a-f]{32})"/)![1];
}

function postReady(token: string | undefined, source: MessageEventSource | null = null) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'cowork-document-preview', type: 'ready', token }, source }));
  });
}

const openPorts: MessagePort[] = [];

/* Posts ready for the mounted frame and returns the frame's end of the port
   the parent sent, with everything that arrives on it. */
function handshake(iframe: HTMLIFrameElement) {
  const sent = vi.spyOn(iframe.contentWindow!, 'postMessage');
  postReady(tokenOf(iframe));
  expect(sent).toHaveBeenCalledTimes(1);
  const [message, target, transfer] = sent.mock.calls[0] as unknown as [unknown, string, MessagePort[]];
  const port = transfer[0];
  openPorts.push(port);
  const received: unknown[] = [];
  port.onmessage = (event: MessageEvent) => { received.push(event.data); };
  return { message, target, port, received, sent };
}

const tick = () => act(() => new Promise((resolve) => { setTimeout(resolve, 20); }));

afterEach(() => {
  for (const port of openPorts.splice(0)) port.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the preview iframe', () => {
  it('is one sandboxed, named srcdoc frame that never gets src', () => {
    const { container } = mount();
    const [iframe, ...others] = frames(container);
    expect(others).toHaveLength(0);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('name')).toBe('cowork-document-preview');
    expect(iframe.hasAttribute('src')).toBe(false);
    expect(iframe.getAttribute('srcdoc')!.startsWith(`<meta http-equiv="Content-Security-Policy" content="${previewFramePolicy(HASH)}">`)).toBe(true);
    for (const keyword of data.forbiddenSandboxKeywords) expect(iframe.getAttribute('sandbox')).not.toContain(keyword);
  });

  /* The desktop shell marks the preview frame by its name when Electron
     creates the frame, before any script runs, so the name has to be on the
     element React first renders, not set later by an effect. Static markup
     runs no effect. */
  it('carries its name in the markup it first renders', () => {
    const template = document.createElement('template');
    template.innerHTML = renderToStaticMarkup(<DocumentPreviewFrame {...frameProps()} />);
    const iframes = template.content.querySelectorAll('iframe');
    expect(iframes).toHaveLength(1);
    expect(iframes[0].getAttribute('name')).toBe(PREVIEW_FRAME_NAME);
    expect(PREVIEW_FRAME_NAME).toBe('cowork-document-preview');
    expect(iframes[0].getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('fills its container through a class, with no inline size', () => {
    const { container } = mount();
    const [iframe] = frames(container);
    expect(iframe.className).toBe('document-preview-frame');
    expect(iframe.hasAttribute('style')).toBe(false);
  });

  it('gets a new token on every mount', () => {
    const first = tokenOf(frames(mount().container)[0]);
    const second = tokenOf(frames(mount().container)[0]);
    expect(first).not.toBe(second);
  });
});

describe('the handshake', () => {
  it('drops a FrameReady with a wrong or missing token', () => {
    const { container } = mount();
    const [iframe] = frames(container);
    const sent = vi.spyOn(iframe.contentWindow!, 'postMessage');
    postReady(newPreviewToken());
    postReady(undefined);
    postReady('');
    expect(sent).not.toHaveBeenCalled();
  });

  it('checks the token, not event.source', () => {
    const { container } = mount();
    const [iframe] = frames(container);
    const sent = vi.spyOn(iframe.contentWindow!, 'postMessage');
    postReady(tokenOf(iframe), window);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('takes one FrameReady per frame and sends one port', () => {
    const { container } = mount();
    const [iframe] = frames(container);
    const { message, target, sent } = handshake(iframe);
    postReady(tokenOf(iframe));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(message).toEqual({ type: 'port', token: tokenOf(iframe) });
    expect(target).toBe('*');
  });

  it('sends the bytes once, over the port, with the token', async () => {
    const { container } = mount();
    const [iframe] = frames(container);
    const { received } = handshake(iframe);
    await tick();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ token: tokenOf(iframe), type: 'document', previewType: 'xlsx' });
    expect(new Uint8Array((received[0] as { bytes: ArrayBuffer }).bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('drops frame messages with a wrong or missing token', async () => {
    const { container, props } = mount();
    const [iframe] = frames(container);
    const { port } = handshake(iframe);
    port.postMessage({ token: newPreviewToken(), type: 'rendered', summary: SUMMARY });
    port.postMessage({ type: 'error', code: 'parse-failed' });
    await tick();
    expect(props.onRendered).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();

    port.postMessage({ token: tokenOf(iframe), type: 'rendered', summary: SUMMARY });
    await tick();
    expect(props.onRendered).toHaveBeenCalledWith(SUMMARY);
  });

  it('reports an error the frame sends and leaves the frame to its caller', async () => {
    const { container, props } = mount();
    const [iframe] = frames(container);
    const { port } = handshake(iframe);
    port.postMessage({ token: tokenOf(iframe), type: 'error', code: 'parse-failed', detail: 'bad sheet' });
    await tick();
    expect(props.onError).toHaveBeenCalledWith('parse-failed', 'bad sheet');
    expect(frames(container)).toHaveLength(1);
  });
});

describe('the watchdogs', () => {
  it(`remove a frame that sends no ready within ${PREVIEW_PARENT_LIMITS.readyTimeoutMs} ms and report timeout`, () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container, props } = mount();
    act(() => { vi.advanceTimersByTime(PREVIEW_PARENT_LIMITS.readyTimeoutMs - 1); });
    expect(props.onError).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
    expect(frames(container)).toHaveLength(0);
  });

  it(`remove a frame that goes ${PREVIEW_PARENT_LIMITS.progressTimeoutMs} ms without progress, and progress resets the clock`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container, props } = mount();
    const [iframe] = frames(container);
    const srcdoc = iframe.getAttribute('srcdoc')!;
    const { port } = handshake(iframe);

    act(() => { vi.advanceTimersByTime(PREVIEW_PARENT_LIMITS.progressTimeoutMs - 1000); });
    port.postMessage({ token: tokenOf(iframe), type: 'progress', done: 1, total: 4 });
    await act(() => new Promise((resolve) => { setImmediate(resolve); }));
    await act(() => new Promise((resolve) => { setImmediate(resolve); }));
    act(() => { vi.advanceTimersByTime(PREVIEW_PARENT_LIMITS.progressTimeoutMs - 1000); });
    expect(props.onError).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
    expect(frames(container)).toHaveLength(0);
    expect(srcdoc.startsWith(`<meta http-equiv="Content-Security-Policy" content="${previewFramePolicy(HASH)}">`)).toBe(true);
  });
});

describe('the draw watchdog', () => {
  const { progressTimeoutMs } = PREVIEW_PARENT_LIMITS;

  /* Mounts a frame, hands it its port, and returns a function that posts a
     message from the frame and lets the parent read it. */
  function mountedFrame() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = mount();
    const [iframe] = frames(view.container);
    const { port } = handshake(iframe);
    const token = tokenOf(iframe);
    const send = async (message: Record<string, unknown>) => {
      port.postMessage({ token, ...message });
      await act(() => new Promise((resolve) => { setImmediate(resolve); }));
      await act(() => new Promise((resolve) => { setImmediate(resolve); }));
    };
    const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    return { ...view, send, wait };
  }

  /* Sets document.hidden, as a hidden tab or a minimized desktop window
     does, and fires visibilitychange. */
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
  });

  it(`keeps timing a draw after rendered, and removes the frame with timeout when it hasn't ended within ${progressTimeoutMs} ms`, async () => {
    const { container, props, send, wait } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    await send({ type: 'draw', id: 0, state: 'start' });
    wait(progressTimeoutMs - 1);
    expect(props.onError).not.toHaveBeenCalled();
    wait(1);
    expect(props.onRendered).toHaveBeenCalledOnce();
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
    expect(frames(container)).toHaveLength(0);
  });

  it('times a draw that starts before rendered across the rendered message', async () => {
    const { container, props, send, wait } = mountedFrame();
    await send({ type: 'draw', id: 0, state: 'start' });
    wait(progressTimeoutMs / 2);
    await send({ type: 'rendered', summary: SUMMARY });
    wait(progressTimeoutMs / 2);
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
    expect(frames(container)).toHaveLength(0);
  });

  it('never times out the frame while draws keep ending, and times out an open draw once none has ended', async () => {
    const { container, props, send, wait } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    for (let id = 0; id < 10; id += 1) {
      await send({ type: 'draw', id, state: 'start' });
      await send({ type: 'draw', id: id + 100, state: 'start' });
      wait(progressTimeoutMs / 2);
      await send({ type: 'draw', id, state: 'end' });
      await send({ type: 'draw', id: id + 100, state: 'end' });
    }
    wait(progressTimeoutMs * 2);
    expect(props.onError).not.toHaveBeenCalled();
    expect(frames(container)).toHaveLength(1);

    await send({ type: 'draw', id: 10, state: 'start' });
    await send({ type: 'draw', id: 11, state: 'start' });
    await send({ type: 'draw', id: 10, state: 'end' });
    wait(progressTimeoutMs);
    expect(props.onError).toHaveBeenCalledOnce();
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
  });

  it('restarts the clock of every open draw when a draw ends, since draws share the frame\'s thread', async () => {
    const { props, send, wait } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    await send({ type: 'draw', id: 0, state: 'start' });
    await send({ type: 'draw', id: 1, state: 'start' });
    wait(progressTimeoutMs - 1_000);
    await send({ type: 'draw', id: 0, state: 'end' });
    wait(progressTimeoutMs - 1);
    expect(props.onError).not.toHaveBeenCalled();
    wait(1);
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
  });

  it('stops a draw\'s clock while the page is hidden, and gives it a fresh progressTimeoutMs once it shows', async () => {
    const { container, props, send, wait } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    await send({ type: 'draw', id: 0, state: 'start' });
    wait(progressTimeoutMs - 1);
    setHidden(true);
    wait(progressTimeoutMs * 2);
    expect(props.onError).not.toHaveBeenCalled();
    setHidden(false);
    wait(progressTimeoutMs - 1);
    expect(props.onError).not.toHaveBeenCalled();
    wait(1);
    expect(props.onError).toHaveBeenCalledWith('timeout', undefined);
    expect(frames(container)).toHaveLength(0);
  });

  it('starts no clock for a draw that starts while the page is hidden until it shows', async () => {
    const { props, send, wait } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    setHidden(true);
    await send({ type: 'draw', id: 0, state: 'start' });
    wait(progressTimeoutMs * 2);
    expect(props.onError).not.toHaveBeenCalled();
    setHidden(false);
    await send({ type: 'draw', id: 0, state: 'end' });
    wait(progressTimeoutMs * 2);
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('stops watching draws once the frame reported an error', async () => {
    const { container, props, send, wait } = mountedFrame();
    await send({ type: 'draw', id: 0, state: 'start' });
    await send({ type: 'error', code: 'parse-failed' });
    await send({ type: 'draw', id: 1, state: 'start' });
    wait(progressTimeoutMs * 2);
    expect(props.onError).toHaveBeenCalledOnce();
    expect(props.onError).toHaveBeenCalledWith('parse-failed', undefined);
    expect(frames(container)).toHaveLength(1);
  });

  it(`removes a frame with internal when it reports more than ${MAX_OPEN_DRAWS} open draws`, async () => {
    const { container, props, send } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    for (let id = 0; id < MAX_OPEN_DRAWS; id += 1) await send({ type: 'draw', id, state: 'start' });
    await send({ type: 'draw', id: 0, state: 'start' });
    expect(props.onError).not.toHaveBeenCalled();
    await send({ type: 'draw', id: MAX_OPEN_DRAWS, state: 'start' });
    expect(props.onError).toHaveBeenCalledWith('internal', expect.any(String));
    expect(frames(container)).toHaveLength(0);
  });

  it('stops every draw timer when the frame unmounts', async () => {
    const { props, send, wait, unmount } = mountedFrame();
    await send({ type: 'rendered', summary: SUMMARY });
    await send({ type: 'draw', id: 0, state: 'start' });
    unmount();
    wait(progressTimeoutMs * 2);
    expect(props.onError).not.toHaveBeenCalled();
  });
});

describe('a frame that loads again', () => {
  it('is rebuilt once with a new token, and removed with internal on the next load', () => {
    const { container, props } = mount();
    const [first] = frames(container);
    act(() => { first.dispatchEvent(new Event('load')); });
    act(() => { first.dispatchEvent(new Event('load')); });

    const [rebuilt, ...others] = frames(container);
    expect(others).toHaveLength(0);
    expect(rebuilt).not.toBe(first);
    expect(tokenOf(rebuilt)).not.toBe(tokenOf(first));
    expect(props.onError).not.toHaveBeenCalled();

    act(() => { rebuilt.dispatchEvent(new Event('load')); });
    act(() => { rebuilt.dispatchEvent(new Event('load')); });
    expect(props.onError).toHaveBeenCalledWith('internal', expect.any(String));
    expect(frames(container)).toHaveLength(0);
  });

  /* A rebuilt frame that rendered and then navigated again must not stay on
     screen under its rendered summary. happy-dom fires each srcdoc frame's
     first load by itself, so each tick here stands in for that first load. */
  it('is removed with internal on the next load even after the rebuilt frame rendered', async () => {
    const { container, props } = mount();
    await tick();
    const [first] = frames(container);
    act(() => { first.dispatchEvent(new Event('load')); });
    await tick();

    const [rebuilt, ...others] = frames(container);
    expect(others).toHaveLength(0);
    expect(rebuilt).not.toBe(first);
    const { port } = handshake(rebuilt);
    port.postMessage({ token: tokenOf(rebuilt), type: 'rendered', summary: SUMMARY });
    await tick();
    expect(props.onRendered).toHaveBeenCalledWith(SUMMARY);
    expect(frames(container)).toHaveLength(1);
    expect(props.onError).not.toHaveBeenCalled();

    act(() => { rebuilt.dispatchEvent(new Event('load')); });
    expect(frames(container)).toHaveLength(0);
    expect(props.onError).toHaveBeenCalledWith('internal', expect.any(String));
  });

  it('drops the old token after the rebuild', () => {
    const { container } = mount();
    const [first] = frames(container);
    const oldToken = tokenOf(first);
    act(() => { first.dispatchEvent(new Event('load')); });
    act(() => { first.dispatchEvent(new Event('load')); });
    const [rebuilt] = frames(container);
    const sent = vi.spyOn(rebuilt.contentWindow!, 'postMessage');
    postReady(oldToken);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('asset requests', () => {
  function provider() {
    return { names: ['UniJIS-UCS2-H.bcmap'], load: vi.fn(async () => new Uint8Array([7, 7]).buffer) };
  }

  it('answer a name outside the list with bytes: null, with no load and no fetch', async () => {
    const assets = provider();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = mount({ bundle: frameBundle(assets) });
    const [iframe] = frames(container);
    const { port, received } = handshake(iframe);

    port.postMessage({ token: tokenOf(iframe), type: 'asset-request', requestId: 3, name: '../api/v1/x' });
    await tick();

    expect(received.at(-1)).toEqual({ token: tokenOf(iframe), type: 'asset', requestId: 3, name: '../api/v1/x', bytes: null });
    expect(assets.load).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('load a listed name by its exact name', async () => {
    const assets = provider();
    const { container } = mount({ bundle: frameBundle(assets) });
    const [iframe] = frames(container);
    const { port, received } = handshake(iframe);

    port.postMessage({ token: tokenOf(iframe), type: 'asset-request', requestId: 4, name: 'UniJIS-UCS2-H.bcmap' });
    await tick();

    expect(assets.load).toHaveBeenCalledWith('UniJIS-UCS2-H.bcmap');
    const reply = received.at(-1) as { requestId: number; bytes: ArrayBuffer };
    expect(reply.requestId).toBe(4);
    expect(new Uint8Array(reply.bytes)).toEqual(new Uint8Array([7, 7]));
  });

  it('answer null when the bundle has no assets', async () => {
    const { container } = mount();
    const [iframe] = frames(container);
    const { port, received } = handshake(iframe);
    port.postMessage({ token: tokenOf(iframe), type: 'asset-request', requestId: 1, name: 'UniJIS-UCS2-H.bcmap' });
    await tick();
    expect(received.at(-1)).toMatchObject({ requestId: 1, bytes: null });
  });
});

describe('unmounting', () => {
  it('removes the frame and stops listening', () => {
    const { container, unmount, props } = mount();
    const [iframe] = frames(container);
    const token = tokenOf(iframe);
    const sent = vi.spyOn(iframe.contentWindow!, 'postMessage');
    unmount();
    postReady(token);
    expect(sent).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
