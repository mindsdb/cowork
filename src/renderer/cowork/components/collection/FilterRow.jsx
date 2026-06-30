// Standard filter / toolbar row for collection screens. Lays out:
//
//   [search] [sort] ……spacer…… [right] [view]
//   [counts]
//
// Each slot accepts a ReactNode so views can drop in customised
// pieces without re-implementing the spacing rhythm. The kit's
// own `<SearchInput>`, `<SortPill>` plug in directly, but a 
// view can pass any node it wants.
//
// `counts` is also a ReactNode (not a string) so views can mix
// values + accents however they like — e.g. Projects highlights
// the pinned count with `var(--accent)`, Artifacts highlights
// the published count, Scheduled would highlight catch-up.

const FONT_MONO = 'var(--font-mono)';

export function FilterRow({ search, sort, view, counts, right }) {
  return (
    <div style={{
      padding: '0 32px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        {search}
        {sort}
        <span style={{ flex: 1 }} />
        {right}
        {view}
      </div>
      {counts && (
        <div style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
        }}>
          {counts}
        </div>
      )}
    </div>
  );
}
