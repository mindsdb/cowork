// The doc transport for a shared doc's page: its owner, signed in on view.*,
// reads the live copy the desktop mirrors to MindsHub and sends edits that the
// desktop applies through its one write path, then mirrors again.
//
// Same three calls as the app's docApi (fetchDoc, followDoc, postDocOps), so
// useDoc and DocCanvas run unchanged. All requests are same-origin: the view
// edge turns the signed-in session into a short viewer token for inference.

import { STOCK_PRODUCT_NAME } from '../../shared/product-name';

// A desktop that is there applies an edit within a second or two. Past this,
// the page says the edit waits for the app rather than keeping "Saving…" up.
const EDIT_TIMEOUT_MS = 10_000;
const POLL_MS = 1500;
// An edit waiting for an app that is away can wait for hours. Its answer
// comes over the stream; the poll only covers a stream that missed it.
const AWAY_POLL_MS = 10_000;
const KEEP_RESULTS_MS = 60_000;
// The door's answer once the page's grant has lapsed. The grant is minted when
// the doc's page loads and renewed by each answer through the door; a laptop
// asleep past its life, say, lets it go, and only loading the page mints
// another.
const GRANT_LAPSED = 'artifact access required';
// A browser gives up for good on a stream the server answered other than 200
// (a 5xx while MindsHub rolls out, say). Opened again after these waits, each
// longer, unless the answer was the grant lapsing or sharing stopped.
const REOPEN_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export class DocRequestError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Why an edit is deferred: the desktop has not applied it, and MindsHub keeps it until the app is open. */
const ownerAway = () => new DocRequestError(
  `${STOCK_PRODUCT_NAME} on your computer has not saved this yet. It will apply when the app is open.`,
  { code: 'owner_offline' },
);

/** The door refused the page for a lapsed grant: nothing through it works until the page loads again. */
const grantLapsed = () => new DocRequestError(
  'This page has been open a while. Reload it to keep editing.',
  { status: 403, code: 'grant_lapsed' },
);

/** A stream frame's payload; null for one that isn't JSON, which says nothing. */
function frame(e) {
  try { return JSON.parse(e.data); } catch { return null; }
}

export function createCloudTransport(apiBase, { onPresence, onRemoved, onLapsed, fetchImpl, EventSourceImpl } = {}) {
  const fetchFn = fetchImpl || ((...a) => fetch(...a));
  const ES = EventSourceImpl || (typeof EventSource !== 'undefined' ? EventSource : null);
  let latest = null; // the newest copy seen, from a read or the stream
  const streams = new Set();
  // The page's grant to the door lapsed. Every call would be refused until the
  // page loads again, so none is made: the stream and the polls stop, and an
  // edit waiting stays where it is (in flight, so useDoc's queue waits too).
  let lapsed = false;
  const lapse = () => {
    if (lapsed) return;
    lapsed = true;
    for (const source of streams) source.close();
    onLapsed?.();
  };
  const waiting = new Map(); // edit id -> settle(result)
  const results = new Map(); // edit id -> result that arrived before anyone waited
  // An edit went unanswered although the relay called the desktop online. An
  // app that crashed or quit stays "online" there until its presence lapses,
  // so until the desktop itself is heard from again (a mirrored copy or an
  // edit result on the stream), it is away whatever a read says.
  let unanswered = false;
  const heard = () => {
    unanswered = false;
    onPresence?.(true);
  };

  const remember = (doc) => {
    if (doc && (!latest || doc.rev >= latest.rev)) latest = doc;
  };

  async function call(path, options = {}) {
    if (lapsed) throw grantLapsed();
    const res = await fetchFn(apiBase + path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    // A 401 is the session (signed out), not the grant.
    if (res.status === 403 && body?.error === GRANT_LAPSED) {
      lapse();
      throw grantLapsed();
    }
    if (!res.ok) {
      const detail = body?.detail;
      throw new DocRequestError(
        (typeof detail === 'string' && detail) || detail?.message || `Request failed (${res.status})`,
        { status: res.status, code: detail?.code },
      );
    }
    return body;
  }

  function settle(result) {
    const done = waiting.get(result.id);
    if (done) {
      waiting.delete(result.id);
      done(result);
    } else {
      results.set(result.id, result);
      setTimeout(() => results.delete(result.id), KEEP_RESULTS_MS);
    }
  }

  // Resolve when the desktop answers: over the stream, or by polling in case the
  // stream is reconnecting. A desktop that has not answered within seconds is
  // away: the edit is deferred, and still resolves once the app is open and
  // has applied (or refused) it.
  function waitForEdit(id, { away, onDeferred }) {
    if (results.has(id)) {
      const r = results.get(id);
      results.delete(id);
      return Promise.resolve(r);
    }
    return new Promise((resolve) => {
      const started = Date.now();
      let deferred = away;
      let timer = null;
      const finish = (r) => { clearTimeout(timer); resolve(r); };
      waiting.set(id, finish);
      const poll = async () => {
        if (!waiting.has(id) || lapsed) return;
        if (!deferred && Date.now() - started > EDIT_TIMEOUT_MS) {
          deferred = true;
          unanswered = true;
          onPresence?.(false);
          onDeferred?.(ownerAway());
        }
        try {
          const r = await call(`/edits/${encodeURIComponent(id)}`);
          if (r.status !== 'pending') { settle(r); return; }
        } catch { /* try again */ }
        if (lapsed) return;
        timer = setTimeout(poll, deferred ? AWAY_POLL_MS : POLL_MS);
      };
      timer = setTimeout(poll, deferred ? AWAY_POLL_MS : POLL_MS);
    });
  }

  async function fetchDoc() {
    const res = await call('/state');
    remember(res.doc);
    onPresence?.(unanswered ? false : res.ownerOnline);
    // As boot() reads it: no capabilities, no editing.
    return { doc: res.doc, capabilities: res.capabilities || { canEdit: false }, card: null };
  }

  function followDoc(_projectRef, _artifactId, handlers) {
    if (!ES) return () => {};
    let opened = false;
    let stopped = false;
    let failures = 0;
    let reopen = null;
    let source = null;
    const open = () => {
      const mine = new ES(`${apiBase}/stream`, { withCredentials: true });
      source = mine;
      streams.add(mine);
      // Refused (a stream cannot read why) or given up on: a read says whether
      // the grant lapsed, and if it didn't, the stream is opened again.
      mine.onerror = () => {
        if (mine.readyState !== (ES.CLOSED ?? 2) || stopped) return;
        streams.delete(mine);
        call('/state').catch(() => {}).finally(() => {
          if (stopped || lapsed) return;
          reopen = setTimeout(open, REOPEN_MS[Math.min(failures, REOPEN_MS.length - 1)]);
          failures += 1;
        });
      };
      mine.onopen = () => {
        failures = 0;
        // A reconnect may have missed copies: reread (useDoc's onReconnect).
        if (opened) handlers.onReconnect?.();
        opened = true;
      };
      mine.addEventListener('doc.state', (e) => {
        const ev = frame(e);
        if (!ev) return;
        remember(ev.doc);
        heard();
        handlers.onEvent?.({ type: 'doc.updated', rev: ev.rev, doc: ev.doc, by: 'user' });
      });
      mine.addEventListener('doc.edit.result', (e) => {
        const result = frame(e);
        if (!result?.id) return;
        heard();
        settle(result);
      });
      mine.addEventListener('doc.removed', () => {
        stopped = true;
        mine.close();
        onRemoved?.(); // sharing stopped: the page goes back to read-only
      });
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(reopen);
      streams.delete(source);
      source.close();
    };
  }

  async function postDocOps(_projectRef, _artifactId, body, options) {
    try {
      return await sendEdit(body, options);
    } catch (e) {
      // Not refused: it stays in flight, still shown, until the page reloads
      // (which loses it if it was not sent; the page says so).
      if (e.code === 'grant_lapsed') return new Promise(() => {});
      throw e;
    }
  }

  async function sendEdit({ ops, tab, clientId, baseRev }, { onDeferred } = {}) {
    const sent = await call('/edits', {
      method: 'POST',
      body: JSON.stringify({ ops, ...(tab ? { tab } : {}), clientId, ...(baseRev != null ? { baseRev } : {}) }),
    });
    const away = sent.ownerOnline === false;
    if (away) {
      // Known to be away: say so now. The edit waits in MindsHub and is
      // answered once the app is open.
      onPresence?.(false);
      onDeferred?.(ownerAway());
    }
    const result = await waitForEdit(sent.id, { away, onDeferred });
    if (result.status === 'rejected') {
      throw new DocRequestError(result.error?.message || 'That edit was not saved.', { code: result.error?.code });
    }
    heard();
    // The desktop mirrors before it reports, so the stream usually has the new
    // copy already; read it if not.
    if (!latest || (result.rev != null && latest.rev < result.rev)) remember((await call('/state')).doc);
    return { doc: latest, rev: latest.rev };
  }

  return { fetchDoc, followDoc, postDocOps };
}
