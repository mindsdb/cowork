// How the Stats panel writes times and shares: "45s", "1m 24s", "2h 5m",
// "42%". Durations round to whole seconds and drop a zero second or minute
// part ("4m", not "4m 0s"). Translated when called, never at import.

import i18n, { currentLocale } from '../../../../lib/i18n';

const tr = (key, vars) => i18n.t(`artifacts:stats.duration.${key}`, vars);

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  const total = Math.round(value);
  if (total < 60) return tr('seconds', { s: total });
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? tr('minutesSeconds', { m, s }) : tr('minutes', { m });
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return m ? tr('hoursMinutes', { h, m }) : tr('hours', { h });
}

function numberLocale() {
  const locale = currentLocale();
  return locale === 'en-XA' ? 'en' : locale;
}

export function formatPercent(fraction) {
  const value = Number(fraction);
  if (fraction == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(numberLocale(), { style: 'percent', maximumFractionDigits: 0 })
    .format(Math.min(1, Math.max(0, value)));
}

export function exactTime(iso) {
  const ts = Date.parse(iso || '');
  return Number.isFinite(ts) ? new Date(ts).toLocaleString(numberLocale()) : '';
}

const pad2 = (n) => String(n).padStart(2, '0');

// A clock reading for a duration: "04:12", "1:02:03". With `fraction`, a time
// under a minute keeps one decimal ("00:00.2", "00:12.5"), so a glance at a
// section is not rounded away to "00:00".
export function formatClock(seconds, { fraction = false } = {}) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (fraction && value < 59.95) {
    return `00:${(Math.round(value * 10) / 10).toFixed(1).padStart(4, '0')}`;
  }
  const total = Math.round(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

// A visit's start, short: "Nov 17, 10:42 AM".
export function shortDateTime(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString(numberLocale(), {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
