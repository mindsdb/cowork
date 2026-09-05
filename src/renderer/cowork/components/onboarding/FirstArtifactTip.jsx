import { Popover } from '@base-ui/react/popover';
import { Button } from '../ui';

// App owns arming and permanent dismissal; every dismissal path must persist the flag.

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
            aria-label="Your first Live Artifact"
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
            <Popover.Arrow className="first-artifact-tip-arrow" />
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Your first Live Artifact is ready. It lives here. Open it anytime, or publish it to share a live URL.
            </div>
            {/* Reskin buttons for the inverted surface via .first-artifact-tip .btn. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <Button size="sm" onClick={onGotIt}>Got it</Button>
              <Button size="sm" variant="primary" onClick={onShowMe}>Show me</Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
