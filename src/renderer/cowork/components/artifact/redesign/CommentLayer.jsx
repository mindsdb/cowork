// CommentLayer.jsx — a canvas overlay that lets a reviewer mark up ANY artifact
// (prose, slide stage, or an HTML/iframe preview) by dropping a pinned comment at
// a clicked point, and renders the existing comment pins.
//
// The host wraps its canvas in `position:relative` and drops this as a sibling
// AFTER the iframe/prose. When comment mode is OFF the overlay is fully
// click-through (`pointer-events:none`) so the underlying artifact — including an
// iframe preview — stays interactive; only the individual pins opt back in. When
// ON, the overlay captures clicks: a click computes xPct/yPct against the
// overlay's bounding box, drops a TEMPORARY pin, and opens a composer popover.
//
// Keyboard: Esc cancels (clears temp pin + composer), Cmd/Ctrl+Enter submits.
// Self-contained: ships mock `pins` and works standalone; `active` defaults false.
// Global @keyframes `popIn` is owned by ./redesign.css — referenced here by name.

import { useCallback, useEffect, useId, useRef, useState } from 'react';

const ACCENT = 'var(--accent)';
const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';
const ON_ACCENT = '#04121a'; // legible ink on the cyan accent / AI gradient

// Mock pins so the layer renders meaningfully on its own.
const DEFAULT_PINS = [
  { id: 'c1', n: 1, xPct: 28, yPct: 34, author: { initials: 'MC', color: ACCENT } },
  { id: 'c2', n: 2, xPct: 66, yPct: 58, author: { initials: 'AN', color: AI_GRADIENT }, ai: true },
  { id: 'c3', n: 3, xPct: 44, yPct: 78, author: { initials: 'JL', color: ACCENT }, resolved: true },
];

/* ── icons ─────────────────────────────────────────────────────────── */
function CommentGlyph({ size = 13, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 14a3 3 0 0 1-3 3H7l-4 3v-9a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v3Z" />
    </svg>
  );
}

/* ── a single numbered teardrop marker ─────────────────────────────── */
function Pin({ pin, selected = false, onSelect }) {
  const isAI = pin.ai || pin.author?.color?.includes?.('gradient');
  // Open comments must be easy to spot on ANY background, so use the bright accent
  // (AI gradient for AI authors) — never the dim author swatch — plus a white ring
  // and an outer cyan glow so the marker pops over both dark slides and light prose.
  const bg = isAI ? AI_GRADIENT : ACCENT;
  return (
    <button
      type="button"
      onClick={(e) => {
        // Selecting a pin must NOT also drop a new one (stop the overlay's click).
        e.stopPropagation();
        onSelect?.(pin.id);
      }}
      title={`Comment ${pin.n}`}
      style={{
        position: 'absolute',
        left: `${pin.xPct}%`,
        top: `${pin.yPct}%`,
        // Anchor the teardrop's sharp corner at the click point; bump the selected pin.
        transform: selected ? 'translate(-50%, -100%) scale(1.15)' : 'translate(-50%, -100%)',
        width: 28,
        height: 28,
        padding: 0,
        border: '2px solid #fff',
        borderRadius: '50% 50% 50% 3px',
        background: bg,
        color: ON_ACCENT,
        fontSize: 12,
        fontWeight: 800,
        fontFamily: 'var(--font-mono, monospace)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        // dark drop shadow (separates on light bg) + cyan halo (pops on dark bg);
        // the selected pin gets a stronger, wider halo so it reads as "open".
        boxShadow: selected
          ? '0 6px 18px rgba(0,0,0,.6), 0 0 0 7px rgba(34,211,238,.5)'
          : '0 4px 14px rgba(0,0,0,.55), 0 0 0 5px rgba(34,211,238,.30)',
        // Pins are always clickable, even when the container is click-through.
        pointerEvents: 'auto',
        opacity: 1,
        transition: 'box-shadow .12s ease, transform .12s ease',
        animation: 'popIn .3s ease',
        zIndex: selected ? 3 : 2,
      }}
    >
      {pin.n}
    </button>
  );
}

/* ── the temporary "you are dropping here" pin ─────────────────────── */
function TempPin({ x, y }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -100%)',
        width: 24,
        height: 24,
        borderRadius: '50% 50% 50% 2px',
        background: ACCENT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 14px rgba(0,0,0,.55), 0 0 0 4px rgba(34,211,238,.18)',
        pointerEvents: 'none',
        animation: 'popIn .18s ease',
        zIndex: 3,
      }}
    >
      <CommentGlyph size={13} color={ON_ACCENT} />
    </div>
  );
}

/* ── the composer popover anchored near the temp pin ───────────────── */
function Composer({ x, y, onSubmit, onCancel }) {
  const [body, setBody] = useState('');
  const [area, setArea] = useState('');
  const bodyRef = useRef(null);
  const descId = useId();

  useEffect(() => {
    const id = requestAnimationFrame(() => bodyRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    onSubmit?.({ body: text, area: area.trim() });
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel?.();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  // Flip the popover to the left / above the pin when it's near the right / bottom
  // edge so it stays on-canvas regardless of where the user clicked.
  const flipX = x > 62;
  const flipY = y > 64;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Add a comment"
      aria-describedby={descId}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        // Offset off the pin; flip based on proximity to the edges.
        transform: `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? 'calc(-100% - 12px)' : '8px'})`,
        width: 280,
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--surface)',
        border: '1px solid var(--accent)',
        borderRadius: 11,
        padding: 9,
        boxShadow: '0 16px 36px -10px rgba(0,0,0,.7), 0 0 0 4px rgba(34,211,238,.08)',
        pointerEvents: 'auto',
        animation: 'popIn .18s ease',
        zIndex: 4,
      }}
    >
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
        placeholder="Add a comment…  @mention"
        rows={3}
        style={{
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: 'var(--font-body, inherit)',
          boxSizing: 'border-box',
        }}
      />
      <input
        value={area}
        onChange={(e) => setArea(e.target.value)}
        onKeyDown={onKey}
        placeholder="Area (optional) — e.g. slide 3 / headline"
        style={{
          width: '100%',
          marginTop: 4,
          padding: '5px 7px',
          border: '1px solid var(--line)',
          borderRadius: 6,
          outline: 'none',
          background: 'var(--surface-2)',
          color: 'var(--ink-2)',
          fontSize: 11.5,
          fontFamily: 'var(--font-mono, monospace)',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <span id={descId} style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>⌘↵ to comment</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 26, padding: '0 11px', borderRadius: 7,
              border: '1px solid var(--line-2)', background: 'transparent',
              color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 500,
              fontFamily: 'var(--font-body, inherit)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim()}
            style={{
              height: 26, padding: '0 12px', borderRadius: 7, border: 'none',
              background: ACCENT, color: ON_ACCENT, fontSize: 11.5, fontWeight: 600,
              fontFamily: 'var(--font-body, inherit)',
              cursor: body.trim() ? 'pointer' : 'default',
              opacity: body.trim() ? 1 : 0.5,
            }}
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── read-only popover anchored at a clicked pin: shows the comment AT its spot ── */
function PinPopover({ pin, onClose, onResolve, onFix, onDiscuss, onCopy, onReply }) {
  // Flip toward the interior near the right / bottom edges so it stays on-canvas.
  const flipX = pin.xPct > 62;
  const flipY = pin.yPct > 64;
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const replies = Array.isArray(pin.replies) ? pin.replies : [];
  const submitReply = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onReply?.(pin.id, text);
    setSending(false);
    if (ok !== false) setReply(''); // clear only on success (handleReply returns false on failure)
  };
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Comment"
      style={{
        position: 'absolute',
        left: `${pin.xPct}%`,
        top: `${pin.yPct}%`,
        transform: `translate(${flipX ? 'calc(-100% - 16px)' : '16px'}, ${flipY ? 'calc(-100% - 14px)' : '6px'})`,
        width: 268,
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--surface)',
        border: '1px solid var(--accent)',
        borderRadius: 11,
        padding: 12,
        boxShadow: '0 16px 36px -10px rgba(0,0,0,.7), 0 0 0 4px rgba(34,211,238,.08)',
        pointerEvents: 'auto',
        animation: 'popIn .16s ease',
        zIndex: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: pin.author?.color || '#3a4d6e', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
          {pin.author?.initials || '?'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{pin.author?.name || 'Comment'}</span>
        {pin.when ? <span style={{ fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'var(--font-mono, monospace)' }}>{pin.when}</span> : null}
        <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 20, height: 20, border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      {pin.area ? <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginBottom: 5, fontFamily: 'var(--font-mono, monospace)' }}>{pin.area}</div> : null}
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 10 }}>
        {pin.body || '(no text)'}
      </div>

      {/* Thread: replies nested under the parent comment. */}
      {replies.length ? (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {replies.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 7 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: r.author?.color || '#3a4d6e', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, fontWeight: 700, flexShrink: 0 }}>
                {r.author?.initials || '?'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{r.author?.name || 'Someone'}</span>
                  {r.when ? <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono, monospace)' }}>{r.when}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.body}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Reply composer (Enter sends, Shift+Enter newline). */}
      {onReply ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(); } }}
            rows={1}
            placeholder="Reply…"
            aria-label="Reply to comment"
            style={{ flex: 1, resize: 'none', minHeight: 30, maxHeight: 90, padding: '6px 8px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-body, inherit)', lineHeight: 1.4 }}
          />
          <button type="button" onClick={submitReply} disabled={!reply.trim() || sending} style={{ alignSelf: 'flex-end', height: 30, padding: '0 11px', borderRadius: 7, border: 'none', background: (reply.trim() && !sending) ? 'var(--accent)' : 'var(--surface-3)', color: (reply.trim() && !sending) ? '#04121a' : 'var(--ink-4)', fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-body, inherit)', cursor: (reply.trim() && !sending) ? 'pointer' : 'default' }}>
            {sending ? '…' : 'Reply'}
          </button>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onResolve ? (
          <button type="button" onClick={() => onResolve(pin.id)} style={{ height: 26, padding: '0 11px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 500, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer' }}>
            Resolve
          </button>
        ) : null}
        {onFix ? (
          <button type="button" onClick={() => onFix(pin.id)} style={{ height: 26, padding: '0 12px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer' }}>
            Apply with AI
          </button>
        ) : null}
        {onDiscuss ? (
          <button type="button" onClick={() => onDiscuss(pin.id)} style={{ height: 26, padding: '0 11px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 500, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer' }}>
            Discuss
          </button>
        ) : null}
        {onCopy ? (
          <button type="button" onClick={() => onCopy(pin.id)} style={{ height: 26, padding: '0 11px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 500, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer' }}>
            Copy
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * CommentLayer
 *
 * Absolutely-positioned overlay that fills its `position:relative` parent. Drop it
 * as a sibling AFTER the artifact canvas (iframe / prose / slide stage).
 *
 * @param {object}   props
 * @param {boolean}  [props.active]        comment mode ON → overlay captures clicks. Default false.
 * @param {Array}    [props.pins]          [{ id, n, xPct, yPct, body, area, when, author?:{name,initials,color}, slide? }]
 * @param {Function} [props.onCreate]      ({ xPct, yPct, body, area }) when a comment is submitted
 * @param {Function} [props.onExitActive]  called after submit, and is the host's cue to flip `active` off
 * @param {?number}  [props.currentSlide]  active deck slide index; a pin with a
 *                                         `slide` only shows when it matches (so a
 *                                         slide-3 comment doesn't appear on slide 1).
 * @param {?string}  [props.activeId]      comment id whose pin popover is open (host-controlled).
 * @param {Function} [props.onActiveChange] (id|null) — clicking a pin opens its popover.
 * @param {Function} [props.onResolvePin]  (id) from the popover's Resolve button.
 * @param {Function} [props.onFixPin]      (id) "Apply with AI" — agent edits now.
 * @param {Function} [props.onDiscussPin]  (id) "Discuss" — agent plans first, no edit.
 * @param {Function} [props.onCopyPin]     (id) "Copy as context" → clipboard.
 * @param {Function} [props.onReply]       (parentId, body) — post a reply in the thread.
 */
export function CommentLayer({
  active = false,
  pins = DEFAULT_PINS,
  onCreate,
  onExitActive,
  currentSlide = null,
  activeId = null,
  onActiveChange,
  onResolvePin,
  onFixPin,
  onDiscussPin,
  onCopyPin,
  onReply,
} = {}) {
  const overlayRef = useRef(null);
  // The in-progress drop: { xPct, yPct } once the user clicks, else null.
  const [draft, setDraft] = useState(null);

  const clearDraft = useCallback(() => setDraft(null), []);

  // Leaving comment mode always discards any in-progress draft.
  useEffect(() => {
    if (!active) setDraft(null);
  }, [active]);

  // Esc anywhere while active cancels the draft (and exits if there was nothing to cancel).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (activeId) return; // a pin popover is open → let its own Esc handler close it first
        e.preventDefault();
        if (draft) clearDraft();
        else onExitActive?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, draft, clearDraft, onExitActive, activeId]);

  // Esc closes an open pin popover even in view mode (overlay is click-through then).
  useEffect(() => {
    if (!activeId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onActiveChange?.(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, onActiveChange]);

  // Click on bare overlay → compute xPct/yPct against the overlay box, drop temp pin.
  const handleOverlayClick = useCallback(
    (e) => {
      if (!active) return;
      const el = overlayRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
      setDraft({ xPct, yPct });
    },
    [active],
  );

  const submitDraft = useCallback(
    ({ body, area }) => {
      if (!draft) return;
      onCreate?.({ xPct: draft.xPct, yPct: draft.yPct, body, area });
      setDraft(null);
      onExitActive?.();
    },
    [draft, onCreate, onExitActive],
  );

  const visiblePins = (pins || []).filter(
    (p) => p.slide == null || currentSlide == null || p.slide === currentSlide,
  );
  const activePin = activeId ? visiblePins.find((p) => p.id === activeId) : null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      data-comment-active={active || undefined}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        // OFF → fully click-through so the artifact/iframe stays interactive (pins opt back in).
        // ON  → capture clicks to drop comments.
        pointerEvents: active ? 'auto' : 'none',
        cursor: active ? 'crosshair' : 'default',
        // A very faint tint signals comment mode without obscuring the artifact.
        background: active ? 'rgba(34,211,238,.04)' : 'transparent',
        transition: 'background .15s ease',
        overflow: 'hidden',
      }}
    >
      {/* existing pins — rendered in both modes, individually clickable. A pin
          scoped to a slide only shows when that slide is active; pins without a
          slide (prose, generic HTML) always show. Clicking a pin opens its popover
          (the comment shown right at its location). */}
      {visiblePins.map((p) => (
        <Pin key={p.id} pin={p} selected={p.id === activeId} onSelect={onActiveChange} />
      ))}
      {activePin ? (
        <PinPopover
          key={activePin.id}
          pin={activePin}
          onClose={() => onActiveChange?.(null)}
          onResolve={onResolvePin}
          onFix={onFixPin}
          onDiscuss={onDiscussPin}
          onCopy={onCopyPin}
          onReply={onReply}
        />
      ) : null}

      {/* comment-mode affordances */}
      {active && (
        <>
          {/* floating hint */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 12px',
              borderRadius: 999,
              background: 'var(--surface)',
              border: '1px solid var(--line-2)',
              color: 'var(--ink-2)',
              fontSize: 11.5,
              fontFamily: 'var(--font-body, inherit)',
              whiteSpace: 'nowrap',
              boxShadow: '0 8px 22px -8px rgba(0,0,0,.6)',
              pointerEvents: 'none',
              animation: 'popIn .2s ease',
              zIndex: 5,
            }}
          >
            <CommentGlyph size={12} color="var(--accent)" />
            Click anywhere to drop a comment
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ color: 'var(--ink-3)' }}>Esc to exit</span>
          </div>

          {draft && <TempPin x={draft.xPct} y={draft.yPct} />}
          {draft && (
            <Composer
              x={draft.xPct}
              y={draft.yPct}
              onSubmit={submitDraft}
              onCancel={clearDraft}
            />
          )}
        </>
      )}
    </div>
  );
}

export default CommentLayer;
