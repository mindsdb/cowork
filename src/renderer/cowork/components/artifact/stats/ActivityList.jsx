// All visits (ENG-4455), after DocSend's Activity view: one row per viewer
// with their total time and how much of the page they saw. A row unfolds in
// place (one at a time) into the viewer's device, OS and location and their
// time per page, summed over every visit or for one visit picked from a list.
// Without timing data (`timing` false) a row has no time, ring or page bars,
// only who, how often and when.
//
// The open row is the hook's `viewer` (`{ id, data, loading, error }`):
// opening a row loads that viewer's visits, closing it drops them.

import { useState } from 'react';
import Ico from '../../Icons';
import { Tooltip } from '../../ui';
import { relativeAge } from '../../../lib/formatTime';
import { tileStyle } from '../../../lib/letterTile';
import { useTranslation } from '../../../../lib/i18n';
import { PageBars, sumSections } from './PageBars';
import { StatsFailure, StatsSkeleton, describeStatsError } from './StatsStates';
import { exactTime, formatClock, formatDuration, formatPercent, shortDateTime } from './formatStats';

const NO_ROWS = [];
const DEVICES = new Set(['desktop', 'mobile', 'tablet']);

export function viewerName(viewer, t) {
  return viewer?.email || t('stats.viewers.anonymous');
}

// Two letters from the address before the @: "jane.doe@…" → "JD".
function initials(email) {
  const local = String(email || '').split('@')[0];
  const parts = local.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : parts[0][1] || '')).toUpperCase();
}

function Avatar({ viewer }) {
  if (!viewer.email) {
    return (
      <span aria-hidden="true" className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-3">
        {Ico.user(14)}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={tileStyle(viewer.id || viewer.email)}
    >
      {initials(viewer.email)}
    </span>
  );
}

// A small ring filled to the share of the page this viewer saw.
export function CompletionRing({ value, size = 18 }) {
  const { t } = useTranslation('artifacts');
  const share = Math.min(1, Math.max(0, Number(value) || 0));
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const text = t('stats.activity.viewed', { percent: formatPercent(share) });
  return (
    <Tooltip content={text}>
      <span role="img" aria-label={text} data-completion={share} className="inline-flex shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line-2)" strokeWidth="2.5" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap={share > 0 ? 'round' : 'butt'}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
      </span>
    </Tooltip>
  );
}

function deviceLabel(device, t) {
  return DEVICES.has(device) ? t(`stats.devices.${device}`) : t('stats.devices.unknown');
}

function deviceIcon(device) {
  return device === 'mobile' || device === 'tablet' ? Ico.phone(12) : Ico.computer(12);
}

function placeName(location) {
  if (!location || typeof location !== 'object') return '';
  return [location.city, location.region, location.country].filter((part) => typeof part === 'string' && part).join(', ');
}

// "Desktop · macOS · Lisbon, Lisbon, Portugal", with an icon for each part.
function Whereabouts({ device, os, location }) {
  const { t } = useTranslation('artifacts');
  const place = placeName(location);
  const item = 'inline-flex min-w-0 items-center gap-1';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium leading-[14px] text-ink-3">{t('stats.activity.whereabouts')}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[16px] text-ink-2">
        <span className={item}>
          <span aria-hidden="true" className="inline-flex text-ink-4">{deviceIcon(device)}</span>
          {deviceLabel(device, t)}
        </span>
        {typeof os === 'string' && os && (
          <span className={item}>
            <span aria-hidden="true" className="inline-flex text-ink-4">{Ico.appWindow(12)}</span>
            {os}
          </span>
        )}
        {place && (
          <span className={`${item} max-w-full`}>
            <span aria-hidden="true" className="inline-flex text-ink-4">{Ico.globe(12)}</span>
            <span className="truncate" title={place}>{place}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function ViewerDetail({ viewer, summary, outline, timing, onRetry }) {
  const { t } = useTranslation('artifacts');
  const [picked, setPicked] = useState('all');
  if (viewer.loading) return <StatsSkeleton compact label={t('stats.activity.loading')} />;
  if (viewer.error) return <StatsFailure failure={describeStatsError(viewer.error)} onRetry={onRetry} />;
  const visits = Array.isArray(viewer.data?.visits) ? viewer.data.visits : NO_ROWS;
  if (!visits.length) {
    return <span className="text-[12px] leading-[16px] text-ink-4">{t('stats.activity.noVisits')}</span>;
  }
  const person = { ...summary, ...(viewer.data?.viewer || {}) };
  const visit = picked === 'all' ? null : visits.find((row, i) => String(row.id ?? i) === picked) || null;
  // Newest visit first for the device line when the viewer row has none.
  const latest = [...visits].sort((a, b) => (Date.parse(b.started_at) || 0) - (Date.parse(a.started_at) || 0))[0];
  const where = visit
    ? { device: visit.device, os: visit.os, location: visit.location }
    : {
      device: person.last_device ?? latest?.device,
      os: person.last_os ?? latest?.os,
      location: person.last_location ?? latest?.location,
    };
  const bars = timing ? sumSections(outline, (visit ? [visit] : visits).map((row) => row.sections)) : NO_ROWS;
  const name = viewerName(person, t);
  return (
    <div className="flex flex-col gap-3">
      {visits.length > 1 && (
        <label className="flex items-center gap-2 text-[11px] font-medium leading-[14px] text-ink-3">
          {t('stats.activity.visit')}
          <select
            value={visit ? picked : 'all'}
            onChange={(event) => setPicked(event.target.value)}
            className="min-w-0 flex-1 cursor-pointer rounded-[6px] border border-line bg-surface px-2 py-1
              font-body text-[12px] leading-[16px] text-ink outline-none focus-visible:border-accent"
          >
            <option value="all">
              {t('stats.activity.allVisits', {
                count: visits.length,
                time: formatClock(visits.reduce((sum, row) => sum + (Number(row.seconds) || 0), 0)),
              })}
            </option>
            {visits.map((row, i) => (
              <option key={row.id ?? i} value={String(row.id ?? i)}>
                {t('stats.activity.visitOption', {
                  date: shortDateTime(row.started_at) || '—',
                  time: formatClock(row.seconds || 0),
                  device: deviceLabel(row.device, t),
                })}
              </option>
            ))}
          </select>
        </label>
      )}
      <Whereabouts {...where} />
      {bars.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium leading-[14px] text-ink-3">{t('stats.pages.title')}</span>
          <PageBars
            key={picked}
            bars={bars}
            mode="spent"
            label={visit
              ? t('stats.activity.visitChart', { name, date: shortDateTime(visit.started_at) || '—' })
              : t('stats.activity.viewerChart', { name })}
          />
        </div>
      )}
    </div>
  );
}

function ViewerRow({ viewer, open, detail, outline, timing, onToggle, onRetry }) {
  const { t } = useTranslation('artifacts');
  const panelId = `stats-viewer-${String(viewer.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
  const hasCompletion = timing && typeof viewer.completion === 'number';
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
        className={`flex w-full cursor-pointer items-center gap-[10px] rounded-[8px] border-0 px-2 py-2
          text-left font-body transition-colors hover:bg-surface-2 motion-reduce:transition-none
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
          ${open ? 'bg-surface-2' : 'bg-transparent'}`}
      >
        <Avatar viewer={viewer} />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className={`truncate text-[13px] font-medium leading-[18px] ${viewer.email ? 'text-ink' : 'text-ink-2'}`}>
            {viewerName(viewer, t)}
          </span>
          <span className="truncate text-[11px] leading-[14px] text-ink-3" title={exactTime(viewer.last_seen)}>
            {t('stats.activity.summary', {
              count: viewer.visits || 0,
              lastSeen: relativeAge(viewer.last_seen) || '—',
            })}
          </span>
        </span>
        {timing && (
          <span className="shrink-0 text-[12px] font-medium leading-[16px] tabular-nums text-ink-2">
            <span className="sr-only">{t('stats.activity.totalTime', { time: formatDuration(viewer.total_seconds || 0) })}</span>
            <span aria-hidden="true">{formatClock(viewer.total_seconds || 0)}</span>
          </span>
        )}
        {hasCompletion ? <CompletionRing value={viewer.completion} /> : timing && <span className="w-[18px] shrink-0" aria-hidden="true" />}
        <span
          aria-hidden="true"
          className={`inline-flex shrink-0 text-ink-4 transition-transform duration-200 motion-reduce:transition-none
            ${open ? 'rotate-180' : ''}`}
        >
          {Ico.chevDown(12)}
        </span>
      </button>
      {open && (
        <div id={panelId} role="region" aria-label={viewerName(viewer, t)} className="px-2 pb-3 pt-2">
          <ViewerDetail
            key={viewer.id}
            viewer={detail}
            summary={viewer}
            outline={outline}
            timing={timing}
            onRetry={onRetry}
          />
        </div>
      )}
    </li>
  );
}

export function ActivityList({ viewers, outline = NO_ROWS, timing = true, openViewer, onOpenViewer, onCloseViewer }) {
  const { t } = useTranslation('artifacts');
  return (
    <ul aria-label={t('stats.activity.title')} className="m-0 flex list-none flex-col gap-[2px] p-0">
      {viewers.map((viewer, i) => {
        const open = !!openViewer && openViewer.id === viewer.id;
        return (
          <ViewerRow
            key={viewer.id || i}
            viewer={viewer}
            open={open}
            detail={open ? openViewer : null}
            outline={outline}
            timing={timing}
            onToggle={() => (open ? onCloseViewer?.() : onOpenViewer?.(viewer.id))}
            onRetry={() => onOpenViewer?.(viewer.id)}
          />
        );
      })}
    </ul>
  );
}

export default ActivityList;
