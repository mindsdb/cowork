import { Fragment } from 'react';
import { Crumb, CrumbSep, CrumbCurrent } from '../ui/Crumb';

// The one page-header for every main view. It has two shapes so depth
// and placement read the same everywhere:
//
//   • title    — top-level collection pages (Projects, Live Artifacts,
//                Connect Apps and Data, Scheduled, Tasks, Skills). A
//                display-font title, optional eyebrow + subtitle, and a
//                right-aligned `actions` slot on the title baseline.
//   • trail    — drill-down surfaces (a schedule, a project, a skill).
//                Pass `crumbs` (link array) and/or `current` (the "you
//                are here" leaf), or `onBack` for a "← label" link. A
//                compact bar with the same 13px Crumb typography the
//                chat header uses.
//
// Both shapes own the titlebar-safe inset: paddingLeft honours
// --titlebar-safe-left (set on <main> by the shell) so the header clears
// the macOS traffic lights + the floating open-sidebar button whenever
// the sidebar isn't docked over that corner, and max() falls back to the
// normal padding otherwise. No view hard-codes a clearance value.
//
// Views should NOT add their own spacer between the title shape and the
// FilterRow; the 20px is baked in so every page shares the same gap.
//
// API:
//   <PageHeader title="Projects" subtitle="…" eyebrow="DATABASES"
//               actions={<button…>+ New</button>} subtitleBottom={20} />
//   <PageHeader crumbs={[{ label: 'Scheduled Tasks', onClick: onBack }]}
//               current="Daily digest" />

const FONT_BODY = 'var(--font-body)';
const FONT_MONO = 'var(--font-mono)';

// Left inset shared by both shapes. Their base horizontal padding
// differs (title 32, trail 28), so each passes its own base into max().
const safeLeft = (base) => `max(${base}px, var(--titlebar-safe-left, 0px))`;

export function PageHeader({
  // title shape
  title, subtitle, eyebrow, subtitleBottom,
  // trail shape
  crumbs, current, onBack, backLabel = 'Back', bordered = true,
  // both
  actions,
}) {
  const isTrail = (crumbs && crumbs.length > 0) || onBack || current != null;

  if (isTrail) {
    const leadingSep = onBack || (crumbs && crumbs.length > 0);
    return (
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexShrink: 0, minWidth: 0,
        paddingTop: 14, paddingBottom: 14, paddingRight: 28,
        paddingLeft: safeLeft(28),
        borderBottom: bordered ? '1px solid var(--line)' : 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          minWidth: 0, flex: '1 1 0', overflow: 'hidden',
        }}>
          {onBack && (
            <Crumb label={`← ${backLabel}`} onClick={onBack} title={backLabel} />
          )}
          {(crumbs || []).map((c, i) => (
            <Fragment key={c.key ?? i}>
              {(i > 0 || onBack) && <CrumbSep />}
              <Crumb label={c.label} onClick={c.onClick} title={c.title} maxWidth={c.maxWidth} />
            </Fragment>
          ))}
          {current != null && (
            <>
              {leadingSep && <CrumbSep />}
              <CrumbCurrent label={current} maxWidth={360} />
            </>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </header>
    );
  }

  return (
    <div style={{
      paddingTop: 28, paddingRight: 32, paddingBottom: 20,
      paddingLeft: safeLeft(32),
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
