import { Fragment } from 'react';
import { Crumb, CrumbSep, CrumbCurrent } from '../ui/Crumb';
import { AppHeader } from '../appHeader';

// The one page-header for every main view. Two shapes so depth and placement
// read the same everywhere:
//
//   • title    top-level collection pages (Projects, Live Artifacts, Connect
//              Apps and Data, Scheduled, Tasks, Skills) — a display-font title,
//              optional eyebrow + subtitle, and a right-aligned `actions` slot.
//   • trail    drill-down surfaces (a schedule, a project, a skill) — pass
//              `crumbs` and/or `current`, or `onBack` for a "← label" link.
//
// The trail shape renders into the app titlebar (<AppHeader>), so drill-down
// crumbs sit in the same fixed row on every surface. The title shape stays in
// the body: a large display title under an empty titlebar row.
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
      <AppHeader>
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
      </AppHeader>
    );
  }

  return (
    <div className="flex flex-col gap-[18px] pr-8 pb-5 pl-8 pt-7">
      {/* Wraps the actions below the title once the title column would drop
          under 18rem, so narrow windows stack instead of crushing the title. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 min-w-0">
        <div className="min-w-0 flex-[1_1_18rem] flex flex-col gap-1">
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
        {actions && <div className="shrink-0 max-w-full">{actions}</div>}
      </div>
    </div>
  );
}
