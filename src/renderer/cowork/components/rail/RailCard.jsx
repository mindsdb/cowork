// Section used by every right-rail block in chat and project views. The
// rail itself is the one card, so sections are borderless: a label in the
// sidebar's group-heading style over the body, separated by the rail's gap.
// No box sits inside the rail's box.
//
// Body always has maxBodyHeight + overflow-y: auto so a long card
// scrolls inside itself rather than pushing the rail off-screen.

import { useState } from 'react';
import Ico from '../Icons';

export function RailCard({
  title,
  defaultOpen = false,
  maxBodyHeight = 320,
  // When true, the header is a plain (non-clickable) label and the
  // chevron disclosure widget is dropped. The body is always shown
  // (defaultOpen is implicitly true). Used by the data-vault Connect
  // panel where the only dismissal affordance should be the × in the
  // outer wrapper, not a separate collapse control.
  noChevron = false,
  children,
}) {
  const [open, setOpen] = useState(!!defaultOpen || noChevron);
  return (
    <div className="shrink-0 min-w-0">
      {noChevron ? (
        <div className="pb-2 w-full flex items-center text-left">
          <span className="font-sans text-[13px] font-semibold text-ink-3 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {title}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="cursor-pointer bg-transparent border-0 p-0 pb-2 w-full flex items-center justify-between text-left [font:inherit] text-inherit"
        >
          <span className="font-sans text-[13px] font-semibold text-ink-3 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {title}
          </span>
          <span
            className="text-ink-4 inline-flex shrink-0"
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? Ico.chevDown(12) : Ico.chevRight(12)}
          </span>
        </button>
      )}
      {open && (
        <div
          className="overflow-y-auto"
          style={{ maxHeight: maxBodyHeight }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
