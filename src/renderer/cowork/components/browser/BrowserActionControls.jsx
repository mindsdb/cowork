// Live Browser Control action controls, shown in the streaming turn while a
// browser action is in flight. Two pills:
//   • Stop      (danger)  → onStop         — halts the turn; the server sets a
//                                            pre-dispatch gate so no further
//                                            browser action is issued (<1s).
//   • Take over (neutral) → onBrowserTakeOver — hands the approved Chrome tab
//                                            back to the user and stops the turn.
// The active-domain label reassures the user which site is being read. Both
// pills are real <button>s with aria-labels so the controls are keyboard- and
// screen-reader-navigable. See /code/.plans/designs/browser-control-progress-*.html.

import Ico from '../Icons';

const FONT_BODY = 'var(--font-body)';

function Pill({ kind, renderIcon, label, onClick, ariaLabel }) {
  const isDanger = kind === 'danger';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel || label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 12px', borderRadius: 999,
        background: isDanger
          ? 'color-mix(in srgb, var(--danger) 8%, transparent)'
          : 'transparent',
        border: isDanger
          ? '1px solid color-mix(in srgb, var(--danger) 32%, transparent)'
          : '1px solid var(--line)',
        color: isDanger ? 'var(--danger)' : 'var(--ink-2)',
        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        {typeof renderIcon === 'function' ? renderIcon(13) : null}
      </span>
      {label}
    </button>
  );
}

export default function BrowserActionControls({ domain, onStop, onBrowserTakeOver }) {
  return (
    <div
      role="group"
      aria-label="Browser action controls"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 0 2px',
      }}
    >
      <span
        aria-live="polite"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>{Ico.globe(13)}</span>
        {domain ? `Browsing ${domain}` : 'Browsing the approved tab'}
      </span>
      <span style={{ flex: 1 }} />
      <Pill
        kind="danger"
        renderIcon={Ico.stop}
        label="Stop"
        ariaLabel="Stop the browser action"
        onClick={onStop}
      />
      <Pill
        kind="neutral"
        renderIcon={Ico.power}
        label="Take over"
        ariaLabel="Take over the browser tab"
        onClick={onBrowserTakeOver}
      />
    </div>
  );
}
