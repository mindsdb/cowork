// HTTP + SSE client for the docs API (cowork-server /api/v1/docs).
import { BASE, authFetch } from '../../api';
import { iterateSSE } from '../../lib/responseStreamAdapter';

async function call(path, options = {}) {
  const res = await authFetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    let detail = null;
    try { detail = (await res.json())?.detail; } catch { /* not JSON */ }
    const err = new Error(
      (detail && (detail.message || (typeof detail === 'string' ? detail : null))) || `Doc request failed (${res.status})`,
    );
    err.status = res.status;
    err.code = detail?.code;
    err.detail = detail;
    throw err;
  }
  return res.json();
}

const docPath = (projectRef, artifactId) =>
  `/docs/${encodeURIComponent(projectRef || 'local')}/${encodeURIComponent(artifactId)}`;

export const fetchDoc = (projectRef, artifactId) => call(docPath(projectRef, artifactId));

// An edit not answered in this long is given up on. Whether the server applied
// it is not known then, so useDoc rereads the doc rather than send it again.
const OPS_TIMEOUT_MS = 30_000;

export async function postDocOps(projectRef, artifactId, { ops, tab, clientId }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPS_TIMEOUT_MS);
  try {
    return await call(`${docPath(projectRef, artifactId)}/ops`, {
      method: 'POST',
      body: JSON.stringify({ ops, ...(tab ? { tab } : {}), clientId }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
    throw Object.assign(new Error('The server took too long to answer.'), { code: 'timeout' });
  } finally {
    clearTimeout(timer);
  }
}

/** Download an export through the authenticated fetch, then hand it to the browser. */
export async function downloadDocExport(projectRef, artifactId, format) {
  const res = await authFetch(`${BASE}${docPath(projectRef, artifactId)}/export?format=${encodeURIComponent(format)}`);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || `doc.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

/** The doc's Markdown, for "Copy as Markdown". */
export async function fetchDocMarkdown(projectRef, artifactId) {
  const res = await authFetch(`${BASE}${docPath(projectRef, artifactId)}/export?format=md`);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return res.text();
}

// A stream that never opened stops after this many tries: a server without the
// route, or no server at all, should not keep a retry loop running for as long
// as the view lives. One that opened and dropped keeps reconnecting.
const MAX_ATTEMPTS_NEVER_CONNECTED = 3;

/**
 * Follow an SSE stream with reconnects. Returns a stop() function.
 * `onEvent` gets each parsed frame; `onReconnect` fires after a dropped
 * stream comes back, so the caller can refetch what it may have missed.
 */
function follow(path, { onEvent, onReconnect }) {
  let stopped = false;
  let ctrl = null;
  let attempt = 0;
  let connected = false;
  (async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await authFetch(BASE + path, { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
        // A refused request (bad id, no access, no route) gets the same answer
        // next time; only a timeout or rate limit is worth asking again.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return;
        if (res.ok && res.body) {
          if (attempt > 0) onReconnect?.();
          attempt = 0;
          connected = true;
          for await (const ev of iterateSSE(res)) {
            if (stopped) return;
            onEvent?.(ev);
          }
        }
      } catch {
        if (stopped) return;
      }
      attempt += 1;
      if (!connected && attempt >= MAX_ATTEMPTS_NEVER_CONNECTED) return;
      await new Promise((r) => setTimeout(r, Math.min(10_000, 500 * 2 ** Math.min(attempt, 5))));
    }
  })();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}

export const followDoc = (projectRef, artifactId, handlers) => follow(`${docPath(projectRef, artifactId)}/events`, handlers);

export const followConversationDocs = (conversationId, handlers) =>
  follow(`/docs/events?conversation_id=${encodeURIComponent(conversationId)}`, handlers);
