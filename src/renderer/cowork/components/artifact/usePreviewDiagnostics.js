// Errors the previewed artifact reported about itself.
//
// The viewer never sees the frame's console, so a page that renders but dies
// in its first script looks like an agent failure and the agent has nothing to
// work from — it fixed the wrong thing three times in the trace behind
// three times in a row. The shim injected by cowork-server
// reports here over postMessage; this hook is the renderer-side half.

import { useCallback, useEffect, useMemo, useState } from 'react';

const MAX_ERRORS = 20;

// Every report becomes the same shape, so the banner, the dedup key and the
// payload sent to the agent all read one record type.
function normalize(data) {
  if (data.type === 'resource') {
    const kind = String(data.tagName || 'resource').toLowerCase();
    return { message: `Failed to load ${kind} ${String(data.url || '')}`, file: '', line: 0 };
  }
  if (data.type === 'csp') {
    return {
      message: `Blocked by the page security policy (${String(data.violatedDirective || '')}): `
        + `${String(data.blockedURI || '')}`,
      file: '',
      line: 0,
    };
  }
  return {
    message: String(data.message || ''),
    file: String(data.file || ''),
    line: Number(data.line) || 0,
  };
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
      // Defense-in-depth, same rule as the comments bridge: only our frame.
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (win && ev.source !== win) return;
      if (data.type === 'document-start') { setErrors([]); return; }
      const entry = normalize(data);
      if (!entry.message) return;
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
    // Keyed by the error set, not a flag: the viewer reloads the frame after
    // every save, and a banner the user closed must not reappear for the same
    // unchanged failure — only for a new one.
    dismissed: errors.length > 0 && current === dismissedSignature,
    dismiss,
  };
}

export default usePreviewDiagnostics;
