// Bubble container used by every right-rail section in chat and
// project views. The same surface, border, radius, and header treatment
// across both views so they read as one design family.
//
// Two visual variants:
//   default — bubble with a divider between header and body.
//   slim    — bubble keeps surface + border + radius, but drops the
//             divider so the header reads as one continuous line above
//             the body (used for Context per spec).
//
// Body always has maxBodyHeight + overflow-y: auto so a long card
// scrolls inside itself rather than pushing the rail off-screen.

import { useState } from 'react';
import Ico from '../Icons';

export function RailCard({
  title,
  defaultOpen = false,
  slim = false,
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
    <div className="bg-surface border border-solid border-line rounded-card overflow-hidden shrink-0">
      {noChevron ? (
        <div className="py-[11px] px-[14px] w-full flex items-center text-left">
          <span className="font-body text-[13px] font-semibold text-ink tracking-[0] min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {title}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="cursor-pointer bg-transparent border-0 py-[11px] px-[14px] w-full flex items-center justify-between text-left [font:inherit] text-inherit"
        >
          <span className="font-body text-[13px] font-semibold text-ink tracking-[0] min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
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
          className="pt-1 px-[14px] pb-[14px] overflow-y-auto"
          style={{
            // slim drops the divider so the header reads as one
            // continuous line above the body (Context per spec).
            borderTop: slim ? 'none' : '1px solid var(--line)',
            maxHeight: maxBodyHeight,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
