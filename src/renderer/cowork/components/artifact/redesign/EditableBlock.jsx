// EditableBlock.jsx — the M1 "Fix it in place" hero, wired end to end for a
// DOCUMENT (prose) block.
//
//   hover    → dashed accent outline (affordance: "this is selectable")
//   select   → solid accent ring + the <Puck/> mounts above it
//   Ask AI   → prompt face → submit → BUSY
//   busy     → shimmer skeleton + "Anton is rewriting this line…"
//   diff     → <InlineDiff/> (red/green track-changes) + Keep / Undo
//   keep     → commits via commitEdit, calls onCommitted, returns to idle
//
// Self-contained: pass nothing and it runs against the mock AI baked into
// useInlineEdit. Drop in real `proposeEdit`/`commitEdit` to hit the backend.

import { useEffect, useRef, useState } from 'react';
import { useInlineEdit } from './useInlineEdit.js';
import { Puck } from './Puck.jsx';
import { InlineDiff } from './InlineDiff.jsx';

const PROSE_STYLE = {
  fontSize: 15,
  lineHeight: 1.85,
  fontFamily: 'var(--font-body, inherit)',
  color: 'var(--ink-2)',
  margin: '0 0 8px',
};

/**
 * EditableBlock
 *
 * @param {object}   props
 * @param {string}   props.text            the block's current text
 * @param {*}        [props.target]        opaque locator passed back to proposeEdit/commitEdit
 *                                         (defaults to { text })
 * @param {string}   [props.baseVersionId] version this edit is computed against (compare-and-swap)
 * @param {Function} [props.proposeEdit]   async ({target, instruction}) => {oldText, newText}
 * @param {Function} [props.commitEdit]    async ({target, newText, baseVersionId}) => {ok, versionId}
 * @param {Function} [props.onComment]     ({target, text}) => void
 * @param {Function} [props.onCommitted]   ({target, newText, versionId}) => void
 * @param {Function} [props.onToast]       (message) => void  — surface no-op / error toasts
 */
export function EditableBlock({
  text,
  target,
  baseVersionId,
  proposeEdit,
  commitEdit,
  onComment,
  onCommitted,
  onToast,
}) {
  const [hover, setHover] = useState(false);
  const wrapRef = useRef(null);

  const edit = useInlineEdit({
    proposeEdit,
    commitEdit,
    baseVersionId,
    onComment,
    onCommitted,
  });

  // Surface no-op / error messages as a toast, then clear them from the hook.
  // (`dismissToast` is a stable useCallback, so this only fires when `error` changes.)
  const { error: editError, dismissToast } = edit;
  useEffect(() => {
    if (editError) {
      onToast?.(editError);
      dismissToast();
    }
  }, [editError, onToast, dismissToast]);

  // Dismiss the puck on an outside click (but not while busy or showing a diff —
  // those require an explicit choice). `cancel` is a stable useCallback.
  const puckOpen = edit.is.puckOpen;
  const { cancel } = edit;
  useEffect(() => {
    if (!puckOpen) return;
    const onDocPointer = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) cancel();
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    return () => document.removeEventListener('pointerdown', onDocPointer, true);
  }, [puckOpen, cancel]);

  const selected = edit.is.puckOpen;
  const handleSelect = (e) => {
    e.stopPropagation();
    if (edit.busy || edit.is.diff) return;
    edit.select(target ?? { text });
  };

  // ── BUSY: shimmer skeleton ───────────────────────────────────────────────────
  if (edit.busy) {
    return (
      <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 8px' }}>
        {[92, 100, 70].map((w, i) => (
          <div
            key={i}
            style={{
              height: 14,
              borderRadius: 5,
              width: `${w}%`,
              background: 'linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2))',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.3s linear infinite',
            }}
          />
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
          <span
            style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
              boxShadow: '0 0 8px var(--accent-glow, rgba(34,211,238,.45))', animation: 'antpulse 1s infinite',
            }}
          />
          Anton is rewriting this line…
        </div>
      </div>
    );
  }

  // ── DIFF: inline track-changes ────────────────────────────────────────────────
  if (edit.is.diff && edit.diff) {
    return (
      <div ref={wrapRef}>
        <InlineDiff
          oldText={edit.diff.oldText}
          newText={edit.diff.newText}
          onKeep={edit.keep}
          onUndo={edit.undo}
          conflict={edit.conflict}
          textStyle={PROSE_STYLE}
        />
      </div>
    );
  }

  // ── IDLE / MENU / PROMPT / COMMENT ────────────────────────────────────────────
  const outline = selected
    ? '2px solid var(--accent)'
    : hover
      ? '2px dashed rgba(34,211,238,.4)'
      : '2px solid transparent';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <p
        onClick={handleSelect}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...PROSE_STYLE,
          padding: '2px 4px',
          outline,
          outlineOffset: 5,
          borderRadius: 3,
          cursor: 'pointer',
          boxShadow: selected ? '0 0 0 8px rgba(34,211,238,.08)' : 'none',
          transition: 'outline-color .15s, box-shadow .15s',
        }}
      >
        {text}
      </p>

      {edit.is.menu ? (
        <Puck
          face="menu"
          onAskAI={edit.openPrompt}
          onStartComment={edit.startComment}
          onCancel={edit.cancel}
        />
      ) : null}
      {edit.is.prompt ? (
        <Puck
          face="prompt"
          onSubmitPrompt={edit.submitPrompt}
          onCancel={edit.cancel}
        />
      ) : null}
      {edit.is.comment ? (
        <Puck
          face="comment"
          onSubmitComment={edit.submitComment}
          onCancel={edit.cancel}
        />
      ) : null}
    </div>
  );
}
