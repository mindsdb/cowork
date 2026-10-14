// Section used by every right-rail block in chat and project views. The
// rail itself is the one card, so sections are borderless: a label in the
// sidebar's group-heading style over the body, with a hairline between
// neighbouring sections. No box sits inside the rail's box. The label is inset px-1 like the rows
// below it, so its text starts where their icons do (as in the sidebar).
//
// Body always has maxBodyHeight + overflow-y: auto so a long card
// scrolls inside itself rather than pushing the rail off-screen.

import { Collapsible } from '../ui/Collapsible';

const TITLE_CLASS = 'font-sans text-[13px] font-semibold text-ink-3 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap';

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
  // The body keeps its own cap and scroller inside the panel, so a long
  // section scrolls rather than pushing the rail off-screen.
  const body = <div className="overflow-y-auto" style={{ maxHeight: maxBodyHeight }}>{children}</div>;
  if (noChevron) {
    return (
      <div className="rail-section shrink-0 min-w-0">
        <div className="px-1 pb-2 w-full flex items-center text-left">
          <span className={TITLE_CLASS}>{title}</span>
        </div>
        {body}
      </div>
    );
  }
  // The shared disclosure: the chevron turns and the body's height eases
  // open and closed.
  return (
    <Collapsible
      title={<span className={`block ${TITLE_CLASS}`}>{title}</span>}
      defaultOpen={!!defaultOpen}
      chevron="right"
      // Sections fetch their own lists; staying mounted while closed means
      // reopening shows them at once instead of refetching.
      keepMounted
      className="rail-section shrink-0 min-w-0"
      // The heading-to-body space opens with the body, so a closed section
      // sits evenly between the rules around it.
      triggerClassName="min-h-0 p-0 px-1 rounded-none"
      panelClassName="pt-2"
    >
      {body}
    </Collapsible>
  );
}
