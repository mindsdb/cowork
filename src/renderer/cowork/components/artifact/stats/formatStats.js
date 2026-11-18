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
