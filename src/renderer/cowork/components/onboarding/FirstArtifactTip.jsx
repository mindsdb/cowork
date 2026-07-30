import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';

// One-shot callout anchored to the Live Artifacts nav badge, shown the
// moment the user's FIRST artifact lands (App owns the arm/trigger
// logic; this is just the surface). Built on Base UI Popover so we get
// portal, collision-aware positioning, and dismiss handling for free.
//
// Dismiss paths — all permanent (App writes the localStorage flag):
//   • "Got it"
//   • "Show me" (also opens the Artifacts view)
//   • clicking the Live Artifacts nav item itself (wired in Sidebar)
//   • Escape / clicking anywhere else

function TipButton({ label, primary, onClick }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        font: 'inherit', fontSize: 12, fontWeight: 600,
        padding: '6px 12px', borderRadius: 7, border: 0, cursor: 'pointer',
        background: primary ? 'var(--surface)' : 'color-mix(in srgb, var(--surface) 16%, transparent)',
        color: primary ? 'var(--ink)' : 'var(--surface)',
        opacity: hover ? 0.9 : 1,
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition: 'opacity 140ms ease, transform 140ms ease-out',
      }}
    >
      {label}
    </button>
  );
}

export default function FirstArtifactTip({ open, anchorRef, onGotIt, onShowMe }) {
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => { if (!next) onGotIt(); }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchorRef}
          side="right"
          align="center"
          sideOffset={14}
          style={{ zIndex: 2000 }}
        >
          <Popover.Popup
            // Don't steal focus from wherever the user is working — this
            // shows up on its own, not from a click.
            initialFocus={false}
            finalFocus={false}
            className="first-artifact-tip"
            style={{
              background: 'var(--ink)',
              color: 'var(--surface)',
              fontFamily: 'var(--font-body)',
              borderRadius: 12,
              padding: '12px 14px',
              maxWidth: 300,
              boxShadow: 'var(--sh-popup, var(--sh-2))',
            }}
          >
            {/* Rotated-square arrow; per-side offsets live in globals.css
                (`.first-artifact-tip-arrow`) keyed off data-side. */}
            <Popover.Arrow className="first-artifact-tip-arrow" />
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Your first Live Artifact is ready. It lives here. Open it anytime, or publish it to share a live URL.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <TipButton label="Got it" onClick={onGotIt} />
              <TipButton label="Show me" primary onClick={onShowMe} />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
