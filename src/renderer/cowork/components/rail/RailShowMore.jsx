// "+ N more" / "Show less" under a capped rail list. Rail sections don't
// scroll inside themselves (the rail scrolls as a whole), so a long list is
// shortened here instead.
//
// `hiddenCount` is how many rows the collapsed list leaves out; with none,
// there is nothing to show or collapse, and the control draws nothing.

export function RailShowMore({ hiddenCount, expanded, onToggle }) {
  if (hiddenCount <= 0) return null;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="ml-1 mt-1 self-start text-xs text-ink-3 hover:text-ink underline-offset-2 hover:underline cursor-pointer bg-transparent border-0 p-0"
    >
      {expanded ? 'Show less' : `+ ${hiddenCount} more`}
    </button>
  );
}
