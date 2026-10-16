// Tiny pub/sub for the latest active `data-vault-form` per
// conversation. The markdown extension calls `setForm(cid, spec)`
// each time it parses a `data-vault-form` block; the form modal
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

// Redacted snapshot of the user's current form input — published by
// DataVaultForm on every change so the chat layer can inject context
// into messages sent during a connect task. Never holds secret field
// values (passwords, tokens). Shape:
//   { method: string|null,
//     fields: { <name>: <string-value-or-"__REDACTED__"> } }
const _formStateByConversation = new Map();
const _formStateListeners = new Map(); // cid → Set<fn>

// Selected-method tracking for multi-method forms. Lifted out of
// DataVaultForm so the panel chrome (header / breadcrumb) can read it
// AND clear it ("back to options"). DataVaultForm subscribes to read,
// and writes via `setSelectedMethod` whenever the user picks or backs
// out. Falls back to `spec.selected_method` when no override is set.
const _selectedMethodByConversation = new Map();
const _selectedMethodListeners = new Map(); // cid → Set<fn>

export function setSelectedMethod(conversationId, methodId) {
  if (!conversationId) return;
  if (!methodId) {
    _selectedMethodByConversation.delete(conversationId);
  } else {
    _selectedMethodByConversation.set(conversationId, methodId);
  }
  const subs = _selectedMethodListeners.get(conversationId);
  if (subs) for (const fn of subs) {
    try { fn(methodId || null); } catch {}
  }
}

export function getSelectedMethod(conversationId) {
  return _selectedMethodByConversation.get(conversationId) || null;
}

export function subscribeSelectedMethod(conversationId, fn) {
  if (!conversationId || typeof fn !== 'function') return () => {};
  let subs = _selectedMethodListeners.get(conversationId);
  if (!subs) {
    subs = new Set();
    _selectedMethodListeners.set(conversationId, subs);
  }
  subs.add(fn);
  return () => {
    const cur = _selectedMethodListeners.get(conversationId);
    if (cur) {
      cur.delete(fn);
      if (cur.size === 0) _selectedMethodListeners.delete(conversationId);
    }
  };
}

export function setFormState(conversationId, state) {
  if (!conversationId) return;
  if (!state) {
    _formStateByConversation.delete(conversationId);
  } else {
    _formStateByConversation.set(conversationId, state);
  }
  const subs = _formStateListeners.get(conversationId);
  if (subs) for (const fn of subs) {
    try { fn(state || null); } catch {}
  }
}

export function getFormState(conversationId) {
  return _formStateByConversation.get(conversationId) || null;
}

export function clearFormState(conversationId) {
  setFormState(conversationId, null);
}

export function subscribeFormState(conversationId, fn) {
  if (!conversationId || typeof fn !== 'function') return () => {};
  let subs = _formStateListeners.get(conversationId);
  if (!subs) {
    subs = new Set();
    _formStateListeners.set(conversationId, subs);
  }
  subs.add(fn);
  return () => {
    const cur = _formStateListeners.get(conversationId);
    if (cur) {
      cur.delete(fn);
      if (cur.size === 0) _formStateListeners.delete(conversationId);
    }
  };
}

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

// Merge a name-keyed patch map into an array of {name, ...} entries,
// honouring the standard semantics:
//   patch[name] = object → merge those properties into the matching
//                          entry (null at property level clears prop)
//   patch[name] = null   → delete the entry from the output
//   missing name         → entry untouched
//   new name + object    → append as a new entry
//   new name + null      → silent no-op
// Used both for the form's top-level `fields` array AND each method's
// own `fields` array.
function _mergeNamedList(existing, patchMap) {
  const list = Array.isArray(existing) ? existing : [];
  const out = [];
  for (const item of list) {
    if (Object.prototype.hasOwnProperty.call(patchMap, item.name)) {
      const p = patchMap[item.name];
      if (p === null) continue;
      if (!p || typeof p !== 'object') { out.push(item); continue; }
      const merged = { ...item };
      for (const k of Object.keys(p)) {
        if (p[k] === null) delete merged[k];
        else merged[k] = p[k];
      }
      out.push(merged);
    } else {
      out.push(item);
    }
  }
  for (const name of Object.keys(patchMap)) {
    if (!list.some((item) => item.name === name)) {
      const p = patchMap[name];
      if (p && typeof p === 'object') {
        out.push({ name, ...p });
      }
    }
  }
  return out;
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
    next.fields = _mergeNamedList(prev.fields, patch.fields);
  }

  // ── Methods (multi-method forms) ─────────────────────────────────
  // Same key-by-id semantics as fields, plus an inner `fields` list
  // each method owns. Patches look like:
  //   { methods: { app_password: { label: "App Password", fields: {...} | null } } }
  // and individual methods can be deleted with `methods[id] = null`.
  if (patch.methods && typeof patch.methods === 'object' && !Array.isArray(patch.methods)) {
    const existing = Array.isArray(prev.methods) ? prev.methods : [];
    const merged = [];
    for (const m of existing) {
      if (Object.prototype.hasOwnProperty.call(patch.methods, m.id)) {
        const mp = patch.methods[m.id];
        if (mp === null) continue; // deletion
        if (!mp || typeof mp !== 'object') { merged.push(m); continue; }
        const out = { ...m };
        for (const k of Object.keys(mp)) {
          if (k === 'fields') continue; // handled below
          if (mp[k] === null) delete out[k];
          else out[k] = mp[k];
        }
        if (mp.fields && typeof mp.fields === 'object' && !Array.isArray(mp.fields)) {
          out.fields = _mergeNamedList(m.fields, mp.fields);
        }
        merged.push(out);
      } else {
        merged.push(m);
      }
    }
    // New methods appended in the order they appear in the patch.
    for (const id of Object.keys(patch.methods)) {
      if (!existing.some((m) => m.id === id)) {
        const mp = patch.methods[id];
        if (mp && typeof mp === 'object') {
          // If the new method declares fields as a name-keyed map
          // (consistent with patch shape), normalise into the
          // array-of-objects shape the rest of the app expects.
          const newMethod = { id, ...mp };
          if (mp.fields && typeof mp.fields === 'object' && !Array.isArray(mp.fields)) {
            newMethod.fields = _mergeNamedList([], mp.fields);
          }
          merged.push(newMethod);
        }
      }
    }
    next.methods = merged;
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
  // Closing / clearing the form also clears the redacted state
  // snapshot — once the form is gone, there's nothing to inject
  // into chat messages.
  clearFormState(conversationId);
  // Drop any selected-method override so the next form opens at
  // its picker (or default state) rather than inheriting the prior
  // form's choice.
  setSelectedMethod(conversationId, null);
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
