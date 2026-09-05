import { Fragment } from 'react';
import { cn } from '../../lib/cn';
import { Crumb, CrumbSep, CrumbCurrent } from '../ui/Crumb';

// title is for collections; trail uses crumbs/current or onBack for drill-down views.
// Reserve --titlebar-safe-top vertically so traffic lights clear the header without misaligning it
// with the body.
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
