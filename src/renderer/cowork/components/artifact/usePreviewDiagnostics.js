// Errors the previewed artifact reported about itself.
//
// The viewer never sees the frame's console, so a page that renders but dies
// in its first script looks like an agent failure, and the agent has nothing
// to work from: in the trace this came from it repaired the wrong thing three
// times in a row. The shim injected by cowork-server
// reports here over postMessage; this hook is the renderer-side half.

import { useCallback, useEffect, useMemo, useState } from 'react';

const MAX_ERRORS = 20;
// Matches the server's cap (cowork/services/artifact_revisions.py,
// _MAX_PREVIEW_MESSAGE) so the notice and the repair payload never show more
// than the server would have kept anyway.
const MAX_MESSAGE_LENGTH = 300;

// Every report becomes the same shape, so the banner, the dedup key and the
// payload sent to the agent all read one record type. Returns null for a
// type we don't recognize or a report too empty to say anything useful.
function normalize(data) {
  if (data.type === 'resource') {
    const kind = String(data.tagName || 'resource').toLowerCase();
    const url = String(data.url || '').trim();
    if (!url) return null;
    return { message: `Failed to load ${kind} ${url}`, file: '', line: 0 };
  }
  if (data.type === 'csp') {
    const directive = String(data.violatedDirective || '').trim();
    const blockedUri = String(data.blockedURI || '').trim();
    if (!directive && !blockedUri) return null;
    const target = directive ? ` (${directive})` : '';
    const source = blockedUri ? `: ${blockedUri}` : '';
    return { message: `Blocked by the page security policy${target}${source}`, file: '', line: 0 };
  }
  if (data.type === 'error') {
    return {
      message: String(data.message || ''),
      file: String(data.file || ''),
      line: Number(data.line) || 0,
    };
  }
  return null;
}

function signature(errors) {
  return errors.map((e) => `${e.message}|${e.file}|${e.line}`).join('\n');
}

export function usePreviewDiagnostics(iframeRef, { enabled = true, resetKey = '' } = {}) {
  const [errors, setErrors] = useState([]);
  const [dismissedSignature, setDismissedSignature] = useState('');

  // A new document, from the shim itself. NOT the iframe's load event: the
  // error this exists for is thrown while the document is still parsing, so
  // its report reaches us before load and a reset there would wipe it.
  // Resource failures land on both sides of load, which rules load out twice.
  useEffect(() => {
    if (!enabled) return undefined;
    const onMessage = (ev) => {
      const data = ev.data || {};
      if (data.source !== 'anton-preview') return;
      // Only our frame. Unlike the comments bridge, reject rather than pass
      // when there's no frame to compare against: `enabled` mirrors exactly
      // the iframe's mount condition (ArtifactViewerBody.jsx), so ref and
      // listener are set up in the same commit and the ref is never null
      // while this listener is live — a message here with no ref has no
      // legitimate source.
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (!win || ev.source !== win) return;
      if (data.type === 'document-start') {
        // Bail out to the same array when the list is already empty, so a
        // page that spams document-start (e.g. an in-frame reload loop)
        // doesn't force a re-render of the whole viewer on every message.
        setErrors((prev) => (prev.length ? [] : prev));
        return;
      }
      const entry = normalize(data);
      if (!entry || !entry.message) return;
      entry.message = entry.message.slice(0, MAX_MESSAGE_LENGTH);
      setErrors((prev) => {
        if (prev.length >= MAX_ERRORS) return prev;
        const duplicate = prev.some((e) => e.message === entry.message
          && e.file === entry.file && e.line === entry.line);
        return duplicate ? prev : [...prev, entry];
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, iframeRef]);

  // Backstop for a document whose shim never ran (non-UTF-8 source, or a page
  // whose own meta CSP blocks inline script): the previewed document changed,
  // so the previous document's errors are no longer about anything on screen.
  //
  // `enabled` is in here too because the viewer stays mounted when it closes
  // (ArtifactViewer.jsx:594-608 returns null but keeps its hooks). Without it,
  // reopening the same artifact would flash the previous session's banner
  // until the mount effect swapped the preview URL.
  useEffect(() => {
    setErrors([]);
    setDismissedSignature('');
  }, [enabled, resetKey]);

  const current = useMemo(() => signature(errors), [errors]);
  const dismiss = useCallback(() => setDismissedSignature(current), [current]);

  return {
    errors,
    // Keyed by the error set, not a flag, so a dismissal survives the shim
    // re-announcing the same document (document-start with no new errors)
    // instead of only ever surviving one render. It does NOT survive a save:
    // the mount effect resets previewUrl/previewDoc to '' on every run and a
    // save bumps the cache-busting nonce, so `resetKey` changes, the effect
    // above clears `dismissedSignature`, and the banner comes back even for
    // an unchanged failure. That's intended here — the content did change (a
    // new revision was written), so treating it as worth re-flagging is the
    // safer default even when the same bug happens to still be present.
    dismissed: errors.length > 0 && current === dismissedSignature,
    dismiss,
  };
}

export default usePreviewDiagnostics;
