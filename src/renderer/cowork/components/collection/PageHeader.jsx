// Standard page-header for collection-style screens (Projects, Live
// Artifacts, Connect Apps and Data, Scheduled tasks). Keeps title +
// subtitle + primary action on the same vertical rhythm everywhere
// (28px top → display-font title → 4px gap → muted subtitle → 20px
// bottom before whatever follows — usually the FilterRow — with the
// action floated to the title baseline on the right). Views should
// NOT add their own spacer between this and the FilterRow; the 20px
// is baked in so every page shares the same gap.
//
// Each consumer brings its own button via `actions` so the visual
// language stays open-ended: anything React-renderable can sit in
// the slot. The default styling for "+ <verb>" buttons is the
// existing global `.btn-primary` class — keep using that for parity.
//
// API:
//   <PageHeader
//     title="Projects"
//     subtitle="Workspaces Anton uses to group conversations…"
//     eyebrow="DATABASES"          // optional uppercase mono label above title
//     actions={<button…>+ New</button>}
//     subtitleBottom={20}          // optional extra space below the subtitle (px)
//   />

const FONT_BODY    = 'var(--font-body)';
const FONT_MONO    = 'var(--font-mono)';

export function PageHeader({ title, subtitle, eyebrow, actions, subtitleBottom }) {
  return (
    <div style={{
      padding: '28px 32px 20px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 24, minWidth: 0,
      }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {eyebrow && (
            <div style={{
              fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
              marginBottom: 2,
            }}>{eyebrow}</div>
          )}
          <h1 className="s-h1" style={{
            margin: 0,
            color: 'var(--ink)',
          }}>{title}</h1>
          {subtitle && (
            <p style={{
              margin: 0,
              // `subtitleBottom` lets a consumer carve out extra
              // breathing room below the subtitle without touching
              // the spacer placement around the FilterRow.
              marginBottom: subtitleBottom || 0,
              fontFamily: FONT_BODY, fontSize: 13.5,
              color: 'var(--ink-3)', lineHeight: 1.5,
              maxWidth: '64ch',
            }}>{subtitle}</p>
          )}
        </div>
        {actions}
      </div>
    </div>
  );
}
