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
