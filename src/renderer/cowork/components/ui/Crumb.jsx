export function Crumb({ label, onClick, title, maxWidth }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      style={{
        cursor: 'pointer', background: 'transparent', border: 0,
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
        letterSpacing: '0', color: 'var(--ink-3)',
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

// The trailing "you are here" crumb — the current page. Renders as a
// sibling of Crumb: SAME size (13) and tracking (0) as the link, so the
// row reads as one unit; the only differences are colour (ink, not ink-3)
// and that it isn't a button. Keeping this in one component stops the
// per-view copies from drifting into different sizes/tracking, which is
// exactly what had happened (14px + 0.04em here, 13px + 0 on the link).
export function CrumbCurrent({ label, title, maxWidth, style }) {
  return (
    <span
      title={title || label}
      style={{
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
        letterSpacing: '0', color: 'var(--ink)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        minWidth: 0, maxWidth, padding: '2px 6px',
        ...style,
      }}
    >{label}</span>
  );
}
