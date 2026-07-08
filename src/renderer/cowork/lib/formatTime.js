// Relative-time helpers shared across the app.
// relativeAge: compact "m/h/d ago" + date for older — used by card footers.
// timeAgo:     "min/h/d/w ago" + "Yesterday" — used by sidebar/recents lists.

export function relativeAge(input) {
  if (!input) return null;
  const ts = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  if (diff < 60_000)          return 'just now';
  if (diff < 3_600_000)       return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)      return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000)  return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60)     return 'just now';
  if (secs < 3600)   return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 172800) return 'Yesterday';
  if (secs < 604800) return `${Math.floor(secs / 86400)} d ago`;
  return `${Math.floor(secs / 604800)} w ago`;
}
