// useDoc — one open doc: load, follow live changes, and write.
//
// The person's edits are applied locally first (`applyLocal`) and queued; the
// queue drains one request at a time, and each answer from the server becomes
// the new base with whatever is still queued replayed on top. Changes made by
// anyone else — the agent writing a section, another window — arrive on the
// doc's event stream and are rebased the same way, so a person typing while
// the agent writes never loses keystrokes and never sees the agent's text
// jump under the caret.
//
// `transport` is where the doc lives, the caller's to choose, behind three
// calls: fetchDoc(projectRef, artifactId) → { doc, capabilities, card },
// followDoc(projectRef, artifactId, { onEvent, onReconnect }) → stop, and
// postDocOps(projectRef, artifactId, body) → { doc }.
//
// Undo and redo are the doc's, not the browser's: the browser's Cmd+Z knows
// only typing and runs across every block on the page. The server answers
// each of the person's writes with `undo`, the ops that put back what it
// changed (cowork-server docs/undo.py); an undo is a write of those, and its
// answer's `undo` is the redo. One is sent only while what it would put back
// still reads as that write left it (`undoStillApplies`), so it never takes
// the agent's later change with it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyLocal, holdsEdit, newId, undoStillApplies } from './docModel';

const FLASH_MS = 1800;
export const AGENT_ACTIVE_MS = 4000;
// Retry waits while the doc's server can't be reached (it restarting, say).
const RETRY_MS = [1000, 2000, 4000, 8000];

/** No answer of any kind (fetch's TypeError): the edit never reached the server. */
const notSent = (e) => e instanceof TypeError;

// Steps kept to undo; a longer history is the version history's.
const UNDO_STEPS = 100;

/** The server failed, or took too long to answer: the edit may have landed or not. */
const outcomeUnknown = (e) => e?.code === 'timeout' || (typeof e?.status === 'number' && e.status >= 500);

export function useDoc({ projectRef, artifactId, transport }) {
  const { fetchDoc, followDoc, postDocOps } = transport;
  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  // The doc's artifact card: its rendered page (htmlPath) and publish state.
  const [card, setCard] = useState(null);
  const [saving, setSaving] = useState(false);
  const [agentActive, setAgentActive] = useState(false);
  const [flash, setFlash] = useState({});
  const [writeError, setWriteError] = useState(null);

  const clientId = useMemo(() => newId('client_'), []);
  // One run per open doc (per run of the effect below): its server copy
  // (`base`), the edits not yet answered (`queue`) and their retry, bound to
  // that doc. Only the open run reaches the screen: every await checks it
  // still is, so an answer for the doc open before never lands on the next
  // one. An ended run still sends what it queued, to its own doc.
  const run = useRef(null);
  const agentTimer = useRef(null);

  const rebase = useCallback(() => {
    const r = run.current;
    let d = r?.base;
    if (!d) return;
    for (const item of r.queue) d = applyLocal(d, item.ops, { tab: item.tab }) || d;
    setDoc(d);
  }, []);

  /** Read the doc into the open run; true once it has. */
  const load = useCallback(async () => {
    const r = run.current;
    if (!r) return false;
    try {
      const res = await fetchDoc(r.projectRef, r.artifactId);
      if (r !== run.current) return false;
      // The read and the stream start together, so a newer copy from the
      // stream can land before this answer.
      if (!r.base || res.doc.rev >= r.base.rev) r.base = res.doc;
      setCapabilities(res.capabilities || null);
      setCard(res.card || null);
      setError(null);
      setStatus('ready');
      rebase();
      return true;
    } catch (e) {
      if (r !== run.current) return false;
      setError(e);
      setStatus('error');
      return false;
    }
  }, [rebase, fetchDoc]);

  // After an edit was dropped: reread the doc, and keep of what is still
  // queued only what applies to it (replayed in order, so an edit to a block
  // an earlier one inserts goes with it). An edit to a block the dropped one
  // made, or one someone has since deleted, would only be refused in turn.
  // Says whether the reread worked.
  const resync = useCallback(async (r) => {
    const read = await load();
    if (r !== run.current) return false;
    let d = r.base;
    r.queue = r.queue.filter((item) => {
      const next = applyLocal(d, item.ops, { tab: item.tab });
      if (next) d = next;
      else item.resolve?.(null);
      return !!next;
    });
    rebase();
    return read;
  }, [load, rebase]);

  const flashBlocks = useCallback((touched) => {
    const ids = Object.values(touched || {}).flat();
    if (!ids.length) return;
    const now = Date.now();
    const r = run.current;
    setFlash((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = now;
      return next;
    });
    setTimeout(() => {
      if (r !== run.current) return;
      setFlash((prev) => {
        const next = {};
        const cut = Date.now() - FLASH_MS + 50;
        for (const [id, at] of Object.entries(prev)) if (at > cut) next[id] = at;
        return next;
      });
    }, FLASH_MS);
  }, []);

  const pump = useCallback(async (r) => {
    // A retry waiting means the server could not be reached: an edit typed
    // meanwhile waits with the rest rather than skipping the wait (and
    // leaving a second timer that retryNow could not cancel).
    if (!r || r.sending || !r.queue.length || r.retry.timer) return;
    const shown = () => r === run.current;
    r.sending = true;
    if (shown()) setSaving(true);
    const item = r.queue[0];
    try {
      const res = await postDocOps(r.projectRef, r.artifactId, {
        ops: item.ops, tab: item.tab, clientId,
      });
      r.queue.shift();
      r.retry.n = 0;
      if (res.undo?.length) {
        const step = { ops: res.undo, after: res.doc };
        if (item.kind === 'undo') r.redo.push(step);
        else {
          r.undo = [...r.undo, step].slice(-UNDO_STEPS);
          if (item.kind !== 'redo') r.redo = [];
        }
      }
      if (!r.base || res.doc.rev >= r.base.rev) r.base = res.doc;
      if (shown()) {
        setWriteError(null);
        rebase();
      }
      item.resolve?.(shown() ? res : null);
    } catch (e) {
      if (notSent(e)) {
        // Nothing reached the doc: keep every queued edit (still shown) and
        // send them when the server answers again, after a wait or as soon
        // as the doc's stream reconnects. Dropping them here lost whatever
        // was typed while the app's server restarted.
        if (shown()) setWriteError(Object.assign(new Error('not saved yet'), { code: 'offline' }));
        const wait = RETRY_MS[Math.min(r.retry.n, RETRY_MS.length - 1)];
        r.retry.n += 1;
        r.retry.timer = setTimeout(() => { r.retry.timer = null; pump(r); }, wait);
        return;
      }
      // Refused, or failed with its outcome unknown: either way it is not
      // sent again, since the server gives an id it already holds a new one
      // and an insert that did land would land twice (every few seconds, for
      // as long as the failure lasted). Carry on with what was queued behind
      // it on the doc as the server holds it. A run no longer shown just
      // sends the rest; the server refuses any that no longer apply.
      r.queue.shift();
      item.resolve?.(null);
      if (shown()) {
        const unknown = outcomeUnknown(e);
        if (!unknown) setWriteError(e);
        const read = await resync(r);
        // The copy read now holds the edit if it landed; else it was not saved.
        if (unknown && shown()) setWriteError(read && holdsEdit(r.base, item.ops, { tab: item.tab }) ? null : e);
      }
    } finally {
      r.sending = false;
      if (shown()) setSaving(r.queue.length > 0);
      if (r.queue.length && !r.retry.timer) pump(r);
      else if (!r.queue.length) r.idle.splice(0).forEach((done) => done());
    }
  }, [clientId, rebase, resync, postDocOps]);

  // The doc's stream came back: a retry waiting goes now rather than after its wait.
  const retryNow = useCallback((r) => {
    if (!r.retry.timer) return;
    clearTimeout(r.retry.timer);
    r.retry.timer = null;
    pump(r);
  }, [pump]);

  useEffect(() => {
    const r = artifactId
      ? {
        projectRef, artifactId, base: null, queue: [], sending: false, retry: { n: 0, timer: null },
        undo: [], redo: [], idle: [],
      }
      : null;
    run.current = r;
    setDoc(null);
    setStatus('loading');
    setAgentActive(false);
    // Whatever the doc open before still has waiting, failed or lit is its own.
    setSaving(false);
    setWriteError(null);
    setFlash({});
    if (!r) return undefined;
    load();
    const stop = followDoc(projectRef, artifactId, {
      onEvent: (ev) => {
        if (ev.type === 'doc.ready') {
          if (r.base && ev.rev > r.base.rev) load();
          return;
        }
        if (ev.type !== 'doc.updated' || !ev.doc) return;
        if (ev.clientId && ev.clientId === clientId) return; // our own write; its answer already landed
        if (r.base && ev.doc.rev <= r.base.rev) return;
        r.base = ev.doc;
        rebase();
        if (ev.by === 'agent') {
          // Shown until the agent has been quiet for a while: real state, so
          // the pane re-renders when it ends.
          setAgentActive(true);
          clearTimeout(agentTimer.current);
          agentTimer.current = setTimeout(() => setAgentActive(false), AGENT_ACTIVE_MS);
          flashBlocks(ev.touched);
        }
        if (ev.gap) load();
      },
      onReconnect: () => {
        load();
        retryNow(r);
      },
    });
    return () => {
      if (run.current === r) run.current = null;
      clearTimeout(agentTimer.current);
      stop();
    };
  }, [projectRef, artifactId, clientId, load, rebase, flashBlocks, followDoc, retryNow]);

  /** Apply ops: locally now when the op allows it, on the server always. */
  const apply = useCallback((ops, { tab, kind } = {}) => new Promise((resolve) => {
    const r = run.current;
    if (!ops?.length || !r?.base) { resolve(null); return; }
    r.queue.push({ ops, tab, kind, resolve });
    rebase();
    pump(r);
  }), [pump, rebase]);

  /**
   * Undo (or redo) the person's last step: once every edit already typed has
   * its answer, so the step undone is the newest. Resolves 'done', 'none'
   * (nothing to undo) or 'changed' (it has changed since; the step is dropped).
   */
  const step = useCallback(async (kind) => {
    const r = run.current;
    if (!r) return 'none';
    if (r.queue.length || r.sending) await new Promise((done) => r.idle.push(done));
    if (r !== run.current) return 'none';
    const entry = (kind === 'undo' ? r.undo : r.redo).pop();
    if (!entry) return 'none';
    if (!undoStillApplies(r.base, entry)) return 'changed';
    await apply(entry.ops, { kind });
    return 'done';
  }, [apply]);
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  const clearWriteError = useCallback(() => setWriteError(null), []);

  return {
    doc,
    status,
    error,
    capabilities,
    card,
    saving,
    writeError,
    clearWriteError,
    agentActive,
    flash,
    apply,
    undo,
    redo,
  };
}
