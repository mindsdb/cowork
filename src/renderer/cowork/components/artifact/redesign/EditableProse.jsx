// EditableProse.jsx — instant, no-AI direct editing of prose / markdown blocks.
//
// The text counterpart to useIframeInlineEdit: render the artifact's paragraphs,
// and when `active` is true each block becomes directly contentEditable. The user
// edits any number of paragraphs freely; edits accumulate locally and DON'T
// persist mid-session. They commit as ONE new version when edit mode exits (the
// host's Save button, or toggling Edit off). `onDirtyChange` lets the host show a
// "Save changes" affordance. No puck, no agent, no per-blur version churn.
//
// This is deliberately SEPARATE from EditableBlock.jsx (the AI "Fix it in place"
// flow). EditableBlock is select → Ask AI → diff → Keep; EditableProse is plain
// typing that persists immediately. A host can offer both: AI assist via the
// puck, and a direct-edit mode toggle that swaps in EditableProse.
//
// ── How blocks map back to the file ──────────────────────────────────────────
// `blocks` are blank-line-separated paragraphs (same split the host already uses
// — see splitParagraphs in ArtifactWorkspaceRedesign). To persist we need the
// WHOLE new file content, so this component keeps the live block array and, on
// each commit, rejoins it (with the original "\n\n" separators) into the full
// document. It hands the host BOTH the new full content (via `onSaveContent`)
// and the per-block delta (via `onSaveText`) so the host can pick whichever its
// persist path wants — saveArtifactContent wants the full old/new content.
//
// Markdown note: we edit the RAW markdown text of each block as plain text (the
// canvas shows source-ish prose, not rendered HTML). contentEditable on a <div>
// can introduce <br>/&nbsp; on paste; `readPlainText` normalizes those back to
// plain text + real newlines so what we persist stays clean markdown.
//
// React 19, no external deps.

import { useCallback, useEffect, useRef, useState } from 'react';

const BLOCK_SEP = '\n\n';

const PROSE_STYLE = {
  fontSize: 15,
  lineHeight: 1.85,
  fontFamily: 'var(--font-body, inherit)',
  color: 'var(--ink-2)',
  margin: '0 0 14px',
  whiteSpace: 'pre-wrap', // preserve single newlines within a block
  borderRadius: 4,
  outline: '1px solid transparent',
  outlineOffset: 3,
  transition: 'outline-color .12s ease, background-color .12s ease',
};

// Pull plain text out of a contentEditable node: turn <div>/<br> line breaks
// back into '\n' and collapse &nbsp;, so a paste of rich text persists as clean
// markdown rather than smuggling HTML into a .md file.
function readPlainText(el) {
  if (!el) return '';
  // innerText respects line breaks the way the user sees them; fall back to
  // textContent if a non-DOM environment ever calls this.
  const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent || '';
  return raw.replace(/ /g, ' ').replace(/\r\n/g, '\n');
}

/**
 * One directly-editable paragraph. Uncontrolled while focused (so the caret
 * never jumps), reconciled from `text` only when the prop changes and the block
 * isn't being edited.
 */
function ProseBlock({ index, text, active, onCommitBlock }) {
  const ref = useRef(null);
  const atFocusRef = useRef(null);

  // Keep the DOM text in sync with the prop when NOT focused. We write
  // textContent (not innerHTML) so nothing can inject markup.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el === el.ownerDocument.activeElement) return; // don't stomp the caret
    if (readPlainText(el) !== text) el.textContent = text;
  }, [text]);

  const handleFocus = useCallback(() => {
    atFocusRef.current = readPlainText(ref.current);
  }, []);

  const handleBlur = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = readPlainText(el);
    const prev = atFocusRef.current;
    atFocusRef.current = null;
    if (prev != null && next !== prev) {
      onCommitBlock(index, next);
    }
  }, [index, onCommitBlock]);

  const handleKeyDown = useCallback((e) => {
    // Enter commits the block (blur); Shift+Enter inserts a newline within it.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === 'Escape') {
      // Revert to the value at focus and blur without saving.
      const el = ref.current;
      if (el && atFocusRef.current != null) el.textContent = atFocusRef.current;
      atFocusRef.current = null;
      el?.blur();
    }
  }, []);

  return (
    <p
      ref={ref}
      // suppressContentEditableWarning: we own the text via the effect above,
      // React must not try to manage children of a contentEditable node.
      suppressContentEditableWarning
      contentEditable={active ? 'true' : 'false'}
      spellCheck={active}
      onFocus={active ? handleFocus : undefined}
      onBlur={active ? handleBlur : undefined}
      onKeyDown={active ? handleKeyDown : undefined}
      data-block-index={index}
      style={{
        ...PROSE_STYLE,
        cursor: active ? 'text' : 'default',
        // Quiet affordance only in edit mode.
        ...(active
          ? {
              outlineColor: 'transparent',
              paddingInline: 4,
              marginInline: -4,
            }
          : null),
      }}
      // Hover/focus rings via inline handlers (no stylesheet dependency).
      onMouseEnter={active ? (e) => { e.currentTarget.style.outlineColor = 'rgba(34,211,238,.45)'; e.currentTarget.style.backgroundColor = 'rgba(34,211,238,.05)'; } : undefined}
      onMouseLeave={active ? (e) => { if (e.currentTarget !== e.currentTarget.ownerDocument.activeElement) { e.currentTarget.style.outlineColor = 'transparent'; e.currentTarget.style.backgroundColor = 'transparent'; } } : undefined}
      onFocusCapture={active ? (e) => { e.currentTarget.style.outline = '2px solid rgba(34,211,238,.9)'; e.currentTarget.style.backgroundColor = 'rgba(34,211,238,.07)'; } : undefined}
      onBlurCapture={active ? (e) => { e.currentTarget.style.outline = '1px solid transparent'; e.currentTarget.style.backgroundColor = 'transparent'; } : undefined}
    >
      {/* initial content; subsequent updates handled imperatively to protect the caret */}
      {text}
    </p>
  );
}

/**
 * EditableProse
 *
 * @param {object}   props
 * @param {string[]} props.blocks        blank-line-separated paragraphs of the doc
 * @param {boolean}  props.active        when true, blocks are directly editable
 * @param {Function} [props.onSaveText]  ({ oldText, newText, blockIndex }) => void
 *                                       — per-block delta on each commit
 * @param {Function} [props.onSaveContent] ({ oldContent, newContent }) => void
 *                                       — FULL document old/new text, fired ONCE on
 *                                       exit (this is what saveArtifactContent consumes)
 * @param {Function} [props.onDirtyChange] (boolean) => void — toggles when there
 *                                       are / aren't un-saved edits in the session
 * @param {string}   [props.separator]   how blocks rejoin into the file (default "\n\n")
 */
export function EditableProse({
  blocks,
  active,
  onSaveText,
  onSaveContent,
  onDirtyChange,
  separator = BLOCK_SEP,
}) {
  // Local working copy of the blocks. Seeded from props; updated on each commit
  // so the rejoined content reflects every prior edit in the session. Re-seeded
  // when the incoming `blocks` identity changes (e.g. host re-fetched after a
  // version restore / reload-token bump).
  const [local, setLocal] = useState(() => blocks || []);
  const blocksKey = (blocks || []).join('');
  const seededKey = useRef(blocksKey);
  useEffect(() => {
    if (active) return; // don't stomp an in-progress edit session
    if (seededKey.current !== blocksKey) {
      seededKey.current = blocksKey;
      setLocal(blocks || []);
    }
  }, [blocksKey, blocks, active]);

  const localRef = useRef(local);
  useEffect(() => { localRef.current = local; }, [local]);

  const onSaveTextRef = useRef(onSaveText);
  const onSaveContentRef = useRef(onSaveContent);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => { onSaveTextRef.current = onSaveText; }, [onSaveText]);
  useEffect(() => { onSaveContentRef.current = onSaveContent; }, [onSaveContent]);
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);

  // Session baseline = the document content when edit mode was entered. Dirty is
  // tracked against it; the actual persist happens ONCE, on exit (Save / toggle off).
  const baselineRef = useRef((blocks || []).join(separator));
  const dirtyRef = useRef(false);
  const setDirty = useCallback((v) => {
    if (dirtyRef.current !== v) { dirtyRef.current = v; onDirtyChangeRef.current?.(v); }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    // Entering edit mode: snapshot the baseline and start clean.
    baselineRef.current = (localRef.current || []).join(separator);
    setDirty(false);
    return () => {
      // If a block is still focused (e.g. exiting via Escape/close, with no blur
      // to commit it first), flush its current text into `local` so the session
      // commit doesn't drop the block the user was typing in.
      try {
        const ae = typeof document !== 'undefined' ? document.activeElement : null;
        const idxAttr = ae && ae.getAttribute ? ae.getAttribute('data-block-index') : null;
        if (idxAttr != null) {
          const idx = Number(idxAttr);
          const txt = readPlainText(ae);
          const cur = localRef.current || [];
          if (Number.isInteger(idx) && idx >= 0 && idx < cur.length && txt !== cur[idx]) {
            const next = cur.slice();
            next[idx] = txt;
            localRef.current = next;
          }
        }
      } catch { /* DOM gone / not accessible */ }
      // Leaving edit mode (or unmount): commit accumulated edits as ONE version.
      const newContent = (localRef.current || []).join(separator);
      const oldContent = baselineRef.current;
      setDirty(false);
      if (newContent !== oldContent) {
        onSaveContentRef.current?.({ oldContent, newContent });
      }
    };
  }, [active, separator, setDirty]);

  const handleCommitBlock = useCallback(
    (index, newText) => {
      const prevBlocks = localRef.current;
      const oldText = prevBlocks[index] ?? '';
      if (newText === oldText) return; // no-op guard (also enforced downstream)

      const nextBlocks = prevBlocks.slice();
      nextBlocks[index] = newText;
      localRef.current = nextBlocks;
      setLocal(nextBlocks);

      // Optional per-block delta for hosts that want it (NOT a persist).
      onSaveTextRef.current?.({ oldText, newText, blockIndex: index });
      // Mark dirty vs the session baseline; the save itself happens on exit.
      setDirty(nextBlocks.join(separator) !== baselineRef.current);
    },
    [separator, setDirty],
  );

  return (
    <>
      {(local || []).map((para, i) => (
        <ProseBlock
          key={i}
          index={i}
          text={para}
          active={active}
          onCommitBlock={handleCommitBlock}
        />
      ))}
    </>
  );
}

export default EditableProse;
