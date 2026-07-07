// postMessage bridge between the renderer and the on-artifact marker layer
// injected into the preview iframe by cowork-server (comments_layer.py).
//
// The layer is credential-free and owns DOM concerns only; this hook is the
// renderer-side half of the contract:
//   layer -> here : ready / create / reply / status / count / mode
//   here -> layer : list / enter-mode / exit-mode / focus / hl-on / hl-off
//
// It pushes the (normalized) comment set down whenever it changes or the layer
// (re)announces readiness, dispatches the layer's mutation intents to the
// shared useArtifactComments handlers, and returns imperative controls the
// viewer/sidebar drive (comment-placement mode, go-to, hover highlight).

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeThreadForLayer } from '../../lib/commentsReducer';

export function useArtifactCommentLayer(
  iframeRef,
  { threads, enabled, onCreate, onReply, onStatus } = {},
) {
  const [mode, setMode] = useState(false); // comment-placement active in the iframe

  // Keep the latest values addressable from the (stable) message listener.
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const handlersRef = useRef({ onCreate, onReply, onStatus });
  handlersRef.current = { onCreate, onReply, onStatus };

  const postToLayer = useCallback((msg) => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (!win) return;
    try { win.postMessage({ source: 'anton-comments', ...msg }, '*'); } catch { /* frame gone */ }
  }, [iframeRef]);

  const sendList = useCallback(() => {
    postToLayer({ type: 'list', comments: (threadsRef.current || []).map(normalizeThreadForLayer) });
  }, [postToLayer]);

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
      // it does reject other windows spoofing the source tag.)
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (win && ev.source !== win) return;
      const h = handlersRef.current;
      switch (d.type) {
        // The layer announces readiness during document parse (before the
        // iframe's `load` event). We hold no "ready" gate — every announcement
        // just (re)pushes the current set, and threads-change also pushes — so
        // ordering between 'ready' and load can't strand the layer with a stale
        // or empty list.
        case 'ready': sendList(); break;
        case 'create': h.onCreate && h.onCreate({ selector: d.selector || null, text: d.text }); break;
        case 'reply': h.onReply && h.onReply(d.id, d.text); break;
        case 'status': h.onStatus && h.onStatus(d.id, d.status); break;
        case 'mode': setMode(!!d.active); break;
        default: break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, iframeRef, sendList]);

  // Re-push the list whenever comments change. Best-effort: if the layer isn't
  // live yet the message is dropped, but its 'ready' announcement will pull the
  // current set, and every later change re-pushes.
  useEffect(() => {
    if (enabled) sendList();
  }, [enabled, threads, sendList]);

  // A navigation inside the iframe re-injects the layer (which re-announces
  // 'ready'); re-push best-effort too, in case that message is missed.
  const onIframeLoad = useCallback(() => { if (enabled) sendList(); }, [enabled, sendList]);

  const enterMode = useCallback(() => postToLayer({ type: 'enter-mode' }), [postToLayer]);
  const exitMode = useCallback(() => postToLayer({ type: 'exit-mode' }), [postToLayer]);
  const toggleMode = useCallback(() => postToLayer({ type: mode ? 'exit-mode' : 'enter-mode' }), [postToLayer, mode]);
  const focus = useCallback((id) => postToLayer({ type: 'focus', commentId: id }), [postToLayer]);
  const hlOn = useCallback((id) => postToLayer({ type: 'hl-on', commentId: id }), [postToLayer]);
  const hlOff = useCallback((id) => postToLayer({ type: 'hl-off', commentId: id }), [postToLayer]);

  return { mode, onIframeLoad, enterMode, exitMode, toggleMode, focus, hlOn, hlOff };
}

export default useArtifactCommentLayer;
