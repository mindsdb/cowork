// Time per section (ENG-4455): one row per section, in page order. The bar is
// the average time spent on it, scaled to the longest; the figure on the
// right is the share of visits that reached it, so the drop-off reads down
// the column. Plain HTML, so it follows the theme tokens in light and dark,
// and every row carries its numbers as text for screen readers.
//
// Used for the whole page (`avg_seconds` + `reach`) and for one visit
// (`seconds`, no reach).

import { Tooltip } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';
import { formatDuration, formatPercent } from './formatStats';

function sectionSeconds(section) {
  const value = Number(section.avg_seconds ?? section.seconds);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function SectionsChart({ sections = [], showReach = true, label }) {
  const { t } = useTranslation('artifacts');
  const rows = [...sections].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const longest = Math.max(0, ...rows.map(sectionSeconds));
  const reachShown = showReach && rows.some((row) => typeof row.reach === 'number');
  return (
    <div className="flex flex-col gap-[6px]">
      {reachShown && (
        <div className="flex justify-between text-[11px] leading-[14px] text-ink-4" aria-hidden="true">
          <span>{t('stats.sections.avgTime')}</span>
          <span>{t('stats.sections.reached')}</span>
        </div>
      )}
      <ol aria-label={label || t('stats.sections.title')} className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row, i) => {
          const seconds = sectionSeconds(row);
          const name = row.label || t('stats.sections.untitled', { number: (row.index ?? i) + 1 });
          const time = formatDuration(seconds);
          const reach = reachShown && typeof row.reach === 'number' ? formatPercent(row.reach) : '';
          const summary = reach
            ? t('stats.sections.rowWithReach', { name, time, reach })
            : t('stats.sections.row', { name, time });
          const width = longest > 0 ? Math.max(2, (seconds / longest) * 100) : 0;
          return (
            <li key={row.key || `${row.index}-${i}`} aria-label={summary} className="flex flex-col gap-1">
              <Tooltip content={summary}>
                <div className="flex min-w-0 items-baseline gap-2" aria-hidden="true">
                  <span className="min-w-0 flex-1 truncate text-[12px] leading-[16px] text-ink-2">{name}</span>
                  <span className="shrink-0 text-[12px] font-medium leading-[16px] tabular-nums text-ink">{time}</span>
                  {reachShown && (
                    <span className="w-[36px] shrink-0 text-right text-[11px] leading-[16px] tabular-nums text-ink-3">
                      {reach || '—'}
                    </span>
                  )}
                </div>
              </Tooltip>
              <div className="h-[6px] w-full overflow-hidden rounded-[4px] bg-surface-2" aria-hidden="true">
                <div
                  data-testid="section-bar"
                  className="h-full rounded-[4px] bg-accent"
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default SectionsChart;
