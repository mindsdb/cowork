export function Crumb({ label, onClick, title, maxWidth }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      style={{
        cursor: 'pointer', background: 'transparent', border: 0,
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
        letterSpacing: '0.04em', color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth, flexShrink: 1,
        padding: '2px 6px', borderRadius: 5,
        transition: 'color 120ms ease, background 120ms ease',
        WebkitAppRegion: 'no-drag',
      }}
      onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
    >{label}</button>
  );
}

export function CrumbSep() {
  return (
    <span aria-hidden="true" style={{
      color: 'var(--ink-4)', fontFamily: 'var(--font-display)',
      fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
      userSelect: 'none',
    }}>›</span>
  );
}
