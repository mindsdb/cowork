// The single "moving part" for an in-flight turn: an orb anchor box +
// a shimmering status label. Used by ThinkingBlock's active header and
// by ChatView's pre-step "Thinking…" placeholders, so the chat only
// ever shows ONE in-progress indicator at a time.
//
// `slotId` registers the box with the OrbitProvider so the floating
// OrbitMorph centers over it. Without a slotId (no orb in flight, e.g.
// the pre-stream activity placeholder) a small pulsing dot stands in
// as the moving part instead of an empty gap.

import { useOrbitSlot } from '../../lib/orbitRegistry';

// The orb anchors to the CENTRE of this box (the OrbitProvider positions
// the morph over the slot's bounding-box centre, independent of the box's
// own size). Sized 16×16 to match a ThinkingStep's icon gutter (`w-4`, a
// 16px column with the icon centred at 8px) so the orb lines up in the
// same vertical column as the step icons below it, and the status label
// starts at the same x as the step labels — the orb reads as the live
// head of the same timeline. The rendered orb is larger than this anchor
// and simply overflows it symmetrically, still centred on 8px.
const ORB_BOX = 16;

export function WorkingIndicator({ slotId, label }) {
  const slotRef = useOrbitSlot(slotId ?? '__working_indicator_inert__');
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {slotId ? (
        <span
          ref={slotRef}
          aria-hidden
          className="inline-flex flex-none"
          style={{ width: ORB_BOX, height: ORB_BOX }}
        />
      ) : (
        <span
          aria-hidden
          className="pulse-dot inline-flex flex-none rounded-full"
          style={{ width: 6, height: 6, background: 'var(--accent)', margin: 8 }}
        />
      )}
      {/* Same size as the answer body (14.5px) so the status reads as
          part of the message, not as fine print. */}
      <span className="thinking-shimmer min-w-0 truncate text-[14.5px]">{label}</span>
    </span>
  );
}
