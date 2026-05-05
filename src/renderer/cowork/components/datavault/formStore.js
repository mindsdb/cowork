// Tiny pub/sub for the latest active `data-vault-form` per
// conversation. The markdown extension calls `setForm(cid, spec)`
// each time it parses a `data-vault-form` block; the side panel
// subscribes via `useActiveForm(cid)` and re-renders.
//
// Why a side store instead of just rendering inline in the message:
//
// 1. The form needs a tall, sticky surface (right rail) so the user
//    can carry on a long conversation about a single connection
//    without losing the form. Inline would scroll out of view.
// 2. Multiple forms can appear over the course of a conversation
//    (initial → retry with errors → new fields); we always want to
//    show the LATEST. A store gives us that "single source of
//    truth" without coordinating between sibling React trees.
// 3. The same form needs to remain usable while a stream is in
//    flight emitting more text — keeping it out of the streaming
//    body insulates it from re-renders that would reset its inputs.

const _byConversation = new Map();
const _listeners = new Map(); // cid → Set<fn>

export function setForm(conversationId, spec) {
  if (!conversationId || !spec || typeof spec !== 'object') return;
  // Guard against churn — JSON.parse always returns a new object,
  // so callers may invoke setForm with structurally-identical specs
  // each render. Skip the notification when nothing actually changed.
  const prev = _byConversation.get(conversationId);
  if (prev && _shallowFormEqual(prev, spec)) return;
  _byConversation.set(conversationId, spec);
  const subs = _listeners.get(conversationId);
  if (subs) for (const fn of subs) {
    try { fn(spec); } catch {}
  }
}

function _shallowFormEqual(a, b) {
  if (a === b) return true;
  // Compare the form_id + a stringified field+actions snapshot.
  // Any genuine update from anton bumps either form_id or one of
  // these structural fields, so this catches the no-op case
  // (re-parse of unchanged markdown) without missing real updates.
  if (a?.form_id !== b?.form_id) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Apply a partial update to the active form for a conversation. Used
// when Anton wants to flag an error or tweak metadata WITHOUT
// re-emitting the whole spec (which would re-list every field's
// `value` and bleed credentials into chat history).
//
// Patch shape:
//   { form_id, ...top-level overrides..., fields: { <name>: { ...field overrides... } | null } }
//
// Semantics:
//   * top-level keys overwrite; `null` clears that key
//   * `fields` is a name-keyed map. For each entry:
//       - object  → merge those properties into the matching field
//                   (null at the property level clears that property)
//       - null    → DELETE the entire field from the form
//       - missing → field untouched
//     When the field name doesn't exist yet AND the patch is an
//     object, it's appended as a new field (null on a missing name
//     is a no-op).
//   * if no current form exists OR form_id doesn't match, fall back
//     to treating the patch as a full spec (best-effort recovery)
export function patchForm(conversationId, patch) {
  if (!conversationId || !patch || typeof patch !== 'object') return;
  const prev = _byConversation.get(conversationId);
  if (!prev || prev.form_id !== patch.form_id) {
    setForm(conversationId, patch);
    return;
  }

  const next = { ...prev };
  for (const k of Object.keys(patch)) {
    if (k === 'fields') continue;
    if (patch[k] === null) delete next[k];
    else next[k] = patch[k];
  }

  if (patch.fields && typeof patch.fields === 'object' && !Array.isArray(patch.fields)) {
    const existing = Array.isArray(prev.fields) ? prev.fields : [];
    // Pass 1 — merge patches into existing fields, OR drop fields
    // whose patch is `null` (deletion semantic).
    const merged = [];
    for (const f of existing) {
      if (Object.prototype.hasOwnProperty.call(patch.fields, f.name)) {
        const fieldPatch = patch.fields[f.name];
        if (fieldPatch === null) continue; // deletion — skip from output
        if (!fieldPatch || typeof fieldPatch !== 'object') {
          merged.push(f);
          continue;
        }
        const out = { ...f };
        for (const k of Object.keys(fieldPatch)) {
          if (fieldPatch[k] === null) delete out[k];
          else out[k] = fieldPatch[k];
        }
        merged.push(out);
      } else {
        merged.push(f);
      }
    }
    // Pass 2 — append any patch entries whose name didn't exist.
    // `null` for a non-existent name is a silent no-op (nothing to
    // delete, no shape to append).
    for (const name of Object.keys(patch.fields)) {
      if (!existing.some((f) => f.name === name)) {
        const fp = patch.fields[name];
        if (fp && typeof fp === 'object') {
          merged.push({ name, ...fp });
        }
      }
    }
    next.fields = merged;
  }

  _byConversation.set(conversationId, next);
  const subs = _listeners.get(conversationId);
  if (subs) for (const fn of subs) {
    try { fn(next); } catch {}
  }
}

export function clearForm(conversationId) {
  if (!conversationId) return;
  _byConversation.delete(conversationId);
  const subs = _listeners.get(conversationId);
  if (subs) for (const fn of subs) {
    try { fn(null); } catch {}
  }
}

export function getForm(conversationId) {
  return _byConversation.get(conversationId) || null;
}

export function subscribe(conversationId, fn) {
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
