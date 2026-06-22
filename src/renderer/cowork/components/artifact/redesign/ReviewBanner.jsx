/*
 * ReviewBanner — owner-side "review returned" banner for the M3 review loop.
 *
 * Mounts under the workspace topbar when a reviewer has submitted a verdict on the
 * owner's artifact. The hero action is "Fix with AI" (AI gradient): one click should
 * hand the reviewer's notes to the M1 inline-edit pipeline (Anton rewrites in place).
 *
 * Danger-tinted gradient bg + border signals action is needed; the hero action is
 * "Fix with AI". Pure presentational — the parent owns dismissal + wires callbacks.
 * Renders standalone with mock defaults so it can be eyeballed in isolation.
 *
 * Props:
 *   reviewer      { name, initials, color } — author of the review. `color` is any CSS
 *                  background (defaults to the AI gradient, matching reviewer pins).
 *   commentCount  number   — count shown after the verdict line. Default 2.
 *   note          string   — quoted reviewer note. Pass '' to hide the quote line.
 *   onFixWithAI   function  — hero gradient CTA.
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
  commentCount = 2,
  note = 'Punchy — but add the absolute ARR, and annotate the spike.',
  onFixWithAI,
  onDismiss,
} = {}) {
  const r = reviewer ?? DEFAULT_REVIEWER;

  // Danger-leaning gradient: a returned review means action is needed.
  const bg = 'linear-gradient(100deg,rgba(248,113,113,.10),rgba(34,211,238,.06))';
  const border = '1px solid rgba(248,113,113,.3)';
  const verb = 'requested changes';

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

      {/* Hero — Fix with AI (gradient). */}
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
