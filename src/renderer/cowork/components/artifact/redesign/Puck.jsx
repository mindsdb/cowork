// Puck.jsx — the floating menu/prompt/comment popover that hovers above a
// selected element. It is the entry point into the M1 "Fix it in place" flow.
//
// Three faces, driven by the useInlineEdit state machine:
//   menu    → [Ask AI (accent)] [Comment]
//   prompt  → ✦ "Tell Anton what to change…" + chips [Make it punchier][Shorten] + ↑submit
//   comment → "Add a comment…  @mention" + Comment submit
//
// Keyboard: Enter submits, Esc cancels. Autofocuses its input on open.
// Purely presentational: every bit of state + every action comes in as props.

import { useEffect, useRef, useState } from 'react';

const SparkleIcon = ({ size = 13, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8" />
  </svg>
);

const CommentIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 14a3 3 0 0 1-3 3H7l-4 3v-9a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v3Z" />
  </svg>
);

const SubmitArrow = ({ color = '#04121a' }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const POPOVER_BASE = {
  position: 'absolute',
  zIndex: 20,
  background: 'var(--surface)',
  borderRadius: 11,
  boxShadow: '0 16px 36px -10px rgba(0,0,0,.7)',
  animation: 'popIn .18s ease',
};

const DEFAULT_PROMPT_CHIPS = ['Make it punchier', 'Shorten'];

function cssSize(value, fallback) {
  if (value == null) return fallback;
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Puck
 *
 * @param {object}   props
 * @param {'menu'|'prompt'|'comment'} props.face   which face to render
 * @param {Function} props.onAskAI         open the prompt face (menu → prompt)
 * @param {Function} props.onStartComment  open the comment face (menu → comment)
 * @param {Function} props.onSubmitPrompt  (text) => void
 * @param {Function} props.onSubmitComment (text) => void
 * @param {Function} props.onCancel        Esc / dismiss
 * @param {string}   [props.askLabel]      menu primary label ("Ask AI", "Annotate")
 * @param {boolean}  [props.showCommentLabel] false gives the chart-style icon button
 * @param {string[]} [props.promptChips]   quick prompt chips under the Ask AI input
 * @param {object}   [props.style]         extra positioning (top/left overrides)
 */
export function Puck({
  face = 'menu',
  askLabel = 'Ask AI',
  commentLabel = 'Comment',
  showCommentLabel = true,
  promptPlaceholder = 'Tell Anton what to change…',
  commentPlaceholder = 'Add a comment…  @mention',
  promptChips = DEFAULT_PROMPT_CHIPS,
  promptWidth = 340,
  commentWidth = 300,
  onAskAI,
  onStartComment,
  onSubmitPrompt,
  onSubmitComment,
  onCancel,
  style,
}) {
  const [prompt, setPrompt] = useState('');
  const [comment, setComment] = useState('');
  const inputRef = useRef(null);
  const quickPrompts = promptChips?.length ? promptChips : DEFAULT_PROMPT_CHIPS;

  // Autofocus the relevant input whenever we enter prompt/comment.
  useEffect(() => {
    if (face === 'prompt' || face === 'comment') {
      // rAF so the element exists + popIn has started before we focus.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [face]);

  const submitPrompt = () => {
    const t = prompt.trim();
    if (t) onSubmitPrompt?.(t);
  };
  const submitComment = () => {
    const t = comment.trim();
    if (t) onSubmitComment?.(t);
  };

  const onPromptKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitPrompt(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
  };
  const onCommentKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitComment(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
  };

  // ── MENU ───────────────────────────────────────────────────────────────────
  if (face === 'menu') {
    return (
      <div
        role="menu"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...POPOVER_BASE,
          top: -46,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          border: '1px solid var(--line-2)',
          padding: 5,
          whiteSpace: 'nowrap',
          ...style,
        }}
      >
        <button
          type="button"
          onClick={onAskAI}
          className="rd-no-truncate"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px',
            borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#04121a',
            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer',
          }}
        >
          <SparkleIcon />
          {askLabel}
        </button>
        <button
          type="button"
          onClick={onStartComment}
          className="rd-no-truncate"
          title={showCommentLabel ? undefined : commentLabel}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: showCommentLabel ? 6 : 0,
            width: showCommentLabel ? undefined : 28,
            height: 28,
            padding: showCommentLabel ? '0 11px' : 0,
            borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--ink-2)',
            fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer',
          }}
        >
          <CommentIcon />
          {showCommentLabel ? commentLabel : null}
        </button>
      </div>
    );
  }

  // ── PROMPT (Ask AI) ──────────────────────────────────────────────────────────
  if (face === 'prompt') {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...POPOVER_BASE,
          top: -54,
          left: 0,
          width: cssSize(promptWidth, '340px'),
          maxWidth: 'calc(100vw - 32px)',
          border: '1px solid var(--accent)',
          padding: 8,
          boxShadow: '0 16px 36px -10px rgba(0,0,0,.7),0 0 0 4px rgba(34,211,238,.08)',
          ...style,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SparkleIcon size={15} color="var(--accent)" />
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            placeholder={promptPlaceholder}
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-body, inherit)',
            }}
          />
          <button
            type="button"
            onClick={submitPrompt}
            aria-label="Send to Anton"
            style={{
              width: 28, height: 28, borderRadius: 7, border: 'none', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <SubmitArrow />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 7, paddingLeft: 3, flexWrap: 'wrap' }}>
          {quickPrompts.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onSubmitPrompt?.(chip)}
              className="rd-no-truncate"
              style={{
                fontSize: 11, color: 'var(--ink-3)', background: 'var(--surface-2)',
                border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px',
                cursor: 'pointer', fontFamily: 'var(--font-body, inherit)', whiteSpace: 'nowrap',
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── COMMENT ──────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        ...POPOVER_BASE,
        top: -58,
        left: 0,
        width: cssSize(commentWidth, '300px'),
        maxWidth: 'calc(100vw - 32px)',
        border: '1px solid var(--line-2)',
        padding: 9,
        ...style,
      }}
    >
      <input
        ref={inputRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={onCommentKey}
        placeholder={commentPlaceholder}
        style={{
          width: '100%', border: 'none', outline: 'none', background: 'transparent',
          color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-body, inherit)',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          type="button"
          onClick={submitComment}
          className="rd-no-truncate"
          style={{
            height: 26, padding: '0 12px', borderRadius: 7, border: 'none', background: 'var(--accent)',
            color: '#04121a', fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer',
          }}
        >
          {commentLabel}
        </button>
      </div>
    </div>
  );
}

export default Puck;
