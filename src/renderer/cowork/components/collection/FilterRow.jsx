// Standard filter / toolbar row for collection screens. Lays out:
//
//   [search] [filter] [sort] ……spacer…… [right] [view]
//   [chips]
//   (32px)
//   [counts]   ← caption for the list below
//   (8px)
//
// Each slot accepts a ReactNode. The rule for what goes in them:
// search = <SearchInput>, filter = <FilterMenu> with its <FilterChips> in
// chips, sort = <SortMenu> in right, view = <ViewToggle>. (Pages not yet on
// FilterMenu still put <SortPill> / <Select variant="pill"> in sort.)
//
// The row owns the space down to the page body, so bodies start flush
// below it and every page has the same gap. `counts` sits at the bottom
// of that gap as the list's caption, not under the controls. It is a
// ReactNode so views can mix values and accents (Projects highlights the
// pinned count with `var(--accent)`).

export function FilterRow({ search, filter, sort, view, counts, right, chips }) {
  return (
    <div className="flex flex-col px-8 pb-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {search}
        {filter}
        {sort}
        <span className="flex-1" />
        {right}
        {view}
      </div>
      {chips && <div className="mt-2.5">{chips}</div>}
      {counts ? (
        <div className="mt-8 font-body text-xs text-ink-4">{counts}</div>
      ) : (
        <div className="h-6" aria-hidden="true" />
      )}
    </div>
  );
}
