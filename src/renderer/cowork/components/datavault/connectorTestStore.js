// A custom connector's connection test waiting on the user, per conversation:
// a private address to allow, or a result to confirm before anything is saved.
//
// The server sends the waiting test's id in one stream event that is never
// saved with the conversation, so the agent cannot read it and answer for the
// user. It lives here in memory only: never in the form spec (which the
// model writes and patches), never in message content, never in
// localStorage. A new form for the conversation clears it (formStore.setForm).

const _byConversation = new Map();
const _listeners = new Map(); // cid → Set<fn>

const _EVENT_KINDS = {
  'connector.test_preview': 'confirm',
  'connector.private_host_request': 'approval',
};

// The pending test a server event describes, or null for any other event.
// Shape: { kind: 'confirm', formId, id, preview }
//      | { kind: 'approval', formId, id, host }
export function pendingTestFromEvent(ev) {
  const kind = _EVENT_KINDS[ev?.type];
  if (!kind) return null;
  if (kind === 'confirm') {
    if (typeof ev.confirm_id !== 'string' || !ev.preview) return null;
    return { kind, formId: ev.form_id || null, id: ev.confirm_id, preview: ev.preview };
  }
  if (typeof ev.approval_id !== 'string') return null;
  const { type, form_id: formId, approval_id: id, ...host } = ev;
  return { kind, formId: formId || null, id, host };
}

// The pending test an allow-private answer leads to, or null when the answer
// carries none (a failure patch).
export function pendingTestFromAnswer(formId, answer) {
  if (answer?.private_host_request) {
    const { approval_id: id, ...host } = answer.private_host_request;
    return typeof id === 'string' ? { kind: 'approval', formId, id, host } : null;
  }
  if (typeof answer?.confirm_id === 'string' && answer.preview) {
    return { kind: 'confirm', formId, id: answer.confirm_id, preview: answer.preview };
  }
  return null;
}

function _notify(conversationId, value) {
  const subs = _listeners.get(conversationId);
  if (subs) for (const fn of subs) {
    try { fn(value); } catch {}
  }
}

export function setPendingTest(conversationId, pending) {
  if (!conversationId || !pending) return;
  _byConversation.set(conversationId, pending);
  _notify(conversationId, pending);
}

export function getPendingTest(conversationId) {
  return _byConversation.get(conversationId) || null;
}

export function clearPendingTest(conversationId) {
  if (!conversationId || !_byConversation.has(conversationId)) return;
  _byConversation.delete(conversationId);
  _notify(conversationId, null);
}

// Carry a waiting test over when the conversation's temporary id is replaced
// by the one the server minted.
export function movePendingTest(fromId, toId) {
  const pending = getPendingTest(fromId);
  if (!pending || !toId || fromId === toId) return;
  clearPendingTest(fromId);
  setPendingTest(toId, pending);
}

// Record the pending test a stream event describes; true when it was one.
export function applyConnectorTestEvent(conversationId, ev) {
  const pending = pendingTestFromEvent(ev);
  if (!pending) return false;
  setPendingTest(conversationId, pending);
  return true;
}

export function subscribePendingTest(conversationId, fn) {
  if (!conversationId || typeof fn !== 'function') return () => {};
  let subs = _listeners.get(conversationId);
  if (!subs) {
    subs = new Set();
    _listeners.set(conversationId, subs);
  }
  subs.add(fn);
  return () => {
    const cur = _listeners.get(conversationId);
    if (cur) {
      cur.delete(fn);
      if (cur.size === 0) _listeners.delete(conversationId);
    }
  };
}
