/*
 * VerdictBar — the forced-verdict footer for the M3 review loop.
 *
 * A reviewer must land on exactly one verdict before they're done: "Request changes"
 * (danger outline) or "Approve" (solid success). After a verdict is submitted the bar
 * collapses into a success confirmation card whose copy depends on where it lives:
 *   - in-app  → "Jordan has been notified."
 *   - link    → "Jordan will get your notes."
 *
 * Pure presentational. No data fetching, no app state — the parent owns the submitted
 * flag and reacts to onVerdict. Renders standalone with sensible mock defaults.
 *
 * Props:
 *   onVerdict    function   — called with 'changes' | 'approved' when a button is pressed.
 *   submitted    'changes' | 'approved' | null — when set, shows the confirmation card.
 *   context      'in-app' | 'link' — selects density + confirmation copy. Default 'in-app'.
 *   ownerName    string     — owner referenced in the confirmation. Default 'Jordan'.
 *   instruction  string     — helper line above the buttons (link context shows it by
 *                             default). Pass '' to hide.
 */

import React from 'react';

const SUCCESS = 'var(--success, #4ade80)';
const DANGER = 'var(--danger, #F87171)';

function CheckIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={SUCCESS} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5 10 17.5 19.5 7" />
    </svg>
  );
}

export function VerdictBar({
  onVerdict,
  submitted = null,
  context = 'in-app',
  ownerName = 'Jordan',
  instruction,
} = {}) {
  const isLink = context === 'link';

  // Confirmation copy: notified now (in-app, live session) vs. queued notes (async link).
  const confirmDetail = isLink ? `${ownerName} will get your notes.` : `${ownerName} has been notified.`;

  if (submitted) {
    const verdictLabel = submitted === 'approved' ? 'Approved' : 'Changes requested';
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isLink ? 10 : 9,
          background: 'var(--diff-add, rgba(74,222,128,.16))',
          border: '1px solid rgba(74,222,128,.3)',
          borderRadius: isLink ? 11 : 10,
          padding: isLink ? 13 : '11px 12px',
          animation: 'popIn .25s ease',
        }}
      >
        <CheckIcon size={isLink ? 20 : 18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isLink ? 13 : 12.5, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display, inherit)' }}>
            {verdictLabel}
          </div>
          <div style={{ fontSize: isLink ? 11.5 : 11, color: 'var(--ink-3)' }}>{confirmDetail}</div>
        </div>
      </div>
    );
  }

  // Default the helper line on for the standalone link page; off for the in-app rail.
  const helper = instruction ?? (isLink ? "Submit one verdict when you're done." : '');

  const btnHeight = isLink ? 40 : 36;
  const btnRadius = isLink ? 10 : 9;
  const btnFont = isLink ? 13 : 12.5;

  return (
    <div>
      {helper ? (
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 10, textAlign: 'center' }}>{helper}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onVerdict?.('changes')}
          style={{
            flex: 1,
            height: btnHeight,
            borderRadius: btnRadius,
            border: `1px solid ${DANGER}`,
            background: 'transparent',
            color: DANGER,
            fontSize: btnFont,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Request changes
        </button>
        <button
          type="button"
          onClick={() => onVerdict?.('approved')}
          style={{
            flex: 1,
            height: btnHeight,
            borderRadius: btnRadius,
            border: 'none',
            background: SUCCESS,
            color: '#04150a',
            fontSize: btnFont,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

export default VerdictBar;
