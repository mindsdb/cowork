// Standard filter / toolbar row for collection screens. Lays out:
//
//   [search] [sort] ……spacer…… [right] [view]
//   [counts]
//
// Each slot accepts a ReactNode. The rule for what goes in them:
// search = <SearchInput>, sort and filters = <SortPill> / <Select
// variant="pill">, view = <ToggleGroup>.
//
// `counts` is also a ReactNode (not a string) so views can mix
// values + accents however they like — e.g. Projects highlights
// the pinned count with `var(--accent)`.

export function FilterRow({ search, sort, view, counts, right }) {
  return (
    <div className="flex flex-col gap-1.5 px-8">
      <div className="flex flex-wrap items-center gap-2.5">
        {search}
        {sort}
        <span className="flex-1" />
        {right}
        {view}
      </div>
      {counts && (
        <div className="font-mono text-[11px] tracking-[0.04em] text-ink-4">
          {counts}
        </div>
      )}
    </div>
  );
}
