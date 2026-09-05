// Constrain scrolling within the card so long content cannot push the rail off-screen.

import { useState } from 'react';
import Ico from '../Icons';

export function RailCard({
  title,
  defaultOpen = false,
  slim = false,
  maxBodyHeight = 320,
  // Disable collapsing for panels whose outer wrapper owns dismissal; keep the body visible.
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
