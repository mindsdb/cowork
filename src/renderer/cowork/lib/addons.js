// Messages sent while Anton is working (ENG-4194).
//
// A message typed while a turn runs used to go straight into the client-side
// queue and run as the next task. Now the server (Jev) may instead add it to the
// running task, where Anton's next step reads it. These are the pure decisions
// behind that flow, so they can be tested without a stream:
//
//   - whether a send is worth offering to the running task at all
//     (`addonEligibility`), and what the server's answer means (`addonOutcome`);
//   - how an add-on shows in the turn's steps: an `Addon` step, rendered as a
//     user row inside the turn at the point it joined (`applyAddonEvent`);
//   - which add-ons the server handed back unread at turn end, so the app can
//     queue them as the next task and nothing is lost (`newlyReturnedAddons`);
//   - how saved add-ons fold back into their turn on reload
//     (`foldAddonMessages`).
//
// States an Addon step can be in:
//   sending     — local: the request is out, the server has not answered
//   added       — the server added it; Anton has not read it yet
//   withdrawing — local: "Move to queue" was pressed, the withdraw is out
//   read        — Anton's loop has shown it to the model
//   returned    — never read before the turn ended; the app queued it
//   saved       — rebuilt on reload from the saved message alone
// and two local transitions that remove the row: `discarded` (a `sending` row
// whose answer was "queued") and `withdrawn` (a successful "Move to queue").

/** How long the app waits for the server's verdict before queueing instead. */
export const ADDON_REQUEST_TIMEOUT_MS = 4000;

export const ADDON_BADGE = 'Addon';

const isAddonStep = (step) => step?.badge === ADDON_BADGE;

/**
 * Whether a send made while a turn runs may be offered to that turn.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`; the reason is what the
 * `addon_queued` event reports. Attachments always queue in v1: the add-on
 * endpoint carries text only. A conversation still on a `tmp-` id has no server
 * turn to join yet, and a turn being stopped or deleted cannot take more input.
 */
export function addonEligibility({ conversationId, text, attachments, liveStream, ending = false } = {}) {
  if (!String(text || '').trim()) return { ok: false, reason: 'empty' };
  if (Array.isArray(attachments) && attachments.length > 0) return { ok: false, reason: 'attachments' };
  if (!conversationId || String(conversationId).startsWith('tmp-')) return { ok: false, reason: 'no_conversation' };
  if (!liveStream) return { ok: false, reason: 'no_live_stream' };
  if (ending) return { ok: false, reason: 'turn_ending' };
  return { ok: true };
}

/**
 * What the server's answer to `POST /responses/addon` means for the app.
 *
 * Only an explicit `added` with an id adds the message. Everything else —
 * `queued`, `not_found`, an old server without the route, a timeout, a body we
 * do not recognise — keeps today's behaviour and queues it.
 */
export function addonOutcome(result) {
  if (result?.status === 'added' && result.addon_id) {
    return {
      action: 'added',
      addonId: String(result.addon_id),
      decidedBy: result.decided_by === 'user' ? 'user' : 'jev',
    };
  }
  const status = result?.status;
  let reason = 'unknown';
  if (status === 'queued') reason = result.reason ? String(result.reason) : 'jev';
  else if (status === 'not_found' || status === 'unsupported' || status === 'timeout' || status === 'error') reason = status;
  return { action: 'queue', reason };
}

/* Why a message sent while the task ran went to the queue, as the key of
   the line its queue chip shows on hover (`chat:chatView.addon.queued.*`).
   Never names the decision model: `unchecked` is the one that says the
   check could not run, which is how a missing decision shows up. */
const QUEUED_REASON_KEYS = {
  next_task: 'separate',
  low_confidence: 'unsure',
  jev: 'unsure',
  jev_off: 'unchecked',
  jev_error: 'unchecked',
  jev_timeout: 'unchecked',
  attachments: 'files',
  returned: 'notRead',
};

/** The hover line for a queued message, as a key under
 *  `chatView.addon.queued`, or null for one the person queued themselves. */
export function queuedReasonKey(reason) {
  if (!reason || reason === 'empty' || reason === 'moved') return null;
  return QUEUED_REASON_KEYS[reason] || 'unavailable';
}

/** The label under an add-on row, as a `chat` catalog key under
 *  `chatView.addon` (the row calls t() with `{ agent }`), and whether
 *  "Move to queue" is offered. */
export function addonRowLabel(state) {
  switch (state) {
    case 'sending': return { key: 'sending', canMove: false };
    case 'added': return { key: 'added', canMove: true };
    case 'withdrawing': return { key: 'withdrawing', canMove: false };
    case 'read': return { key: 'read', canMove: false };
    case 'returned': return { key: 'returned', canMove: false };
    default: return { key: 'added', canMove: false };
  }
}

function addonStep({ key, addonId, localKey, text, state, decidedBy, ts }) {
  return {
    id: `addon-${key}`,
    label: '',
    badge: ADDON_BADGE,
    status: 'completed',
    startedAt: ts,
    completedAt: ts,
    data: {
      addon_id: addonId || null,
      local_key: localKey || null,
      text: text || '',
      state,
      decided_by: decidedBy || null,
    },
  };
}

const withData = (step, patch) => ({ ...step, data: { ...step.data, ...patch } });

/**
 * Apply one `response.addon` event — from the server's stream, or one the app
 * injects for its own request — to a turn's steps. Pure; returns the same array
 * when nothing changes, so a replayed event is a no-op.
 *
 * Event: `{ addon_id?, local_key?, state, text?, decided_by?, revert? }`.
 * A step is found by `addon_id` first, then by the app's `local_key`.
 */
export function applyAddonEvent(steps, event, ts = Date.now()) {
  const list = Array.isArray(steps) ? steps : [];
  const state = event?.state;
  const addonId = event?.addon_id ? String(event.addon_id) : null;
  const localKey = event?.local_key ? String(event.local_key) : null;
  const text = typeof event?.text === 'string' ? event.text : '';
  const decidedBy = event?.decided_by || null;

  const byId = addonId ? list.findIndex((s) => isAddonStep(s) && s.data?.addon_id === addonId) : -1;
  const byLocal = localKey ? list.findIndex((s) => isAddonStep(s) && s.data?.local_key === localKey) : -1;
  const target = byId >= 0 ? byId : byLocal;
  const replaceAt = (idx, step) => list.map((s, i) => (i === idx ? step : s));
  const removeAt = (idx) => list.filter((_, i) => i !== idx);
  const append = (st) => (text
    ? [...list, addonStep({ key: addonId || localKey, addonId, localKey, text, state: st, decidedBy, ts })]
    : list);

  switch (state) {
    case 'sending':
      if (!localKey || byLocal >= 0) return list;
      return append('sending');

    case 'discarded':
      if (byLocal < 0 || list[byLocal].data?.state !== 'sending') return list;
      return removeAt(byLocal);

    case 'added': {
      if (byId >= 0) {
        // The server's own event may land before the request returns: the
        // pending row then lingers beside the real one until now.
        let next = byLocal >= 0 && byLocal !== byId ? removeAt(byLocal) : list;
        const idx = next.findIndex((s) => isAddonStep(s) && s.data?.addon_id === addonId);
        const cur = next[idx];
        const upgrade = cur.data.state === 'sending' || (event.revert && cur.data.state === 'withdrawing');
        if (upgrade) next = next.map((s, i) => (i === idx ? withData(s, { state: 'added', decided_by: decidedBy || s.data.decided_by }) : s));
        return next;
      }
      if (byLocal >= 0) {
        return replaceAt(byLocal, withData(list[byLocal], {
          addon_id: addonId, state: 'added', decided_by: decidedBy,
        }));
      }
      if (!addonId) return list;
      // The stream's event, before the request answered: adopt the pending row
      // carrying the same words rather than showing the message twice.
      const pending = list.findIndex((s) => isAddonStep(s) && s.data?.state === 'sending'
        && !s.data?.addon_id && s.data?.text === text);
      if (pending >= 0) {
        return replaceAt(pending, withData(list[pending], { addon_id: addonId, state: 'added', decided_by: decidedBy }));
      }
      return append('added');
    }

    case 'read':
      if (target < 0) return append('read');
      if (list[target].data?.state === 'read' || list[target].data?.state === 'returned') return list;
      return replaceAt(target, withData(list[target], { state: 'read', ...(addonId ? { addon_id: addonId } : {}) }));

    case 'returned':
      if (target < 0) return append('returned');
      if (list[target].data?.state === 'returned') return list;
      return replaceAt(target, withData(list[target], { state: 'returned' }));

    case 'withdrawing':
      if (target < 0 || list[target].data?.state !== 'added') return list;
      return replaceAt(target, withData(list[target], { state: 'withdrawing' }));

    case 'withdrawn':
      if (target < 0) return list;
      return removeAt(target);

    default:
      return list;
  }
}

/**
 * Add-ons the server handed back unread at turn end that the app has not
 * queued yet. The caller records each id in `handled` before queueing, so a
 * replayed event cannot queue the same text twice.
 */
export function newlyReturnedAddons(steps, handled) {
  const out = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!isAddonStep(s) || s.data?.state !== 'returned') continue;
    const id = s.data.addon_id || s.data.local_key;
    if (!id || handled?.has(id) || !s.data.text) continue;
    out.push({ addonId: id, text: s.data.text });
  }
  return out;
}

/** A saved user message that joined a running turn instead of starting one. */
export function isAddonMessage(m) {
  return m?.role === 'user' && Boolean(m?.metadata?.addon_of_turn || m?.addon_of_turn);
}

const addonTurnOf = (m) => m?.metadata?.addon_of_turn || m?.addon_of_turn || null;

function insertByTime(steps, step) {
  const t = step.startedAt;
  if (typeof t !== 'number') return [...steps, step];
  const at = steps.findIndex((s) => typeof s?.startedAt === 'number' && s.startedAt > t);
  return at < 0 ? [...steps, step] : [...steps.slice(0, at), step, ...steps.slice(at)];
}

/**
 * Fold saved add-on messages into the turn they joined, so a reloaded chat
 * shows them where they joined rather than as new turns of their own.
 *
 * The turn is the assistant message whose response id (`_responseId`, from its
 * replayed `response.created`) matches `addon_of_turn`; failing that, the next
 * assistant message before another ordinary user message. If that turn already
 * carries the add-on (its saved `response.addon` events), the message is
 * dropped; otherwise it becomes a `saved` Addon step placed by time. One with
 * no turn on this page stays a user row, marked `_addon` for its label.
 */
export function foldAddonMessages(messages) {
  if (!Array.isArray(messages) || !messages.some(isAddonMessage)) return messages;
  const folds = new Map(); // assistant index → add-on messages
  const standalone = new Set();
  messages.forEach((m, i) => {
    if (!isAddonMessage(m)) return;
    const turn = addonTurnOf(m);
    let target = messages.findIndex((x) => x?.role === 'assistant' && turn && x._responseId === turn);
    if (target < 0) {
      for (let k = i + 1; k < messages.length; k += 1) {
        const x = messages[k];
        if (x?.role === 'user' && !isAddonMessage(x)) break;
        if (x?.role === 'assistant') { target = k; break; }
      }
    }
    if (target < 0) standalone.add(i);
    else folds.set(target, [...(folds.get(target) || []), m]);
  });
  const out = [];
  messages.forEach((m, i) => {
    if (isAddonMessage(m)) {
      // Still a user row (every turn rule keys on `user`), only labelled.
      if (standalone.has(i)) out.push({ ...m, _addon: { decidedBy: m.metadata?.decided_by || m.decided_by || null } });
      return;
    }
    const joined = folds.get(i);
    if (!joined) { out.push(m); return; }
    let steps = Array.isArray(m.steps) ? m.steps : [];
    const shown = new Set(steps.filter(isAddonStep).map((s) => s.data?.text));
    joined.forEach((a, n) => {
      const text = typeof a.content === 'string' ? a.content : '';
      if (!text || shown.has(text)) return;
      shown.add(text);
      const ts = Date.parse(a.created_at || a.createdAt || '');
      steps = insertByTime(steps, addonStep({
        key: a.id || `saved-${i}-${n}`,
        addonId: a.metadata?.addon_id || null,
        text,
        state: 'saved',
        decidedBy: a.metadata?.decided_by || a.decided_by || null,
        ts: Number.isFinite(ts) ? ts : null,
      }));
    });
    out.push({ ...m, steps });
  });
  return out;
}
