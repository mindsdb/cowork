// slotId anchors OrbitProvider's floating indicator; without an active slot, render a pulsing-dot
// fallback.

import { useOrbitSlot } from '../../lib/orbitRegistry';

// Match the 16px step gutter so the orb and labels align with the timeline; the larger orb
// overflows its centered anchor.
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
      <span className="thinking-shimmer min-w-0 truncate text-[14.5px]">{label}</span>
    </span>
  );
}
