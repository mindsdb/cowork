// Relative-time helpers shared across the app.
// relativeAge:  compact "m/h/d ago" + date for older — used by card footers.
// relativeTime: past/future phrasing ("3h ago" / "in 3h") + short date past
//               30d — used by schedule cards/detail (next-run, last-run).

import i18n, { currentLocale } from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`messages.time.${key}`, { ns: 'projects', ...vars });

/* English keeps the system's date format, as it always has. */
function dateLocale() {
  const locale = currentLocale();
  return locale === 'en' || locale === 'en-XA' ? undefined : locale;
}

export function relativeAge(input) {
  if (!input) return null;
  const ts = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  if (diff < 60_000)          return tr('justNow');
  if (diff < 3_600_000)       return tr('ago.m', { value: Math.floor(diff / 60_000) });
  if (diff < 86_400_000)      return tr('ago.h', { value: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000)  return tr('ago.d', { value: Math.floor(diff / 86_400_000) });
  return new Date(ts).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
}

export function relativeTime(input) {
  if (!input) return null;
  const t = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  const diff = t - now; // negative = past
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  let value, unit;
  if (abs < minute)        { value = Math.round(abs / 1000);  unit = 's'; }
  else if (abs < hour)     { value = Math.round(abs / minute); unit = 'm'; }
  else if (abs < day)      { value = Math.round(abs / hour);   unit = 'h'; }
  else if (abs < 30 * day) { value = Math.round(abs / day);    unit = 'd'; }
  else {
    return new Date(t).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
  }
  return diff >= 0 ? tr(`in.${unit}`, { value }) : tr(`ago.${unit}`, { value });
}
