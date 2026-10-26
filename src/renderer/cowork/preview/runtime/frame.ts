/*
 * The frame half of the document preview runtime. Each renderer's bundle runs
 * it from the srcdoc that buildPreviewSrcdoc writes.
 *
 * Before it reads any byte of the file, it takes the token from its meta and
 * removes the meta, binds window.parent.postMessage, and keeps every link in
 * the frame from navigating it. It then posts FrameReady, takes the first port
 * whose message carries the token, and renders the one document that arrives
 * on that port. Every message it posts carries the token, and it drops every
 * message that doesn't.
 */
import type {
  DocumentPreviewType,
  DocumentRenderer,
  FrameReady,
  FrameToParent,
  GuardedZip,
  ParentToFrame,
  PreviewLimits,
  RendererContext,
} from '../contract';
import { previewError } from '../errors';
import { previewLimits } from '../limits';
import { guardArchive } from './archiveGuard';
import { frameFailure } from './errors';
import {
  isPreviewToken,
  MAX_ERROR_DETAIL_LENGTH,
  PREVIEW_TOKEN_META_NAME,
  readParentPort,
  readParentToFrame,
  readRenderSummary,
} from './protocol';

/* Progress only keeps the parent's watchdog from firing, so a busy renderer
   posts it at most this often. */
export const PROGRESS_INTERVAL_MS = 250;

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

function linkInPath(event: Event): Element | null {
  for (const target of event.composedPath()) {
    if (target instanceof Element && target.matches('a, area')) return target;
  }
  return null;
}

function fragmentId(href: string): string {
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

/*
 * Cancels every link activation and form submission in the frame, whatever a
 * renderer left in its DOM, so a link can't send the frame anywhere the page
 * policy would let it go. The listeners capture at the document, which every
 * click and submit in the frame passes through before its target. A link to a
 * #fragment scrolls to its target instead, which keeps the frame's URL at
 * about:srcdoc.
 */
function keepNavigationInFrame(doc: Document): void {
  const stayInFrame = (event: Event) => {
    const link = linkInPath(event);
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') ?? link.getAttributeNS(XLINK_NAMESPACE, 'href') ?? '';
    if (href.length > 1 && href.startsWith('#')) doc.getElementById(fragmentId(href))?.scrollIntoView();
  };
  doc.addEventListener('click', stayInFrame, true);
  doc.addEventListener('auxclick', stayInFrame, true);
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR_DETAIL_LENGTH);
}

async function documentBody(doc: Document): Promise<HTMLElement> {
  if (doc.readyState === 'loading') {
    await new Promise((resolve) => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  return doc.body;
}

interface FrameSession {
  win: Window;
  token: string;
  renderer: DocumentRenderer;
  post(message: FrameToParent): void;
  requestAsset(name: string): Promise<Uint8Array | null>;
}

/* Guards the archive, renders the document, and posts how it ended. */
async function renderDocument(session: FrameSession, previewType: DocumentPreviewType, bytes: ArrayBuffer): Promise<void> {
  const { win, token, renderer, post } = session;
  const controller = new AbortController();
  win.addEventListener('pagehide', () => controller.abort(), { once: true });
  let lastProgressAt = -Infinity;
  const progress = (done: number, total: number | null) => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_INTERVAL_MS && done !== total) return;
    lastProgressAt = now;
    post({ token, type: 'progress', done, total });
  };
  try {
    if (previewType !== renderer.type) {
      throw previewError('internal', `This frame renders ${renderer.type}, not ${previewType}.`);
    }
    const limits: PreviewLimits = previewLimits({ touch: win.matchMedia('(pointer: coarse)').matches });
    const guard = { limits, signal: controller.signal, onEntry: progress };
    const checked = await guardArchive(bytes, guard);
    const openZip = async (archive: ArrayBuffer): Promise<GuardedZip> => {
      if (archive === bytes && checked) return checked;
      const zip = await guardArchive(archive, guard);
      if (!zip) throw previewError('parse-failed', 'The file is not an archive.');
      return zip;
    };
    const root = win.document.createElement('div');
    root.className = 'cowork-preview-root';
    (await documentBody(win.document)).append(root);
    const context: RendererContext = {
      root,
      limits,
      signal: controller.signal,
      progress,
      openZip,
      requestAsset: session.requestAsset,
    };
    const summary = readRenderSummary(await renderer.render(bytes, context));
    if (!summary || summary.type !== renderer.type) {
      throw previewError('internal', 'The renderer returned no summary for its type.');
    }
    post({ token, type: 'rendered', summary });
  } catch (error) {
    post({ token, type: 'error', ...frameFailure(error), detail: errorDetail(error) });
  }
}

/* Answers the parent's messages on the port: the one document, and the asset
   replies. */
function servePort(port: MessagePort, win: Window, token: string, renderer: DocumentRenderer): void {
  const post = (message: FrameToParent) => port.postMessage(message);
  const pendingAssets = new Map<number, { name: string; resolve(bytes: ArrayBuffer | null): void }>();
  let nextRequestId = 0;
  let started = false;
  const requestAsset = (name: string): Promise<Uint8Array | null> => new Promise((resolve) => {
    const requestId = nextRequestId;
    nextRequestId += 1;
    pendingAssets.set(requestId, { name, resolve: (bytes) => resolve(bytes ? new Uint8Array(bytes) : null) });
    post({ token, type: 'asset-request', requestId, name });
  });
  port.onmessage = (event: MessageEvent) => {
    const message: ParentToFrame | null = readParentToFrame(event.data, token);
    if (!message) return;
    if (message.type === 'asset') {
      const pending = pendingAssets.get(message.requestId);
      if (!pending || pending.name !== message.name) return;
      pendingAssets.delete(message.requestId);
      pending.resolve(message.bytes);
      return;
    }
    if (started) return;
    started = true;
    void renderDocument({ win, token, renderer, post, requestAsset }, message.previewType, message.bytes);
  };
}

export function startPreviewFrame(renderer: DocumentRenderer, win: Window = window): void {
  const meta = win.document.querySelector(`meta[name="${PREVIEW_TOKEN_META_NAME}"]`);
  const token = meta?.getAttribute('content') ?? '';
  meta?.remove();
  if (!isPreviewToken(token)) return;
  const parent = win.parent;
  const postToParent = parent.postMessage.bind(parent);
  keepNavigationInFrame(win.document);
  const onWindowMessage = (event: MessageEvent) => {
    const port = event.ports[0];
    if (!readParentPort(event.data, token) || !port) return;
    win.removeEventListener('message', onWindowMessage);
    servePort(port, win, token, renderer);
  };
  win.addEventListener('message', onWindowMessage);
  const ready: FrameReady = { source: 'cowork-document-preview', type: 'ready', token };
  postToParent(ready, '*');
}
