// Time per page (ENG-4455): one vertical bar per section of the artifact, in
// page order, like DocSend's page-by-page chart. The x-axis is the section
// number and the y-axis a clock (mm:ss). Plain HTML on the theme tokens, so it
// follows light and dark with no chart library.
//
// Every bar is a button. Hovering or focusing one shows a card with its
// position ("Page 13 / 22"), its heading and its time; the same text is the
// bar's accessible name. The bars are one tab stop: the arrow keys, Home and
// End move between them.
//
// `mode="avg"`  — the whole audience: average seconds and reach per section.
// `mode="spent"` — one viewer (all their visits summed, or one visit).

import { useId, useRef, useState } from 'react';
import { useTranslation } from '../../../../lib/i18n';
import { formatClock, formatDuration, formatPercent } from './formatStats';

const PLOT_HEIGHT = 96;
// Steps a y-axis may use, in seconds: from a tenth of a second to two hours.
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200];
const TICKS = 3;

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The y-axis: 0 to the first step multiple at or above the longest bar.
export function axisTicks(longest) {
  if (!(longest > 0)) return { top: 1, ticks: [0, 1], fraction: false };
  const step = STEPS.find((s) => s * TICKS >= longest) || Math.ceil(longest / TICKS / 3600) * 3600;
  const top = Math.round(Math.max(step, Math.ceil(longest / step - 1e-9) * step) * 10) / 10;
  const ticks = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Math.round(value * 10) / 10);
  return { top, ticks, fraction: step < 1 };
}

export function PageBars({ bars = [], mode = 'spent', label }) {
  const { t } = useTranslation('artifacts');
  const [active, setActive] = useState(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttons = useRef([]);
  const tooltipId = useId();
  const total = bars.length;
  if (!total) return null;

  const seconds = bars.map((bar) => positive(bar.seconds));
  const { top, ticks, fraction } = axisTicks(Math.max(0, ...seconds));
  // Every k-th number on the x-axis, so a long page does not crowd it.
  const every = Math.max(1, Math.ceil(total / 8));
  const showReach = mode === 'avg' && bars.some((bar) => typeof bar.reach === 'number');

  const describe = (bar, i) => {
    const number = i + 1;
    const name = bar.label || t('stats.pages.untitled', { number });
    const time = formatDuration(seconds[i]);
    if (mode !== 'avg') return t('stats.pages.barSpent', { number, total, name, time });
    return typeof bar.reach === 'number'
      ? t('stats.pages.barAvgReach', { number, total, name, time, reach: formatPercent(bar.reach) })
      : t('stats.pages.barAvg', { number, total, name, time });
  };

  const moveTo = (i) => {
    const next = Math.min(total - 1, Math.max(0, i));
    setFocusIndex(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (event, i) => {
    const target = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: total - 1 }[event.key];
    if (target == null) return;
    event.preventDefault();
    moveTo(target);
  };

  const shown = active != null && active < total ? active : null;
  const centre = shown != null ? ((shown + 0.5) / total) * 100 : 0;
  // The card sits over its bar, kept inside the plot at either end.
  const cardPlacement = centre < 30
    ? { left: `${(shown / total) * 100}%` }
    : centre > 70
      ? { right: `${((total - shown - 1) / total) * 100}%` }
      : { left: `${centre}%`, transform: 'translateX(-50%)' };

  return (
    <div className="flex min-w-0 gap-[6px]">
      <div
        aria-hidden="true"
        className="relative w-[34px] shrink-0 text-right text-[10px] leading-[12px] tabular-nums text-ink-4"
        style={{ height: PLOT_HEIGHT }}
      >
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 translate-y-1/2 whitespace-nowrap"
            style={{ bottom: `${(tick / top) * 100}%` }}
          >
            {formatClock(tick, { fraction })}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden="true"
              className="absolute inset-x-0 h-px bg-line"
              style={{ bottom: `${(tick / top) * 100}%` }}
            />
          ))}
          <div
            role="group"
            aria-label={label || t('stats.pages.title')}
            className="absolute inset-0 flex items-end"
            style={{ gap: total > 24 ? 1 : 3 }}
            onMouseLeave={() => setActive(null)}
          >
            {bars.map((bar, i) => {
              const height = top > 0 ? (seconds[i] / top) * 100 : 0;
              const dim = shown != null && shown !== i;
              return (
                <button
                  key={bar.key || i}
                  ref={(node) => { buttons.current[i] = node; }}
                  type="button"
                  data-testid="page-bar"
                  aria-label={describe(bar, i)}
                  aria-describedby={shown === i ? tooltipId : undefined}
                  tabIndex={i === Math.min(focusIndex, total - 1) ? 0 : -1}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => { setActive(i); setFocusIndex(i); }}
                  onBlur={() => setActive(null)}
                  onKeyDown={(event) => onKeyDown(event, i)}
                  className="group relative flex h-full min-w-[2px] flex-1 cursor-default items-end
                    border-0 bg-transparent p-0 outline-none"
                  style={{ maxWidth: 18 }}
                >
                  <span
                    className={`block w-full rounded-t-[3px] bg-accent transition-[height,opacity]
                      duration-200 motion-reduce:transition-none group-focus-visible:ring-2
                      group-focus-visible:ring-accent group-focus-visible:ring-offset-1
                      group-focus-visible:ring-offset-surface ${dim ? 'opacity-40' : ''}`}
                    style={{ height: `${height}%`, minHeight: seconds[i] > 0 ? 2 : 0 }}
                  />
                </button>
              );
            })}
          </div>
          {shown != null && (
            <div
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-[6px] flex w-max max-w-[200px]
                flex-col gap-[2px] rounded-[8px] border border-line bg-surface px-[10px] py-2 shadow-[var(--sh-2)]"
              style={cardPlacement}
            >
              <span className="text-[11px] leading-[14px] tabular-nums text-ink-3">
                {t('stats.pages.position', { number: shown + 1, total })}
              </span>
              {bars[shown].label && (
                <span className="line-clamp-2 text-[12px] font-semibold leading-[16px] text-ink">
                  {bars[shown].label}
                </span>
              )}
              <span className="flex items-baseline justify-between gap-3 text-[11px] leading-[14px] text-ink-3">
                {mode === 'avg' ? t('stats.pages.avgTime') : t('stats.pages.timeSpent')}
                <span className="font-medium tabular-nums text-ink">
                  {formatClock(seconds[shown], { fraction: true })}
                </span>
              </span>
              {showReach && typeof bars[shown].reach === 'number' && (
                <span className="flex items-baseline justify-between gap-3 text-[11px] leading-[14px] text-ink-3">
                  {t('stats.pages.reached')}
                  <span className="font-medium tabular-nums text-ink">{formatPercent(bars[shown].reach)}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <div aria-hidden="true" className="flex text-[10px] leading-[12px] tabular-nums text-ink-4" style={{ gap: total > 24 ? 1 : 3 }}>
          {bars.map((bar, i) => (
            <span key={bar.key || i} className="min-w-[2px] flex-1 overflow-visible whitespace-nowrap text-center" style={{ maxWidth: 18 }}>
              {i % every === 0 ? i + 1 : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Bars for the chart: the page's sections (`outline`, from the overview) in
// page order, each with the seconds summed over `sectionLists` (one list per
// visit). Sections a visit names that the outline lacks follow in index order.
export function sumSections(outline = [], sectionLists = []) {
  const keyOf = (section) => section.key ?? `#${section.index}`;
  const order = [...outline].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const rows = new Map(order.map((section) => [keyOf(section), { key: keyOf(section), index: section.index, label: section.label, seconds: 0 }]));
  const extra = [];
  sectionLists.forEach((list) => (Array.isArray(list) ? list : []).forEach((section) => {
    const key = keyOf(section);
    let row = rows.get(key);
    if (!row) {
      row = { key, index: section.index, label: section.label, seconds: 0 };
      rows.set(key, row);
      extra.push(row);
    }
    if (!row.label && section.label) row.label = section.label;
    row.seconds += positive(section.seconds);
  }));
  extra.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return [...order.map((section) => rows.get(keyOf(section))), ...extra];
}

export default PageBars;
