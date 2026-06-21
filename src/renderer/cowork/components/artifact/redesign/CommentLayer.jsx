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
function Pin({ pin, active, onSelect }) {
  const accent = pin.ai || pin.author?.color?.includes?.('gradient') ? AI_GRADIENT : pin.author?.color || ACCENT;
  return (
    <button
      type="button"
      onClick={(e) => {
        // While active, selecting a pin must NOT also drop a new one.
        e.stopPropagation();
        onSelect?.(pin.id);
      }}
      title={pin.resolved ? `Comment ${pin.n} · resolved` : `Comment ${pin.n}`}
      style={{
        position: 'absolute',
        left: `${pin.xPct}%`,
        top: `${pin.yPct}%`,
        // Anchor the teardrop's sharp corner at the click point.
        transform: 'translate(-50%, -100%)',
        width: 24,
        height: 24,
        padding: 0,
        border: 'none',
        borderRadius: '50% 50% 50% 2px',
        background: accent,
        color: ON_ACCENT,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--font-mono, monospace)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,.5)',
        // Pins are always clickable, even when the container is click-through.
        pointerEvents: 'auto',
        opacity: pin.resolved ? 0.42 : 1,
        animation: 'popIn .3s ease',
        zIndex: 2,
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

/**
 * CommentLayer
 *
 * Absolutely-positioned overlay that fills its `position:relative` parent. Drop it
 * as a sibling AFTER the artifact canvas (iframe / prose / slide stage).
 *
 * @param {object}   props
 * @param {boolean}  [props.active]        comment mode ON → overlay captures clicks. Default false.
 * @param {Array}    [props.pins]          [{ id, n, xPct, yPct, author?:{initials,color}, ai?, resolved? }]
 * @param {Function} [props.onCreate]      ({ xPct, yPct, body, area }) when a comment is submitted
 * @param {Function} [props.onSelectPin]   (id) when an existing pin is clicked
 * @param {Function} [props.onExitActive]  called after submit, and is the host's cue to flip `active` off
 */
export function CommentLayer({
  active = false,
  pins = DEFAULT_PINS,
  onCreate,
  onSelectPin,
  onExitActive,
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
        e.preventDefault();
        if (draft) clearDraft();
        else onExitActive?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, draft, clearDraft, onExitActive]);

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
      {/* existing pins — rendered in both modes, individually clickable */}
      {(pins || []).map((p) => (
        <Pin key={p.id} pin={p} active={active} onSelect={onSelectPin} />
      ))}

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
