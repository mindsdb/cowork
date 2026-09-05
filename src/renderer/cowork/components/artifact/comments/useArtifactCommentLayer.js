// Credential-free iframe layer owns DOM interactions; this hook owns state and mutation dispatch.
// Layer contract: cowork-server comments_layer.py. Re-send comments whenever the layer announces
// readiness.

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeThreadForLayer } from '../../../lib/commentsReducer';

export function useArtifactCommentLayer(
  iframeRef,
  {
    threads, viewer, enabled, onCreate, onReply, onStatus,
    onEditThread, onDeleteThread, onEditReply, onDeleteReply,
    // Push an empty list while markers are hidden, including on reload, so the layer cannot flash
    // stale pins.
    markersVisible = true,
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
  const handlersRef = useRef({});
  handlersRef.current = {
    onCreate, onReply, onStatus, onEditThread, onDeleteThread, onEditReply, onDeleteReply,
  };

  const postToLayer = useCallback((msg) => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (!win) return;
    try { win.postMessage({ source: 'anton-comments', ...msg }, '*'); } catch { /* frame gone */ }
  }, [iframeRef]);

  const sendList = useCallback(() => {
    postToLayer({
      type: 'list',
      comments: markersRef.current
        ? (threadsRef.current || []).map(normalizeThreadForLayer)
        : [], // "Hide comment": empty list clears the layer's pins (no server change)
      viewer: viewerRef.current || null,
    });
  }, [postToLayer]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onMessage = (ev) => {
      const d = ev.data || {};
      if (d.source !== 'anton-comments') return;
      // Reject messages from other windows. This does not isolate artifact JavaScript within our
      // iframe,
      // which already shares the comments API origin.
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (win && ev.source !== win) return;
      const h = handlersRef.current;
      switch (d.type) {
        // Push on every ready announcement and thread change; ready can precede iframe load, so a
        // separate gate could miss updates.
        case 'ready': sendList(); break;
        case 'create': h.onCreate && h.onCreate({ selector: d.selector || null, text: d.text }); break;
        case 'reply': h.onReply && h.onReply(d.id, d.text); break;
        case 'status': h.onStatus && h.onStatus(d.id, d.status); break;
        case 'edit': h.onEditThread && h.onEditThread(d.id, d.text); break;
        case 'delete': h.onDeleteThread && h.onDeleteThread(d.id); break;
        case 'edit-reply': h.onEditReply && h.onEditReply(d.id, d.replyId, d.text); break;
        case 'delete-reply': h.onDeleteReply && h.onDeleteReply(d.id, d.replyId); break;
        case 'mode': setMode(!!d.active); break;
        // Ignore empty anchor-state maps while markers are hidden so inbox chips retain their last
        // known state.
        case 'anchor-states': if (markersRef.current) setAnchorStates(d.states || {}); break;
        default: break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, iframeRef, sendList]);

  // Re-send on changes; if the layer is not ready, its ready announcement pulls the current list.
  useEffect(() => {
    if (enabled) sendList();
  }, [enabled, threads, markersVisible, sendList]);

  // Re-send after iframe navigation in case the layer’s ready announcement was missed.
  const onIframeLoad = useCallback(() => { if (enabled) sendList(); }, [enabled, sendList]);

  const exitMode = useCallback(() => postToLayer({ type: 'exit-mode' }), [postToLayer]);
  const toggleMode = useCallback(() => postToLayer({ type: mode ? 'exit-mode' : 'enter-mode' }), [postToLayer, mode]);
  const focus = useCallback((id) => postToLayer({ type: 'focus', commentId: id }), [postToLayer]);
  const hlOn = useCallback((id) => postToLayer({ type: 'hl-on', commentId: id }), [postToLayer]);
  const hlOff = useCallback((id) => postToLayer({ type: 'hl-off', commentId: id }), [postToLayer]);

  return { mode, anchorStates, onIframeLoad, exitMode, toggleMode, focus, hlOn, hlOff };
}

export default useArtifactCommentLayer;
