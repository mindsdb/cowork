import { Fragment } from 'react';
import { cn } from '../../lib/cn';
import { Crumb, CrumbSep, CrumbCurrent } from '../ui/Crumb';

// The one page-header for every main view. Two shapes so depth and placement
// read the same everywhere:
//
//   • title    top-level collection pages (Projects, Live Artifacts, Connect
//              Apps and Data, Scheduled, Tasks, Skills) — a display-font title,
//              optional eyebrow + subtitle, and a right-aligned `actions` slot.
//   • trail    drill-down surfaces (a schedule, a project, a skill) — pass
//              `crumbs` and/or `current`, or `onBack` for a "← label" link.
//
// Both shapes own the titlebar-safe inset: paddingTop honours
// --titlebar-safe-top (set on <main> by the shell) so the header drops below
// the macOS traffic lights + the floating open-sidebar button when the sidebar
// isn't docked over that corner, falling back to the normal padding via max().
// Reserving the space on top (rather than the left) keeps the title/crumb left-
// aligned with the body beneath it instead of pushing it into a lopsided gutter.
//
// Styling note: this is on the target stack (Tailwind utilities + `cn`, token
// colours from tailwind.config), not inline styles. Neither shape draws a
// divider — the header floats above the body. The one value that stays inline
// is `subtitleBottom`, a caller-supplied dynamic number. cva isn't used here —
// the two shapes are structural, not style-variants-on-one-element; cva stays
// for the ui/ primitives (Button, Badge, …) where it fits.
export function PageHeader({
  // title shape
  title, subtitle, eyebrow, subtitleBottom,
  // trail shape
  crumbs, current, onBack, backLabel = 'Back',
  // both
  actions,
}) {
  const isTrail = (crumbs && crumbs.length > 0) || onBack || current != null;

  if (isTrail) {
    const leadingSep = onBack || (crumbs && crumbs.length > 0);
    return (
      <header
        className={cn(
          'flex items-center justify-between gap-3 shrink-0 min-w-0',
          'pb-3.5 pr-7 pl-7 pt-[max(14px,var(--titlebar-safe-top,0px))]',
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
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
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </header>
    );
  }

  return (
    <div className="flex flex-col gap-[18px] pr-8 pb-5 pl-8 pt-[max(28px,var(--titlebar-safe-top,0px))]">
      <div className="flex items-start justify-between gap-6 min-w-0">
        <div className="min-w-0 flex flex-col gap-1">
          {eyebrow && (
            <div className="mb-0.5 font-[family-name:var(--font-mono)] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-4">
              {eyebrow}
            </div>
          )}
          <h1 className="s-h1 m-0 text-ink">{title}</h1>
          {subtitle && (
            <p
              className="m-0 max-w-[64ch] text-[13.5px] leading-[1.5] text-ink-3"
              style={{ marginBottom: subtitleBottom || 0 }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
