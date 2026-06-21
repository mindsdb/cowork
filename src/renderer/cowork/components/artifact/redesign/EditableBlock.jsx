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
//
// The default export is a tiny working demo (see <EditableBlockDemo/>), so this
// module can be rendered on its own to exercise the whole interaction.

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

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained demo. Renders a document-style page with a real, working
// EditableBlock driven by the mock AI. Try: click the paragraph → Ask AI →
// "Shorten" → watch the shimmer → see the inline diff → Keep updates the text.
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_TOKENS = {
  '--bg': '#080d18',
  '--surface': '#0E1626',
  '--surface-2': '#131D31',
  '--surface-3': '#1A2640',
  '--line': '#1E2A44',
  '--line-2': '#2A3957',
  '--ink': '#F2F6FF',
  '--ink-2': '#C7D2E5',
  '--ink-3': '#8A97AE',
  '--ink-4': '#5C6B85',
  '--accent': '#22D3EE',
  '--accent-bg': 'rgba(34,211,238,.10)',
  '--accent-glow': 'rgba(34,211,238,.45)',
  '--danger': '#F87171',
  '--success': '#4ade80',
  '--diff-add': 'rgba(74,222,128,.16)',
  '--diff-del': 'rgba(248,113,113,.14)',
  '--font-body': "'Inter',system-ui,sans-serif",
  '--font-mono': "'JetBrains Mono',ui-monospace,monospace",
};

export function EditableBlockDemo() {
  const [paragraph, setParagraph] = useState(
    'Invite your teammates from Settings so everyone lands in the same workspace. From there you can pick up exactly where you left off and keep the whole team in sync.',
  );
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const flash = (msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  return (
    <div
      style={{
        ...DEMO_TOKENS,
        minHeight: '100vh',
        background: 'radial-gradient(1100px 700px at 45% -8%,#0c1424,#080d18)',
        color: 'var(--ink-2)',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        justifyContent: 'center',
        padding: '48px 24px',
      }}
      onClick={() => { /* clicking the backdrop is handled by each block's outside-click */ }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          height: 'max-content',
          background: 'linear-gradient(180deg,#0e1830,#0b1224)',
          border: '1px solid var(--line-2)',
          borderRadius: 14,
          boxShadow: '0 30px 70px -24px rgba(0,0,0,.7)',
          padding: '54px 60px 60px',
        }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.14em', color: 'var(--ink-4)', textTransform: 'uppercase' }}>
          Customer Success · Draft
        </div>
        <h1 style={{ fontWeight: 700, fontSize: 32, lineHeight: 1.12, letterSpacing: '-.01em', color: 'var(--ink)', margin: '10px 0 6px' }}>
          Onboarding email sequence
        </h1>
        <div style={{ fontSize: 13, color: 'var(--ink-4)', marginBottom: 30, borderBottom: '1px solid var(--line)', paddingBottom: 18 }}>
          Owned by Jordan Lee · last edited 2m ago
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 10px' }}>
          Email 3 — Bring the team
        </h2>

        <EditableBlock
          text={paragraph}
          baseVersionId="v4"
          onCommitted={({ newText }) => {
            setParagraph(newText);
            flash('Kept · now on v5');
          }}
          onComment={({ text }) => flash(`Comment added: “${text}”`)}
          onToast={flash}
        />

        <p style={{ fontSize: 13, color: 'var(--ink-4)', margin: '18px 0 0', fontStyle: 'italic' }}>
          Tip — select the line and Ask AI for a suggestion. Try “Shorten” or “Make it warmer”.
        </p>
      </div>

      {toast ? (
        <div
          style={{
            position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
            display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)',
            border: '1px solid var(--line-2)', borderRadius: 11, padding: '11px 16px',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,.7)', animation: 'riseIn .3s ease',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

export default EditableBlockDemo;
