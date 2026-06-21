/*
 * ReviewBanner — owner-side "review returned" banner for the M3 review loop.
 *
 * Mounts under the workspace topbar when a reviewer has submitted a verdict on the
 * owner's artifact. The hero action is "Fix with AI" (AI gradient): one click should
 * hand the reviewer's notes to the M1 inline-edit pipeline (Anton rewrites in place).
 *
 * Two visual keys:
 *   - verdict 'changes'  → danger-tinted gradient bg, danger border (action needed).
 *   - verdict 'approved' → success-tinted bg, success border (informational; the
 *                          "Fix with AI" CTA is suppressed, only "View" remains).
 *
 * Pure presentational. No data fetching — the parent owns dismissal + wires callbacks.
 * Renders standalone with mock defaults so it can be eyeballed in isolation.
 *
 * Props:
 *   reviewer      { name, initials, color } — author of the review. `color` is any CSS
 *                  background (defaults to the AI gradient, matching reviewer pins).
 *   verdict       'changes' | 'approved' — drives copy + color. Default 'changes'.
 *   commentCount  number   — count shown after the verdict line. Default 2.
 *   note          string   — quoted reviewer note. Pass '' to hide the quote line.
 *   onFixWithAI   function  — hero gradient CTA (changes verdict only).
 *   onView        function  — secondary "View comments" / "View" handler.
 *   onDismiss     function  — close (X) handler.
 */

import React from 'react';

const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';

function SparkleIcon({ size = 13, stroke = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const DEFAULT_REVIEWER = { name: 'Maya Chen', initials: 'MC', color: AI_GRADIENT };

export function ReviewBanner({
  reviewer = DEFAULT_REVIEWER,
  verdict = 'changes',
  commentCount = 2,
  note = 'Punchy — but add the absolute ARR, and annotate the spike.',
  onFixWithAI,
  onView,
  onDismiss,
} = {}) {
  const r = reviewer ?? DEFAULT_REVIEWER;
  const approved = verdict === 'approved';

  // Tone: changes = danger-leaning gradient; approved = calm success wash.
  const bg = approved
    ? 'linear-gradient(100deg,rgba(74,222,128,.10),rgba(34,211,238,.06))'
    : 'linear-gradient(100deg,rgba(248,113,113,.10),rgba(34,211,238,.06))';
  const border = approved ? '1px solid rgba(74,222,128,.3)' : '1px solid rgba(248,113,113,.3)';
  const verb = approved ? 'approved this artifact' : 'requested changes';

  const avatarBg = r.color || AI_GRADIENT;
  const avatarInk = String(avatarBg).includes('gradient') ? '#04121a' : 'var(--ink)';

  const countText =
    commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'} on this artifact` : null;

  return (
    <div
      style={{
        margin: '10px 16px 0',
        background: bg,
        border,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        animation: 'riseIn .4s ease',
      }}
    >
      {/* Reviewer avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: avatarBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          color: avatarInk,
          flexShrink: 0,
        }}
      >
        {r.initials}
      </div>

      {/* Message */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
          <strong style={{ fontWeight: 600 }}>{r.name}</strong> {verb}
          {countText ? <span style={{ color: 'var(--ink-3)' }}> · {countText}</span> : null}
        </div>
        {note ? (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            &ldquo;{note}&rdquo;
          </div>
        ) : null}
      </div>

      {/* Hero — Fix with AI (gradient). Suppressed when approved (nothing to fix). */}
      {!approved ? (
        <button
          type="button"
          onClick={onFixWithAI}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 13px',
            borderRadius: 8,
            border: 'none',
            background: AI_GRADIENT,
            color: '#04121a',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <SparkleIcon />
          Fix with AI
        </button>
      ) : null}

      {/* Secondary — view the comments / the approval */}
      {onView ? (
        <button
          type="button"
          onClick={onView}
          style={{
            height: 30,
            padding: '0 13px',
            borderRadius: 8,
            border: '1px solid var(--line-2)',
            background: 'transparent',
            color: 'var(--ink-2)',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {approved ? 'View' : 'View comments'}
        </button>
      ) : null}

      {/* Dismiss */}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            border: 'none',
            background: 'transparent',
            color: 'var(--ink-4)',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

export default ReviewBanner;
