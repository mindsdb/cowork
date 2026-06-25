/*
 * TopBar — 50px header bar for the redesigned artifact workspace main panel.
 *
 * Pure presentational shell component (M0 chassis). No data fetching, no app state.
 * Pure presentational shell component (M0 chassis). No data fetching, no app state.
 *
 * Layout (left → right):
 *   artifact-type icon · title · "· breadcrumb" · mono version chip
 *   — flexible spacer —
 *   presence cluster (pulsing success dot + "N here" + overlapping avatars w/ tooltips)
 *   · ghost Share button · solid-accent primary CTA.
 *
 * Props:
 *   typeIcon     ReactNode — leading artifact-type glyph. Defaults to a deck/box icon.
 *   title        string    — artifact title.
 *   breadcrumb   string    — secondary context after the title (e.g. project).
 *   versionLabel string    — mono chip text, e.g. 'v7'.
 *   presence     array     — [{ initials, color, tip }]. `color` is any CSS background
 *                            (use the AI gradient for the AI/lead). `tip` shows on hover.
 *   onShare      function  — ghost Share button click handler.
 *   primaryCta   object    — { label, onClick } for the solid-accent CTA.
 */

import React from 'react';

const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';

function DefaultTypeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.7">
      <path d="M12 3 21 7.5 12 12 3 7.5 12 3Z" />
      <path d="M3 7.5v9L12 21V12" />
      <path d="M21 7.5v9L12 21" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4 4 0 0 1 0-5.66l3-3a4 4 0 1 1 5.66 5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 1 0 5.66l-3 3a4 4 0 1 1-5.66-5.66l1.5-1.5" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 14a3 3 0 0 1-3 3H7l-4 3v-9a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v3Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function TopBar({
  typeIcon,
  title = 'Artifact',
  breadcrumb = '',
  versionLabel = '',
  presence = [],
  onShare,
  primaryCta = null,
  editMode = false,
  onToggleEdit,
  commentMode = false,
  onToggleComment,
  onClose,
} = {}) {
  const people = presence ?? [];
  const presenceLabel = people.length ? `${people.length} here` : '';

  return (
    <div
      style={{
        height: 50,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 16px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      {/* Identity cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, overflow: 'visible' }}>
        {typeIcon ?? <DefaultTypeIcon />}
        <span
          className="rd-no-truncate"
          title={title}
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'visible',
            textOverflow: 'clip',
          }}
        >
          {title}
        </span>
        {breadcrumb ? (
          <span className="rd-no-truncate" style={{ fontSize: 12, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>· {breadcrumb}</span>
        ) : null}
        {versionLabel ? (
          <span
            className="rd-no-truncate"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--accent)',
              background: 'var(--accent-bg)',
              borderRadius: 5,
              padding: '2px 7px',
              whiteSpace: 'nowrap',
            }}
          >
            {versionLabel}
          </span>
        ) : null}
      </div>

      <div style={{ flex: 1 }} />

      {/* Presence */}
      {people.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginRight: 4 }}>
          <span className="rd-no-truncate" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 8px var(--success-glow, rgba(74,222,128,.5))',
                animation: 'antpulse 1.8s infinite',
              }}
            />
            {presenceLabel}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 2 }}>
            {people.map((p, i) => (
              <div
                key={`${p.initials}-${i}`}
                title={p.tip}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: p.color || '#3a4d6e',
                  border: '2px solid var(--surface)',
                  marginLeft: i === 0 ? 0 : -9,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  // Avatars on the AI gradient get dark ink; flat-color avatars get light ink.
                  color: (p.color || '').includes('gradient') ? '#04121a' : 'var(--ink)',
                }}
              >
                {p.initials}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Edit mode toggle — direct in-place typing (no AI) */}
      {onToggleEdit ? (
        <button
          onClick={onToggleEdit}
          className="rd-no-truncate"
          title="Edit the artifact directly — click text and type"
          aria-pressed={editMode}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 28,
            height: 30,
            padding: '0 13px',
            borderRadius: 8,
            border: `1px solid ${editMode ? 'var(--accent)' : 'var(--line-2)'}`,
            background: editMode ? 'var(--accent-bg)' : 'transparent',
            color: editMode ? 'var(--accent)' : 'var(--ink-2)',
            fontSize: 12.5,
            fontWeight: editMode ? 600 : 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <EditIcon />
          {editMode ? 'Editing' : 'Edit'}
        </button>
      ) : null}

      {/* Comment mode toggle — ghost, active when on */}
      {onToggleComment ? (
        <button
          onClick={onToggleComment}
          className="rd-no-truncate"
          title="Comment on the artifact"
          aria-pressed={commentMode}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 13px',
            borderRadius: 8,
            border: `1px solid ${commentMode ? 'var(--accent)' : 'var(--line-2)'}`,
            background: commentMode ? 'var(--accent-bg)' : 'transparent',
            color: commentMode ? 'var(--accent)' : 'var(--ink-2)',
            fontSize: 12.5,
            fontWeight: commentMode ? 600 : 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <CommentIcon />
          Comment
        </button>
      ) : null}

      {/* Share — ghost */}
      <button
        onClick={onShare}
        className="rd-no-truncate"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginLeft: 28,
          height: 30,
          padding: '0 13px',
          borderRadius: 8,
          border: '1px solid var(--line-2)',
          background: 'transparent',
          color: 'var(--ink-2)',
          fontSize: 12.5,
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <ShareIcon />
        Share
      </button>

      {/* Primary CTA — solid accent */}
      {primaryCta ? (
        <button
          onClick={primaryCta.onClick}
          className="rd-no-truncate"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 13px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: '#04121a',
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {primaryCta.label}
        </button>
      ) : null}

      {/* Close (✕) — the workspace is a modal; there is no minimize. */}
      {onClose ? (
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="rd-no-truncate"
          style={{
            width: 30,
            height: 30,
            marginLeft: 2,
            borderRadius: 8,
            border: '1px solid var(--line-2)',
            background: 'transparent',
            color: 'var(--ink-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

export default TopBar;
