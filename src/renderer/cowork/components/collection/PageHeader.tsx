import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Crumb, CrumbSep, CrumbCurrent } from '../ui/Crumb';
import { AppHeader } from '../appHeader';
import { useTranslation } from '../../../lib/i18n';

// The one page-header for every main view. Two shapes so depth and placement
// read the same everywhere:
//
//   • title    top-level collection pages (Projects, Live Artifacts, Connect
//              Apps and Data, Scheduled, Tasks, Skills) — a display-font title,
//              an optional subtitle, and a right-aligned `actions` slot.
//   • trail    drill-down surfaces (a schedule, a project, a skill) — pass
//              `crumbs` and/or `current`, or `onBack` for a "← label" link.
//              Add `title` (and optionally `subtitle`) for a drill-down page
//              that names itself: the trail sits above the title, the trail
//              holds only the ancestors (the title is the current page), and
//              `actions` move beside the title.
//
// The trail renders into the app titlebar (<AppHeader>), so drill-down
// crumbs sit in the same fixed row on every surface. Titles stay in the body,
// close under the titlebar row at pane-title size (s-h2): with the titlebar
// above it, a 28px title and deep top padding read as a landing page rather
// than a work surface. A trail with a title puts its crumbs in the titlebar
// and its title, subtitle and actions in the body, like the title shape.
//
// The subtitle has no width cap of its own: it wraps at the edge of the text
// column (left of `actions`, or the full page without them), the same width
// as the body below it. A character cap left it stopping short of a line that
// isn't on screen (ENG-3998).
//
// Styling note: Tailwind utilities + `cn`, token colours from tailwind.config.
// Neither shape draws a divider — the header floats above the body. cva isn't
// used here — the two shapes are structural, not style-variants-on-one-element.

export interface PageHeaderCrumb {
  key?: string;
  label: string;
  onClick?: () => void;
  title?: string;
  maxWidth?: number;
}

export interface PageHeaderProps {
  // title shape
  title?: ReactNode;
  subtitle?: ReactNode;
  // trail shape
  crumbs?: PageHeaderCrumb[];
  current?: string;
  onBack?: () => void;
  backLabel?: string;
  // both
  actions?: ReactNode;
}

export function PageHeader({
  title, subtitle,
  crumbs, current, onBack, backLabel: backLabelProp,
  actions,
}: PageHeaderProps) {
  const { t } = useTranslation('library');
  const backLabel = backLabelProp ?? t('collection.back');
  const hasCrumbs = !!crumbs && crumbs.length > 0;
  const isTrail = hasCrumbs || !!onBack || current != null;

  if (isTrail) {
    const leadingSep = !!onBack || hasCrumbs;
    const trail = (
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
    );

    const crumbBar = (
      <AppHeader>
        <nav aria-label={t('collection.breadcrumb')} className="flex min-w-0 flex-1 overflow-hidden">{trail}</nav>
        {title == null && actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </AppHeader>
    );

    if (title != null) {
      return (
        <>
          {crumbBar}
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 shrink-0 min-w-0 px-8 pb-5 pt-3">
            <div className="min-w-0 flex-[1_1_18rem] flex flex-col gap-1">
              <h1 className="s-h2 m-0 text-ink [overflow-wrap:anywhere]">{title}</h1>
              {subtitle && (
                <div className="m-0 text-[13.5px] leading-[1.5] text-ink-3">{subtitle}</div>
              )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
          </header>
        </>
      );
    }

    return crumbBar;
  }

  return (
    <div className="flex flex-col gap-[18px] pr-8 pb-5 pl-8 pt-3">
      {/* Wraps the actions below the title once the title column would drop
          under 18rem, so narrow windows stack instead of crushing the title. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 min-w-0">
        <div className="min-w-0 flex-[1_1_18rem] flex flex-col gap-1">
          <h1 className="s-h2 m-0 text-ink">{title}</h1>
          {subtitle && (
            <p className="m-0 text-[13.5px] leading-[1.5] text-ink-3">{subtitle}</p>
          )}
        </div>
        {actions && <div className="shrink-0 max-w-full">{actions}</div>}
      </div>
    </div>
  );
}
