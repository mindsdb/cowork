// Store the latest form per conversation outside streaming markdown so sibling views share it
// and stream updates cannot reset in-progress inputs.

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

// Share method selection with panel breadcrumbs; absent overrides fall back to
// spec.selected_method.
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
  // Skip notifications for structurally identical specs; parsed JSON gets a new identity on every
  // render.
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
  // Skip unchanged form reparses without notifying subscribers.
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
        if (mp === null) continue;
        if (!mp || typeof mp !== 'object') { merged.push(m); continue; }
        const out = { ...m };
        for (const k of Object.keys(mp)) {
          if (k === 'fields') continue;
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
    for (const id of Object.keys(patch.methods)) {
      if (!existing.some((m) => m.id === id)) {
        const mp = patch.methods[id];
        if (mp && typeof mp === 'object') {
          // Normalize new methods’ name-keyed field patches to the array shape used by the form.
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
  clearFormState(conversationId);
  // Clear the method override so the next form does not inherit this form’s selection.
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
