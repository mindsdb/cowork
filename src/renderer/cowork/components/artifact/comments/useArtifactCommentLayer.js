// postMessage bridge between the renderer and the on-artifact marker layer
// injected into the preview iframe by cowork-server (comments_layer.py).
//
// The layer is credential-free and owns DOM concerns only; this hook is the
// renderer-side half of the contract:
//   layer -> here : ready / create / reply / status / count / mode
//   here -> layer : list / images / enter-mode / exit-mode / focus / hl-on / hl-off
//
// Images (ENG-4410): `create` and `reply` may carry the Files pasted into the
// layer's composer; they are checked here like any other paste and handed to
// the viewer, which stores them and names them in the text. The layer has no
// credential, so the images the threads name are read here (`loadImage`) and
// pushed down as Blobs in an `images` message, which the layer shows.
//
// It pushes the (normalized) comment set down whenever it changes or the layer
// (re)announces readiness, dispatches the layer's mutation intents to the
// shared useArtifactComments handlers, and returns imperative controls the
// viewer/toolbar/inbox drive (comment-placement mode, go-to, hover highlight).

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeThreadForLayer } from '../../../lib/commentsReducer';
import { threadImages } from '../../../lib/commentImages';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from '../../../lib/imageAttachments';

// The layer runs inside the artifact's frame, so what it sends is checked as
// untrusted: Blobs of an image type and size the paste would take, a few.
export function layerImages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item instanceof Blob
      && IMAGE_TYPES.includes(String(item.type || '').toLowerCase())
      && item.size > 0 && item.size <= MAX_IMAGE_BYTES)
    .slice(0, MAX_IMAGES)
    .map((item) => (item instanceof File ? item : new File([item], 'image', { type: item.type })));
}

export function useArtifactCommentLayer(
  iframeRef,
  {
    threads, viewer, enabled, onCreate, onReply, onStatus,
    onEditThread, onDeleteThread, onEditReply, onDeleteReply,
    // Pin visibility, owned by the comments toolbar's Hide/Show. The injected
    // layer draws a pin for every thread in the pushed `list`, so we hide pins
    // WITHOUT a server change by pushing an empty list; showing re-pushes the
    // real set. Baked into every push so a (re)loading layer can't flash pins.
    markersVisible = true,
    // Reads a comment image by id as a Blob; absent: the layer shows none.
    loadImage = null,
  } = {},
) {
  const [mode, setMode] = useState(false); // comment-placement active in the iframe
  // Per-thread anchor state reported by the layer: id -> 'hidden' | 'orphan'.
  // Drives the inbox chips ("hidden" / "unanchored").
  const [anchorStates, setAnchorStates] = useState({});

  // Keep the latest values addressable from the (stable) message listener.
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const markersRef = useRef(markersVisible);
  markersRef.current = markersVisible;
  const loadImageRef = useRef(loadImage);
  loadImageRef.current = loadImage;
  // id -> Blob, or a Promise while it loads; kept for the viewer's life.
  const imagesRef = useRef(new Map());
  const handlersRef = useRef({});
  handlersRef.current = {
    onCreate, onReply, onStatus, onEditThread, onDeleteThread, onEditReply, onDeleteReply,
  };

  const postToLayer = useCallback((msg) => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (!win) return;
    try { win.postMessage({ source: 'anton-comments', ...msg }, '*'); } catch { /* frame gone */ }
  }, [iframeRef]);

  // Every image the shown threads name: those already read go down at once,
  // the rest as each arrives. An image that can't be read is simply not shown.
  const sendImages = useCallback(() => {
    const load = loadImageRef.current;
    if (!load || !markersRef.current) return;
    const ready = {};
    for (const thread of threadsRef.current || []) {
      for (const { id } of threadImages(thread)) {
        const known = imagesRef.current.get(id);
        if (known instanceof Blob) {
          ready[id] = known;
        } else if (!known) {
          const loading = load(id).then((blob) => {
            imagesRef.current.set(id, blob);
            postToLayer({ type: 'images', images: { [id]: blob } });
          }, () => { /* left as the layer's placeholder */ });
          imagesRef.current.set(id, loading);
        }
      }
    }
    if (Object.keys(ready).length) postToLayer({ type: 'images', images: ready });
  }, [postToLayer]);

  const sendList = useCallback(() => {
    postToLayer({
      type: 'list',
      comments: markersRef.current
        ? (threadsRef.current || []).map(normalizeThreadForLayer)
        : [], // "Hide comment": empty list clears the layer's pins (no server change)
      viewer: viewerRef.current || null,
    });
    sendImages();
  }, [postToLayer, sendImages]);

  // Inbound messages from the layer. One stable listener; reads live values via
  // refs so it never needs re-subscribing.
  useEffect(() => {
    if (!enabled) return undefined;
    const onMessage = (ev) => {
      const d = ev.data || {};
      if (d.source !== 'anton-comments') return;
      // Defense-in-depth: only trust messages from OUR iframe. (This does not
      // isolate untrusted artifact JS running in the same frame — that script
      // can already reach the comments API directly on the shared origin — but
      // it does reject other windows spoofing the source tag.) With no iframe
      // mounted there is no layer to hear from, so every message is dropped.
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (!win || ev.source !== win) return;
      const h = handlersRef.current;
      switch (d.type) {
        // The layer announces readiness during document parse (before the
        // iframe's `load` event). We hold no "ready" gate — every announcement
        // just (re)pushes the current set, and threads-change also pushes — so
        // ordering between 'ready' and load can't strand the layer with a stale
        // or empty list.
        case 'ready': sendList(); break;
        case 'create': h.onCreate && h.onCreate({ selector: d.selector || null, text: d.text, images: layerImages(d.images) }); break;
        case 'reply': h.onReply && h.onReply(d.id, d.text, layerImages(d.images)); break;
        case 'status': h.onStatus && h.onStatus(d.id, d.status); break;
        case 'edit': h.onEditThread && h.onEditThread(d.id, d.text); break;
        case 'delete': h.onDeleteThread && h.onDeleteThread(d.id); break;
        case 'edit-reply': h.onEditReply && h.onEditReply(d.id, d.replyId, d.text); break;
        case 'delete-reply': h.onDeleteReply && h.onDeleteReply(d.id, d.replyId); break;
        case 'mode': setMode(!!d.active); break;
        // Freeze while pins are hidden: "Hide comment" pushes an EMPTY list to
        // the layer, which then reports an empty state map. Applying it would
        // flicker the chips away (and re-enable hover) in an open inbox. Keep
        // the last known states until pins — and the real list — come back.
        case 'anchor-states': if (markersRef.current) setAnchorStates(d.states || {}); break;
        default: break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, iframeRef, sendList]);

  // Re-push the list whenever comments OR marker visibility change. Best-effort:
  // if the layer isn't live yet the message is dropped, but its 'ready'
  // announcement will pull the current set, and every later change re-pushes.
  useEffect(() => {
    if (enabled) sendList();
  }, [enabled, threads, markersVisible, sendList]);

  // A navigation inside the iframe re-injects the layer (which re-announces
  // 'ready'); re-push best-effort too, in case that message is missed.
  const onIframeLoad = useCallback(() => { if (enabled) sendList(); }, [enabled, sendList]);

  const exitMode = useCallback(() => postToLayer({ type: 'exit-mode' }), [postToLayer]);
  const setPlacing = useCallback((on) => postToLayer({ type: on ? 'enter-mode' : 'exit-mode' }), [postToLayer]);
  const toggleMode = useCallback(() => postToLayer({ type: mode ? 'exit-mode' : 'enter-mode' }), [postToLayer, mode]);
  const focus = useCallback((id) => postToLayer({ type: 'focus', commentId: id }), [postToLayer]);
  const hlOn = useCallback((id) => postToLayer({ type: 'hl-on', commentId: id }), [postToLayer]);
  const hlOff = useCallback((id) => postToLayer({ type: 'hl-off', commentId: id }), [postToLayer]);

  return { mode, anchorStates, onIframeLoad, exitMode, toggleMode, setPlacing, focus, hlOn, hlOff };
}

export default useArtifactCommentLayer;
