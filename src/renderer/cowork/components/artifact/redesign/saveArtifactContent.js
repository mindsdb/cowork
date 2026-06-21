// saveArtifactContent.js — persist a WHOLE-FILE direct edit as a new artifact version.
//
// This is the bridge between the instant, no-AI inline editors
// (`useIframeInlineEdit`, `EditableProse`) and the real backend. The editors
// hand it the file's *previous* full text and the *new* full text; this helper
// commits the swap and returns the new `versionId` the host uses to advance its
// scrubber / story feed and to bump its reload token.
//
// ── Why propose → accept (and not writeProjectFile) ──────────────────────────
// `writeProjectFile(projectName, path, content)` writes bytes but creates NO
// artifact version and does NO optimistic-concurrency check — a concurrent
// agent/collaborator edit would be silently clobbered, and the version scrubber
// wouldn't see the change. The artifact-edit pipeline is the right path:
//
//   1. proposeArtifactEdit({ path, target, oldText, newText, baseVersionId })
//        → dry-run; validates that `oldText` is still present in `target`
//          (a whole-file `replace_text`: find oldText, replace with newText).
//          Returns { proposalId } we echo back on accept.
//   2. acceptArtifactEdit({ path, target, newText, baseVersionId, proposalId,
//        operationType: 'manual_edit' })
//        → compare-and-swap on `baseVersionId`; on success applies the swap and
//          records a NEW version (operationType 'manual_edit' for these direct
//          typed saves, vs the default 'ai_edit') → { ok, versionId }.
//          On 409 returns { conflict: { message, currentVersionId } } (no throw).
//
// Backend reference:
//   cowork-server-direction-2/cowork/services/artifact_edits.py
//   cowork-server-direction-2/cowork/api/v1/endpoints/artifact_edits.py
//
// The backend resolves the *artifact* from `path`; `target` is the path of the
// file to edit *within* the artifact folder. For a single-file artifact (the
// prose .md or the slide-deck .html) `target` is just that file's basename,
// which is what `defaultTargetFromPath(path)` returns. The host may override it.
//
// ── Edge cases this helper owns ──────────────────────────────────────────────
// • No-op: if newContent === oldContent we short-circuit to { ok, noop:true }
//   WITHOUT a network call, so a blur that changed nothing never versions.
// • Missing accept/propose endpoint (404/405/501): we fall back to
//   `writeProjectFile` so the edit at least persists in dev/self-hosted setups
//   that haven't mounted the edit router yet — returning { versionId:null,
//   fallback:'write' } so the host knows there's no real version to show.
//   (This mirrors how ProseCanvas's commitEdit degrades to a mock.)
// • Conflict (409): surfaced as { ok:false, conflict } so the host can decide
//   to re-fetch latest + replay, or hand off to the agent to merge. We do NOT
//   retry here — the host owns conflict UX.

import {
  proposeArtifactEdit,
  acceptArtifactEdit,
  writeProjectFile,
  previewArtifact,
} from '../../../api';

/** Basename of `path` — the file to edit *inside* the artifact folder. */
export function defaultTargetFromPath(path) {
  const p = String(path || '');
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function isEndpointUnavailable(err) {
  const s = err?.status;
  return s === 404 || s === 405 || s === 501;
}

/**
 * Resolve a locator (from useIframeInlineEdit's locatorFor) against a parsed
 * Document: anchor at the id'd element (or <html>), then walk the child-index
 * path. Returns the element or null if the path doesn't resolve (structure moved).
 * @param {Document} doc
 * @param {{ id: (string|null), path: number[] }} loc
 */
export function resolveLocator(doc, loc) {
  if (!doc || !loc) return null;
  let node = loc.id ? doc.getElementById(loc.id) : doc.documentElement;
  if (!node) return null;
  const path = Array.isArray(loc.path) ? loc.path : [];
  for (const idx of path) {
    const children = node.children;
    if (!children || idx < 0 || idx >= children.length) return null;
    node = children[idx];
  }
  return node;
}

/**
 * Persist a whole-file direct edit and create a new version.
 *
 * @param {object}   args
 * @param {string}   args.path            artifact path (resolves the artifact server-side)
 * @param {string}   [args.target]        file within the artifact folder to edit;
 *                                         defaults to basename(path)
 * @param {string}   [args.projectName]   needed only for the writeProjectFile fallback
 * @param {string}   args.oldContent      the file's FULL text before the edit (the
 *                                         compare-and-swap `find` text)
 * @param {string}   args.newContent      the file's FULL text after the edit
 * @param {string}   [args.baseVersionId] version the edit is computed against (OCC key)
 * @returns {Promise<
 *   | { ok: true,  noop: true }                              // nothing changed
 *   | { ok: true,  versionId: string|null, fallback?: 'write' }
 *   | { ok: false, conflict: { message: string, currentVersionId: string|null } }
 * >}
 */
export async function saveArtifactContent({
  path,
  target,
  projectName,
  oldContent,
  newContent,
  edits,
  baseVersionId,
} = {}) {
  if (!path) throw new Error('saveArtifactContent: path is required');
  const tgt = target || defaultTargetFromPath(path);
  const targeted = Array.isArray(edits);

  // ── Whole-file find string: the CURRENT stored bytes, re-fetched at save time ──
  // The backend's replace_text op (in both propose and accept) does a literal
  // find of `old_text` in the stored file and fails the whole edit if it isn't
  // present byte-for-byte. The `oldContent` the editors hand us is NOT reliable as
  // that find string:
  //   • HTML — `oldContent` is the iframe's serialized documentElement.outerHTML,
  //     which the browser NORMALIZES (doctype case, attribute quoting/order, void
  //     elements, whitespace). It will not byte-match the stored `deck.html`.
  //   • Prose — `oldContent` is splitParagraphs(content).join('\n\n'), which trims
  //     blocks, collapses 3+ blank lines, and drops empties — also not byte-exact.
  // So we re-read the live stored content for `path`@`baseVersionId` and use THAT
  // as the find. The whole-file swap then always matches, so a version is reliably
  // created. We fall back to the editor-supplied `oldContent` only if the re-fetch
  // fails (better an attempt that may 400 than silently dropping the user's edit).
  let storedText = null;
  let truncated = false;
  try {
    // Read the find-content from the LIVE working copy (no versionId). accept_edit
    // applies the patch against a staged copy of the ON-DISK folder, so the find
    // must match DISK — not a stored version snapshot that may have diverged from it.
    const cur = await previewArtifact(path, { versionId: '' });
    if (cur && typeof cur.content === 'string') storedText = cur.content;
    if (cur && cur.truncated) truncated = true;
  } catch (err) {
    if (isEndpointUnavailable(err)) {
      // Targeted edits can't be rebuilt without the source — never overwrite the
      // file with a fragment via the write fallback; surface the failure instead.
      if (targeted) throw err;
      return writeFallback({ projectName, path, newText: typeof newContent === 'string' ? newContent : '' });
    }
    // Non-fatal: fall back to the caller-supplied oldContent below.
  }
  const oldText =
    typeof storedText === 'string'
      ? storedText
      : (typeof oldContent === 'string' ? oldContent : '');

  // ── Compute the new full-file text ────────────────────────────────────────────
  // Targeted mode (HTML inline edit): re-parse the SOURCE into a DOM (DOMParser does
  // NOT execute scripts, so runtime-built nodes — e.g. a deck's nav dots — are absent
  // and never baked back in), resolve each edit's structural locator there, set its
  // innerHTML, and re-serialize the whole document. The edit is matched in DOM space,
  // so browser innerHTML normalization (<br/>, &, attribute quoting) can't make it
  // miss the way a raw byte `find` did. A locator that doesn't resolve is skipped
  // (fail-safe — never corrupts). First save normalizes the file; subsequent saves
  // diff cleanly. Whole-content mode (prose): newContent IS the new file.
  let newText;
  let skipped = 0;
  if (targeted) {
    if (typeof storedText !== 'string') {
      return {
        ok: false,
        conflict: {
          message: 'Could not read the current file to apply your edit. Reload and try again.',
          currentVersionId: null,
        },
      };
    }
    if (truncated) {
      // We only hold a 200 KB prefix; a swap built on it would mismatch the full
      // file. Fail clearly instead of silently dropping or mis-applying edits.
      return {
        ok: false,
        conflict: {
          message: 'This file is too large to edit inline here.',
          currentVersionId: null,
        },
      };
    }
    let doc = null;
    try { doc = new DOMParser().parseFromString(storedText, 'text/html'); } catch { doc = null; }
    if (!doc || !doc.documentElement) {
      return {
        ok: false,
        conflict: {
          message: 'Could not parse this artifact to apply your edit. Reload and try again.',
          currentVersionId: null,
        },
      };
    }
    let applied = 0;
    for (const e of edits) {
      if (!e || !e.locator || typeof e.html !== 'string') { skipped += 1; continue; }
      const node = resolveLocator(doc, e.locator);
      if (!node) { skipped += 1; continue; } // structure moved / locator didn't resolve
      try { node.innerHTML = e.html; applied += 1; }
      catch { skipped += 1; }
    }
    if (!applied) return { ok: true, noop: true, skipped }; // nothing resolved / changed
    const doctype = /^\s*<!doctype/i.test(storedText) ? '<!doctype html>\n' : '';
    newText = doctype + doc.documentElement.outerHTML;
  } else {
    newText = typeof newContent === 'string' ? newContent : '';
  }

  // 0 — no-op guard (instant; never touches the version pipeline). If the edited
  //     text already equals the stored bytes there is genuinely nothing to commit.
  if (oldText === newText) return { ok: true, noop: true };
  // Defensive: an empty find can never match (and the backend rejects it). Treat a
  // failed re-fetch with no usable oldContent as a no-version write fallback.
  if (!oldText) {
    return writeFallback({ projectName, path, newText });
  }

  // 1 — propose (dry-run): confirms `oldText` is still the live bytes of `target`
  //     and yields a proposalId. A 409-equivalent here is surfaced as a conflict
  //     by the accept step; propose itself never mutates.
  let proposalId = null;
  try {
    const proposed = await proposeArtifactEdit({
      path,
      target: tgt, // file-within-folder path the backend edits
      instruction: 'Direct edit',
      oldText,
      newText,
      baseVersionId,
    });
    proposalId = proposed?.proposalId || null;
    // If the backend couldn't locate oldText, `applies` is false; we still attempt
    // accept (the accept re-validates and will 409 / 400 authoritatively rather
    // than us guessing here).
  } catch (err) {
    if (isEndpointUnavailable(err)) {
      return writeFallback({ projectName, path, newText });
    }
    throw err;
  }

  // 2 — accept (compare-and-swap): persists the swap + records a new version.
  let res;
  try {
    res = await acceptArtifactEdit({
      path,
      target: tgt, // backend wants the file-within-folder path as `target`
      oldText, // REQUIRED by the backend; re-validated against the staged folder
      newText,
      baseVersionId,
      proposalId,
      // Direct typed edits are the user's own work, not an AI rewrite — record
      // them as 'manual_edit' so the Versions/Story panel shows "You · Edited"
      // instead of "Unknown · AI edit".
      operationType: 'manual_edit',
    });
  } catch (err) {
    if (isEndpointUnavailable(err)) {
      return writeFallback({ projectName, path, newText });
    }
    throw err;
  }

  if (res?.conflict) {
    return {
      ok: false,
      conflict: {
        message:
          res.conflict.message ||
          'This changed since you started — reload to get the latest, then re-apply.',
        currentVersionId: res.conflict.currentVersionId || null,
      },
    };
  }

  return { ok: true, versionId: res?.versionId || null, skipped };
}

// Last-resort persistence when the edit router isn't mounted. Writes bytes with
// no version + no OCC; returns fallback:'write' so the host doesn't promise a
// version it can't show.
async function writeFallback({ projectName, path, newText }) {
  if (!projectName) {
    throw new Error(
      'saveArtifactContent: edit endpoint unavailable and no projectName for the write fallback',
    );
  }
  const rel = defaultTargetFromPath(path);
  await writeProjectFile(projectName, rel, newText);
  return { ok: true, versionId: null, fallback: 'write' };
}

export default saveArtifactContent;
