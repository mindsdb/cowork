import { useRef } from 'react';
import { diagnostic } from '../../../shared/diagnostics';
import { sendAddon, withdrawAddon } from '../api';
import { trackAddonAdded, trackAddonQueued, trackAddonOverridden } from '../lib/analytics';
import {
  addonOutcome, newlyReturnedAddons, newAddonLocalKey, rememberOwnAddon, isOwnAddon, forgetOwnAddons,
} from '../lib/addons';

const LOGGER = 'renderer.cowork.hooks.useAddons';

// What a held slot becomes once its add-on is back in the queue for sure.
const settledSlot = (reason) => ({
  addonPending: false, addonOffer: false, paused: false, unconfirmed: false, queuedReason: reason,
});

// What a slot becomes when nobody can say whether the server added it: kept,
// but paused until the person sends it again, so it is neither lost nor run
// twice.
const UNCONFIRMED = {
  addonPending: false, addonOffer: false, paused: true, unconfirmed: true, queuedReason: null,
};

// Per-conversation sets of add-on keys. Keys are unique on their own, so a
// lookup checks every conversation (a stream can be filed under a tmp- id and
// its canonical one at once); the split is what lets a conversation's keys be
// dropped when it is deleted.
function keyBook() {
  const byConversation = new Map();
  return {
    has: (key) => {
      for (const keys of byConversation.values()) if (keys.has(key)) return true;
      return false;
    },
    add: (cid, key) => {
      const id = String(cid ?? '');
      if (!byConversation.has(id)) byConversation.set(id, new Set());
      byConversation.get(id).add(key);
    },
    forget: (cid) => { byConversation.delete(String(cid ?? '')); },
  };
}

/**
 * Messages sent while a turn runs (ENG-4194): offered to the running turn,
 * withdrawn ("Move to queue"), added from the queue ("Add to current task"),
 * handed back unread at turn end, and reconciled against their queued copies.
 * The pure rules live in lib/addons.js; this is the part that talks to the
 * server and the app's queue.
 *
 * The app's queue stays in App.jsx (every send path shares it); this hook only
 * reads and settles the slots its add-ons hold, through the helpers passed in.
 *
 * Trust: only this client's own add-ons are ever queued or acted on. Rows of
 * other add-ons the server relays are shown (see lib/addons.js), never queued.
 */
export function useAddons({
  liveStreamsRef,
  messageQueueRef,
  tasksRef,
  toastManagerRef,
  drainNextQueuedMessageRef,
  enqueueMessage,
  updateQueueItem,
  removeFromQueue,
  hasLiveTurnHere,
  agentLabel,
  tApp,
}) {
  // Add-ons whose text has already gone back to the queue — handed back
  // unread at turn end, or moved there by the person — so a replayed
  // `returned` event cannot queue the same words twice. Per conversation.
  const handledRef = useRef(null);
  if (!handledRef.current) handledRef.current = keyBook();
  // Add-ons this client asked to take back out ("Move to queue"), so the
  // server's `withdrawn` for one of them queues it even if the request's own
  // answer was lost — and another client's withdraw never does.
  const withdrawRequestedRef = useRef(null);
  if (!withdrawRequestedRef.current) withdrawRequestedRef.current = keyBook();

  const addonHandled = (...keys) => keys.some((k) => k && handledRef.current.has(k));
  const markAddonHandled = (cid, ...keys) => keys.forEach((k) => { if (k) handledRef.current.add(cid, k); });

  // The running turn's stream, when it can still take a message. Its
  // `injectEvent` puts the app's own `response.addon` rows through the same
  // reducer as the server's, so they render inside the turn where they joined.
  const liveAddonCtrl = (taskId) => {
    const ctrl = liveStreamsRef.current.get(taskId)?.ctrl;
    return typeof ctrl?.injectEvent === 'function' ? ctrl : null;
  };
  const injectAddonEvent = (taskId, ev) => {
    const ctrl = liveAddonCtrl(taskId);
    if (!ctrl) return false;
    ctrl.injectEvent({ type: 'response.addon', ...ev });
    return true;
  };
  // Once an add-on's queue slot is settled, run the queue if its turn has
  // ended meanwhile: that turn's terminal drain found the slot still waiting.
  const drainIfIdle = (taskId) => {
    if (!hasLiveTurnHere(taskId)) drainNextQueuedMessageRef.current?.(taskId);
  };
  const ownerOf = (taskId) => tasksRef.current.find((t) => t.id === taskId);

  // The queued item an add-on of this client's holds, found by its local key
  // across every id the stream is known by.
  const findAddonSlot = (taskIds, keys) => {
    for (const tid of taskIds.filter(Boolean)) {
      const item = (messageQueueRef.current[tid] || []).find((q) => q.addonLocalKey && keys.includes(q.addonLocalKey));
      if (item) return { taskId: tid, item };
    }
    return null;
  };

  // A queued copy of one of this client's add-ons that the running task took
  // after all must not run again. `read` is proof: the server may answer
  // "queued" for a message it had already handed the task, then drop the late
  // `added` but relay `read` — so a read removes the copy, normal or paused.
  // `added` alone only settles a paused (unconfirmed) copy; `withdrawn` leaves
  // the copy where it is.
  const reconcileQueuedAddons = (taskIds, steps) => {
    for (const tid of taskIds.filter(Boolean)) {
      for (const q of messageQueueRef.current[tid] || []) {
        // A slot still waiting on its request counts too: a `read` before the
        // answer means a later "queued" must not put it back.
        if (!q.addonLocalKey) continue;
        const shown = steps.find((s) => s?.badge === 'Addon' && s.data?.local_key === q.addonLocalKey);
        const state = shown?.data?.state;
        if (state === 'read' || (state === 'added' && q.unconfirmed && !q.addonPending)) removeFromQueue(tid, q.id);
      }
    }
  };

  // Called with every stream's steps, before the stream's own queue drain.
  // A message added to this turn that Anton never read before the turn ended
  // comes back as `returned`: it runs as the next task, so nothing is lost.
  // Only this client's own add-ons; one it took back out ("Move to queue")
  // comes the same way when the server says `withdrawn`. Then a queued add-on
  // the stream shows the task took after all is dropped from the queue.
  const onStreamSteps = (taskIds, steps) => {
    const returned = newlyReturnedAddons(steps, handledRef.current, {
      withdrawRequested: withdrawRequestedRef.current,
    });
    if (returned.length > 0) {
      const queueId = taskIds.find(Boolean);
      const owner = tasksRef.current.find((t) => taskIds.includes(t.id));
      returned.forEach(({ keys, text, reason }) => {
        taskIds.filter(Boolean).forEach((tid) => markAddonHandled(tid, ...keys));
        // Its slot may already be in the queue (still waiting on its request,
        // or paused unconfirmed): settle that one in place, never add another.
        const slot = findAddonSlot(taskIds, keys);
        if (slot) updateQueueItem(slot.taskId, slot.item.id, settledSlot(reason));
        else enqueueMessage(queueId, text, [], owner?.disabledConnections || [], reason);
        if (reason === 'returned') trackAddonQueued('returned');
      });
    }
    reconcileQueuedAddons(taskIds, steps);
  };

  // After `added`, the turn's stream had already ended, so its `returned` event
  // had nowhere to land. Take the message back and say what became of the
  // slot: `undefined` (already settled elsewhere), `null` (Anton read it), the
  // settled patch, or UNCONFIRMED when the withdraw's answer says nothing.
  const reclaimAfterTurnEnded = async (taskId, addonId, localKey) => {
    if (addonHandled(addonId, localKey)) return undefined;
    const back = await withdrawAddon(taskId, addonId);
    // Its `returned` may have been handled while the withdraw was out.
    if (addonHandled(addonId, localKey)) return undefined;
    markAddonHandled(taskId, addonId, localKey);
    if (back?.status === 'withdrawn') return settledSlot('returned');
    if (back?.status === 'already_read') return null;
    return UNCONFIRMED;
  };

  // The server added one of this client's messages: show it in the turn, or,
  // when the turn's stream has already ended, take it back. `shown` says which;
  // `patch` is what its queue slot becomes — `null` (it lives in the turn, or
  // Anton read it), a patch, or `undefined` when the stream already settled it.
  const settleAdded = async (taskId, localKey, outcome, text) => {
    rememberOwnAddon(outcome.addonId, taskId);
    const shown = injectAddonEvent(taskId, {
      state: 'added', local_key: localKey, addon_id: outcome.addonId, text, decided_by: outcome.decidedBy,
    });
    if (shown) {
      // Its stream may already have handed it back (`returned` settles the
      // slot in place); otherwise it lives in the turn now.
      return { shown, patch: addonHandled(outcome.addonId, localKey) ? undefined : null };
    }
    return { shown, patch: await reclaimAfterTurnEnded(taskId, outcome.addonId, localKey) };
  };

  // A composer send while this task's turn runs: show it in the turn at once
  // as "Sending…", ask the server, then either keep it there or move it to the
  // queue exactly as before. Not awaited by the send, so Enter never waits on
  // Jev; the request gives up after a few seconds and queues.
  //
  // Its place in the queue is held from the moment Enter is pressed (a hidden
  // slot while the turn shows the row), so a message typed after it can never
  // run before it; the outcome then settles that slot in place.
  const offerAddon = (taskId, text, disabledConnections) => {
    const localKey = newAddonLocalKey();
    rememberOwnAddon(localKey, taskId);
    const responseId = liveAddonCtrl(taskId)?.responseId || null;
    const slotId = enqueueMessage(taskId, text, [], disabledConnections || [], null, {
      addonPending: true, addonOffer: true, addonLocalKey: localKey,
    });
    injectAddonEvent(taskId, { state: 'sending', local_key: localKey, text });
    const settle = (patch) => {
      if (patch !== undefined) updateQueueItem(taskId, slotId, patch);
      drainIfIdle(taskId);
    };
    let added = false;
    void (async () => {
      try {
        const outcome = addonOutcome(await sendAddon(taskId, text, { responseId, localKey }));
        if (outcome.action === 'added') {
          added = true;
          trackAddonAdded(outcome.decidedBy, 'send');
          const { shown, patch } = await settleAdded(taskId, localKey, outcome, text);
          if (shown && patch === undefined) return;
          settle(patch);
          return;
        }
        injectAddonEvent(taskId, { state: 'discarded', local_key: localKey });
        trackAddonQueued(outcome.reason);
        // Already settled by its stream (handed back while the request was out).
        if (addonHandled(localKey)) { settle(undefined); return; }
        // No answer (a timeout, a network error, a body we do not know): the
        // server may have added it, so it waits paused in its slot rather than
        // run a second time. Its stream showing it added or read removes it.
        settle(outcome.unclear ? UNCONFIRMED : settledSlot(outcome.reason));
      } catch (e) {
        // A bug past this point must not strand the message in a slot that
        // waits forever (and holds up the queue behind it): it stays queued —
        // paused if the server had already added it, so it never runs twice.
        diagnostic(LOGGER, 'ERROR', 'addon_offer_failed', '[useAddons] offering a message to the running task failed; keeping it queued', e);
        try {
          if ((messageQueueRef.current[taskId] || []).some((q) => q.id === slotId)) {
            settle(added ? UNCONFIRMED : settledSlot('unknown'));
          }
        } catch (e2) {
          diagnostic(LOGGER, 'ERROR', 'addon_offer_fallback_failed', '[useAddons] could not keep the message queued', e2);
        }
      }
    })();
  };

  // "Move to queue" on a message the running task has not read yet. Only this
  // client's own: another client's message is never taken into this queue.
  const handleMoveAddonToQueue = async (taskId, addonId, text, decidedBy) => {
    if (!taskId || !addonId || !isOwnAddon(addonId)) return;
    withdrawRequestedRef.current.add(taskId, addonId);
    injectAddonEvent(taskId, { state: 'withdrawing', addon_id: addonId });
    const result = await withdrawAddon(taskId, addonId);
    const status = result?.status || 'error';
    trackAddonOverridden('to_queue', status, decidedBy);
    if (status === 'withdrawn') {
      // The row stays, as "Moved to queue"; its own event may already have
      // queued it (see newlyReturnedAddons).
      injectAddonEvent(taskId, { state: 'withdrawn', addon_id: addonId });
      if (addonHandled(addonId)) return;
      markAddonHandled(taskId, addonId);
      enqueueMessage(taskId, text, [], ownerOf(taskId)?.disabledConnections || [], 'moved');
      drainIfIdle(taskId);
      return;
    }
    if (status === 'already_read') {
      // Too late: Anton has it. Say so instead of offering the move again.
      injectAddonEvent(taskId, { state: 'read', addon_id: addonId });
      return;
    }
    injectAddonEvent(taskId, { state: 'added', addon_id: addonId, revert: true });
    toastManagerRef.current?.add({ type: 'warning', title: tApp('addon.moveFailed') });
  };

  // "Add to current task" on a queued chip: the person overrides the queue, so
  // the server adds it without asking Jev. Anything but `added` leaves it
  // queued — paused, when the answer does not say whether it was added.
  const handleAddQueuedToTask = async (taskId, itemId) => {
    const ctrl = taskId ? liveAddonCtrl(taskId) : null;
    if (!ctrl) return;
    const item = (messageQueueRef.current[taskId] || []).find((q) => q.id === itemId);
    if (!item || item.addonPending || item.paused || (item.attachments || []).length > 0) return;
    const localKey = newAddonLocalKey();
    rememberOwnAddon(localKey, taskId);
    updateQueueItem(taskId, itemId, { addonPending: true, addonLocalKey: localKey });
    let added = false;
    try {
      const outcome = addonOutcome(await sendAddon(taskId, item.text, {
        force: true, responseId: ctrl.responseId || null, localKey,
      }));
      trackAddonOverridden('to_task', outcome.action === 'added' ? 'added' : outcome.reason);
      if (outcome.action === 'added') {
        added = true;
        const { shown, patch } = await settleAdded(taskId, localKey, outcome, item.text);
        if (shown) trackAddonAdded(outcome.decidedBy, 'queue');
        // Added, but the turn ended before we could show it: taken back so it
        // runs from the queue rather than not at all — unless Anton already
        // read it, when running it again would do the work twice.
        if (patch !== undefined) {
          updateQueueItem(taskId, itemId, patch === null ? null : { ...patch, queuedReason: item.queuedReason || null });
        }
      } else if (outcome.unclear) {
        updateQueueItem(taskId, itemId, UNCONFIRMED);
      } else {
        updateQueueItem(taskId, itemId, { addonPending: false });
        toastManagerRef.current?.add({ type: 'info', title: tApp('addon.stayQueued', { agent: agentLabel || 'Anton' }) });
      }
    } catch (e) {
      // Never leave the chip waiting on a request that is over: it stays
      // queued, paused if the server had added it.
      diagnostic(LOGGER, 'ERROR', 'addon_add_queued_failed', '[useAddons] adding a queued message to the running task failed; keeping it queued', e);
      updateQueueItem(taskId, itemId, added ? UNCONFIRMED : { addonPending: false });
    }
    drainIfIdle(taskId);
  };

  // "Send again" on a paused chip whose add-on could not be confirmed: the
  // person says run it, so it rejoins the queue in its place.
  const handleResendQueued = (taskId, itemId) => {
    if (!taskId || !itemId) return;
    updateQueueItem(taskId, itemId, { paused: false, unconfirmed: false });
    drainIfIdle(taskId);
  };

  // A send that queues rather than being offered to the running task.
  const noteQueued = (reason) => trackAddonQueued(reason);

  // The conversation is gone: nothing of its add-ons can come back.
  const forgetConversation = (cid) => {
    if (!cid) return;
    handledRef.current.forget(cid);
    withdrawRequestedRef.current.forget(cid);
    forgetOwnAddons(cid);
  };

  return {
    liveAddonCtrl,
    offerAddon,
    handleMoveAddonToQueue,
    handleAddQueuedToTask,
    handleResendQueued,
    onStreamSteps,
    noteQueued,
    forgetConversation,
  };
}
