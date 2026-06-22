// useIframeInlineEdit.js — direct, no-AI in-place editing of a SAME-ORIGIN
// HTML preview iframe (the slide deck).
//
// The feel is "click → type → keep going → Save": when `active` flips true we
// reach into the iframe's live document, mark every text-bearing element
// `contentEditable`, and paint a quiet hover/focus affordance so the user sees
// what they can edit. They can retype any number of headings/paragraphs freely —
// nothing persists mid-edit. Edits only commit when the user hits Save (or leaves
// edit mode): we diff each editable element's innerHTML against its value at
// engage and hand the host a list of `{ locator, html }` edits — the host re-parses
// the on-disk SOURCE, resolves each locator there, sets innerHTML, and re-serializes
// as ONE new artifact version. We deliberately do NOT serialize the whole live DOM:
// that would bake in nodes a script built at runtime (e.g. a deck appending its nav
// dots on load), which duplicate on every save→reload and brick the deck. `dirty`
// tells the host whether there's anything to save. No per-blur churn.
//
// ── Same-origin / safety contract ────────────────────────────────────────────
// The preview iframe is served through the :5173 proxy so it's same-origin and
// `contentDocument` is readable. We never ASSUME that — every contentDocument
// access is wrapped in try/catch, and if the document is cross-origin (or simply
// not ready) the hook reports `{ supported:false }` so the host can disable the
// Edit toggle / show a "can't edit this preview inline" hint instead of throwing.
//
// ── What we DON'T do ─────────────────────────────────────────────────────────
// We only TOGGLE `contentEditable` and attach listeners + a thin style sheet. We
// never restructure the DOM, rename nodes, or strip scripts — the deck's own
// scripts and styles keep running untouched. On deactivate / unmount / iframe
// reload we remove the contentEditable flags, the listeners, and our injected
// <style>, leaving the document byte-equivalent to how the deck rendered it
// (modulo the user's intentional text changes).
//
// React 19, no external deps.

import { useCallback, useEffect, useRef, useState } from 'react';

// Tag names we make directly editable. These are leaf-ish text holders where
// inline editing is safe and intuitive.
const EDITABLE_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'P', 'SPAN', 'LI', 'TD', 'TH', 'A',
  'BLOCKQUOTE', 'FIGCAPTION', 'LABEL', 'SUMMARY', 'CAPTION',
  'EM', 'STRONG', 'B', 'I', 'SMALL', 'CODE',
]);

// Never make these editable even if they contain text — editing them would
// corrupt structure, executable content, or form semantics.
const FORBIDDEN_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT',
  'BUTTON', 'OPTION', 'HEAD', 'TITLE', 'META', 'LINK', 'BASE',
]);

const STYLE_EL_ID = '__cowork_inline_edit_style__';
const EDITABLE_ATTR = 'data-cowork-editable';

// The affordance: quiet on hover, accent ring on focus. Scoped to our marker
// attribute so it can't bleed onto the deck's own styles. The contentEditable
// caret + native focus stay intact; we only add an outline + cursor hint.
const AFFORDANCE_CSS = `
[${EDITABLE_ATTR}] {
  outline: 1px dashed transparent;
  outline-offset: 2px;
  border-radius: 3px;
  transition: outline-color .12s ease, background-color .12s ease;
  cursor: text;
}
[${EDITABLE_ATTR}]:hover {
  outline-color: rgba(34, 211, 238, .55);
  background-color: rgba(34, 211, 238, .06);
}
[${EDITABLE_ATTR}]:focus {
  outline: 2px solid rgba(34, 211, 238, .9);
  background-color: rgba(34, 211, 238, .08);
}
`;

// True if `el` directly holds text and has no element children that are
// themselves better edit targets — i.e. a leaf text holder. A <div> qualifies
// ONLY when it contains text and no child elements (the brief's "div with only
// text"); otherwise editing the div would swallow its children's structure.
function isTextLeaf(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (FORBIDDEN_TAGS.has(tag)) return false;

  const hasText = (el.textContent || '').trim().length > 0;
  if (!hasText) return false;

  if (EDITABLE_TAGS.has(tag)) {
    // For inline wrappers (SPAN/A/EM…), prefer the OUTERMOST editable so the
    // caret spans the whole phrase. If an ancestor is already marked editable,
    // skip this one (it'll be edited as part of the ancestor).
    return true;
  }

  if (tag === 'DIV') {
    // Editable only if it's a leaf: text but no element children.
    const hasElementChild = Array.from(el.children).some((c) => c.nodeType === 1);
    return !hasElementChild;
  }

  return false;
}

/**
 * useIframeInlineEdit
 *
 * @param {object}   opts
 * @param {object}   opts.iframeRef   ref to the preview <iframe>
 * @param {boolean}  opts.active      when true, the document becomes editable
 * @param {Function} opts.onSaveHtml  async ({ edits }) => void — fired once on
 *                                     Save / exit (not per blur). `edits` is a list
 *                                     of { locator, html } the host applies to the
 *                                     re-parsed SOURCE via saveArtifactContent. Must
 *                                     resolve { ok } so a failed save stays re-savable.
 * @param {Function} [opts.onError]   (message) => void — surfaced if access fails
 *                                     mid-session (e.g. the iframe navigated away)
 * @returns {{
 *   supported: boolean|null,  // null until first probe; false if cross-origin/inaccessible
 *   editing: boolean,         // mirrors `active` once successfully engaged
 *   commit: () => void,       // force-save any pending change (host "Save" button)
 *   dirty: boolean,           // true when there are un-saved edits in this session
 * }}
 */
export function useIframeInlineEdit({ iframeRef, active, onSaveHtml, onError } = {}) {
  const [supported, setSupported] = useState(null);
  const [editing, setEditing] = useState(false);
  // `dirty` = there are un-saved edits in this session. We DON'T persist on every
  // blur anymore (that spammed versions and remounted the iframe mid-edit); the
  // host shows a "Save changes" affordance and we commit once on Save / exit.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  // True while a save is in flight, so the Save button + the exit-cleanup commit
  // can't both fire the same save (which would write two versions).
  const savingRef = useRef(false);
  const markDirty = useCallback(() => {
    if (!dirtyRef.current) { dirtyRef.current = true; setDirty(true); }
  }, []);
  const clearDirty = useCallback(() => {
    if (dirtyRef.current) { dirtyRef.current = false; setDirty(false); }
  }, []);

  // Mutable session state kept in a ref so listeners always see the latest
  // without re-binding. Holds the doc, the marked elements, the snapshot of the
  // HTML at activation (the `oldHtml` baseline), and per-element "dirty since
  // focus" tracking.
  const sessionRef = useRef(null);
  const onSaveRef = useRef(onSaveHtml);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSaveRef.current = onSaveHtml; }, [onSaveHtml]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Defensive accessor — returns the iframe's document or null (never throws).
  const getDoc = useCallback(() => {
    try {
      const ifr = iframeRef?.current;
      if (!ifr) return null;
      // Touching contentDocument on a cross-origin frame throws → caught.
      const doc = ifr.contentDocument || ifr.contentWindow?.document || null;
      // Reading documentElement also throws cross-origin; force the check now.
      if (doc && doc.documentElement) return doc;
      return null;
    } catch {
      return null;
    }
  }, [iframeRef]);

  // Commit any pending text change. Diffs each editable element's innerHTML
  // against its value at engage and hands the host the changed { locator, html }
  // fragments (locator = a structural id-anchored path to the element); advances
  // the per-element baselines so a later commit in the same session re-diffs from
  // here. Only fires when there was real input (dirty).
  const commit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    // Only a real text edit (tracked via `input`) ever versions. This stops a
    // deck whose slide was navigated during edit mode — which mutates `.active`
    // classes in the live DOM — from writing a spurious no-text "version" on exit.
    if (!dirtyRef.current) return;
    if (savingRef.current) return; // a save is already in flight — don't double-fire
    const doc = getDoc();
    if (!doc) return;
    // Per-element diff: for each editable element whose inner content changed,
    // emit { locator, html } where `locator` is a structural id-anchored path to
    // the element and `html` is its new innerHTML. The host re-parses the on-disk
    // SOURCE (not the live DOM), resolves the locator there, sets innerHTML, and
    // re-serializes — so script-generated DOM (e.g. a deck's runtime nav dots) is
    // never baked in, and the edit is matched in DOM space (not by byte-fragile
    // innerHTML string matching, which fails on `<br/>`/`&`/attr normalization).
    const elements = s.elements || [];
    const edits = [];
    for (const el of elements) {
      try {
        if (!el || !el.isConnected) continue;
        const before = el.__coworkInnerAtEngage;
        const after = el.innerHTML;
        if (typeof before === 'string' && before !== after && el.__coworkLocator) {
          edits.push({ locator: el.__coworkLocator, html: after });
        }
      } catch { /* element detached */ }
    }
    if (!edits.length) { clearDirty(); return; } // nothing net-changed
    // Capture what we're saving so the per-element baselines advance ONLY after the
    // host confirms success. We do NOT clear dirty / advance baselines optimistically:
    // a failed save (e.g. a 500) must stay re-savable, not get stranded.
    const snapshot = elements.map((el) => [el, el.innerHTML]);
    savingRef.current = true;
    Promise.resolve()
      .then(() => onSaveRef.current?.({ edits }))
      .then((res) => {
        savingRef.current = false;
        // Advance baselines / clear dirty ONLY on an explicit success. A falsy or
        // shapeless result (failed save, or a host that didn't return { ok:true })
        // keeps the edit dirty and re-savable rather than silently dropping it.
        if (!res || res.ok !== true) return;
        for (const [el, html] of snapshot) {
          try { el.__coworkInnerAtEngage = html; } catch { /* detached */ }
        }
        clearDirty();
      })
      .catch((err) => {
        savingRef.current = false;
        onErrorRef.current?.(err?.message || 'Could not save your edit.');
      });
  }, [getDoc, clearDirty]);

  useEffect(() => {
    // Deactivating (or no iframe yet): persist any accumulated edits as ONE
    // version, then tear down the session. (Covers the not-ready→load→engage
    // path, whose effect cleanup only removed the load listener.)
    if (!active) {
      commit();
      teardown(sessionRef.current);
      sessionRef.current = null;
      setEditing(false);
      return undefined;
    }

    const doc = getDoc();
    if (!doc) {
      // Could be cross-origin OR the iframe just hasn't finished loading. We try
      // once now and, if it's not ready, watch for `load`; only after load do we
      // conclude "unsupported" so a slow proxy load isn't misreported.
      setSupported((prev) => (prev === true ? prev : null));
      const ifr = iframeRef?.current;
      if (!ifr) { setSupported(false); return undefined; }
      const onLoad = () => {
        const d = getDoc();
        if (d) {
          setSupported(true);
          engage(d);
        } else {
          setSupported(false);
          onErrorRef.current?.('This preview can’t be edited inline (cross-origin).');
        }
      };
      ifr.addEventListener('load', onLoad);
      return () => ifr.removeEventListener('load', onLoad);
    }

    setSupported(true);
    engage(doc);
    return () => {
      // Save pending edits as ONE version, then strip the editing affordances.
      commit();
      teardown(sessionRef.current);
      sessionRef.current = null;
    };

    // ── helpers closed over this effect run ──
    function engage(targetDoc) {
      // Idempotent: if we already engaged this exact document, do nothing.
      if (sessionRef.current && sessionRef.current.doc === targetDoc) return;
      teardown(sessionRef.current);

      let elements = [];
      try {
        injectStyle(targetDoc);
        elements = markEditable(targetDoc);
      } catch (err) {
        setSupported(false);
        onErrorRef.current?.(err?.message || 'Could not enter edit mode on this preview.');
        return;
      }

      // Snapshot each editable element's original innerHTML + a structural locator
      // (id-anchored child-index path). On commit we hand the host { locator, html }
      // and it applies the change to the re-parsed SOURCE — NOT a serialization of
      // the live DOM. Serializing the live DOM bakes in nodes a script built at
      // runtime (e.g. a deck appending its nav dots on load), which duplicate on
      // every save→reload and brick the deck.
      for (const el of elements) {
        try {
          el.__coworkInnerAtEngage = el.innerHTML;
          el.__coworkLocator = locatorFor(el);
        } catch { /* detached */ }
      }

      // Per-element focus snapshot → blur-diff. We also keep a document-level
      // baseline (the activation HTML) so `commit()` / "Done" can diff the whole
      // doc even if focus/blur tracking missed an edge (e.g. paste then Done).
      const onFocusIn = (e) => {
        const t = e.target;
        if (t && t.getAttribute?.(EDITABLE_ATTR) != null) {
          t.__coworkTextAtFocus = t.innerHTML;
        }
      };
      const onFocusOut = (e) => {
        const t = e.target;
        if (!t || t.getAttribute?.(EDITABLE_ATTR) == null) return;
        // We no longer save on blur — edits accumulate and persist as ONE version
        // on Save / exit, so the user can make many changes in a row without the
        // iframe remounting under them. Just drop the per-field focus snapshot
        // (kept only so Escape can revert the field in progress).
        delete t.__coworkTextAtFocus;
      };
      // Any text change anywhere in the editable doc marks the session dirty so
      // the host can show "Save changes". (Cheap: only flips state on first edit.)
      const onInput = (e) => {
        const t = e.target;
        if (t && t.getAttribute?.(EDITABLE_ATTR) != null) markDirty();
      };
      // Enter in a single-line heading shouldn't insert a newline + linger —
      // treat it as "done with this field": blur to trigger the commit.
      const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          const t = e.target;
          const tag = t?.tagName || '';
          if (/^H[1-6]$/.test(tag) || tag === 'A' || tag === 'TD' || tag === 'TH' || tag === 'LABEL') {
            e.preventDefault();
            t.blur?.();
          }
        }
        if (e.key === 'Escape') {
          // Abandon the in-progress field edit (revert to focus snapshot) and blur.
          const t = e.target;
          if (t && typeof t.__coworkTextAtFocus === 'string') {
            t.innerHTML = t.__coworkTextAtFocus;
            delete t.__coworkTextAtFocus;
          }
          t?.blur?.();
        }
      };

      targetDoc.addEventListener('focusin', onFocusIn, true);
      targetDoc.addEventListener('focusout', onFocusOut, true);
      targetDoc.addEventListener('keydown', onKeyDown, true);
      targetDoc.addEventListener('input', onInput, true);

      sessionRef.current = {
        doc: targetDoc,
        elements,
        listeners: { onFocusIn, onFocusOut, onKeyDown, onInput },
      };
      clearDirty();
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, getDoc, iframeRef, commit]);

  // On unmount, ensure no contentEditable / listeners linger in the iframe.
  useEffect(() => () => {
    teardown(sessionRef.current);
    sessionRef.current = null;
  }, []);

  return { supported, editing, commit, dirty };
}

// ── module-scope DOM helpers (all defensive; callers wrap in try/catch) ───────

function injectStyle(doc) {
  if (doc.getElementById(STYLE_EL_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_EL_ID;
  style.textContent = AFFORDANCE_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

// Build a structural locator for an element: a child-index path anchored at the
// nearest ancestor-or-self with an id (else from <html>). This resolves in the
// re-parsed SOURCE document even though the live document has extra script-built
// nodes (e.g. a deck's nav dots) — editable content lives inside id'd slides, so
// the path within that subtree is identical in source and live. Plain-object
// shape `{ id, path:[childIndex…] }` so it survives the postMessage-style hop to
// the host's save layer (see resolveLocator in saveArtifactContent).
function locatorFor(el) {
  const path = [];
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.id) return { id: node.id, path };
    const parent = node.parentElement;
    if (!parent) break;
    let idx = 0;
    let sib = node;
    while ((sib = sib.previousElementSibling)) idx += 1;
    path.unshift(idx);
    node = parent;
  }
  return { id: null, path };
}

// Walk the body, mark leaf text holders editable, and return the marked list.
// We mark the OUTERMOST eligible element on any branch so inline children
// (span/em inside a marked <p>) are edited as part of their parent rather than
// becoming independently-editable islands.
function markEditable(doc) {
  const root = doc.body || doc.documentElement;
  if (!root) return [];
  const marked = [];

  const walker = doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */, {
    acceptNode(node) {
      if (FORBIDDEN_TAGS.has(node.tagName)) return 2; // FILTER_REJECT (skip subtree)
      // If an ancestor is already marked editable, don't descend into it.
      if (node.closest && node.closest(`[${EDITABLE_ATTR}]`)) return 2;
      return isTextLeaf(node) ? 1 /* ACCEPT */ : 3 /* SKIP (but visit children) */;
    },
  });

  let n = walker.nextNode();
  while (n) {
    n.setAttribute(EDITABLE_ATTR, '');
    n.setAttribute('contenteditable', 'true');
    // Belt-and-suspenders: keep spellcheck on, but don't let the deck's own
    // draggable/UA behaviors fight the caret.
    n.setAttribute('spellcheck', 'true');
    marked.push(n);
    // After accepting a node we must NOT walk into it (its inline children are
    // part of this editable). Jump to the next sibling-ish node.
    n = walker.nextNode();
  }
  return marked;
}

// Remove everything we added. Safe to call with null / a stale session / a
// document that has since been torn down.
function teardown(session) {
  if (!session) return;
  const { doc, elements, listeners } = session;
  try {
    if (listeners && doc) {
      doc.removeEventListener('focusin', listeners.onFocusIn, true);
      doc.removeEventListener('focusout', listeners.onFocusOut, true);
      doc.removeEventListener('keydown', listeners.onKeyDown, true);
      doc.removeEventListener('input', listeners.onInput, true);
    }
  } catch { /* doc gone */ }
  try {
    for (const el of elements || []) {
      el.removeAttribute?.(EDITABLE_ATTR);
      el.removeAttribute?.('contenteditable');
      el.removeAttribute?.('spellcheck');
      if (el && '__coworkTextAtFocus' in el) delete el.__coworkTextAtFocus;
      if (el && '__coworkInnerAtEngage' in el) delete el.__coworkInnerAtEngage;
      if (el && '__coworkLocator' in el) delete el.__coworkLocator;
    }
  } catch { /* elements detached */ }
  try {
    const style = doc?.getElementById?.(STYLE_EL_ID);
    style?.remove();
  } catch { /* doc gone */ }
}

export default useIframeInlineEdit;
