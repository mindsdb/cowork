// The numbers and shapes behind ChartBlock, without React: a chart's number
// format and unit, its value axis, and the SVG paths of its marks.

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const CURRENCY = /^[$€£¥]$/;

/** A chart's unit as a currency prefix ("$") or a word said after its values ("hours"). */
export function unitParts(unit) {
  const symbol = (unit || '').trim();
  return CURRENCY.test(symbol) ? { prefix: symbol, word: null } : { prefix: '', word: unit || null };
}

/** One number format per chart: compact when its largest value is ≥10,000; a currency unit prefixes. */
export function formatter(values, unit) {
  const max = Math.max(0, ...values.filter((v) => v != null).map((v) => Math.abs(v)));
  const base = max >= 10000 ? compact : full;
  const { prefix } = unitParts(unit);
  return (n) => {
    if (n == null) return '—';
    return `${n < 0 ? '−' : ''}${prefix}${base.format(Math.abs(n))}`;
  };
}

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  const nice = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return nice * mag;
}

/** A value axis from 0 (or below) to past the largest value, on round ticks. */
export function niceScale(values, count = 4) {
  const finite = values.filter((v) => v != null && Number.isFinite(v));
  let lo = Math.min(0, ...finite);
  let hi = Math.max(0, ...finite);
  if (lo === hi) hi = lo + 1;
  const step = niceStep(hi - lo, count);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo, hi, ticks };
}

/** Each label's stacked extent: [sum of its negative values, sum of its positive ones]. */
export function stackTotals(labels, series) {
  return labels.map((_, i) => {
    let up = 0;
    let down = 0;
    for (const s of series) {
      const v = s.values[i] || 0;
      if (v >= 0) up += v;
      else down += v;
    }
    return [down, up];
  });
}

/** A bar whose data end (`dir`: up, down, right, left) is rounded by `r` and whose baseline end is square. */
export function barPath(x, y, w, h, r, dir) {
  if (w <= 0 || h <= 0) return '';
  const rr = Math.min(r, w / 2, h / 2);
  if (dir === 'up') {
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }
  if (dir === 'down') {
    return `M${x},${y}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w - rr}Q${x + w},${y + h} ${x + w},${y + h - rr}V${y}Z`;
  }
  if (dir === 'right') {
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  }
  return `M${x + w},${y}H${x + rr}Q${x},${y} ${x},${y + rr}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w}Z`;
}

/** Donut slices of outer radius `r` and hole `inner`, clockwise from 12 o'clock: `{ d, i, v }` each. */
export function donutArcs(values, r, inner) {
  const total = values.reduce((a, b) => a + b, 0);
  const at = (rad, ang) => [r + rad * Math.cos(ang), r + rad * Math.sin(ang)];
  let angle = -Math.PI / 2;
  return values.map((v, i) => {
    const sweep = total ? (v / total) * Math.PI * 2 : 0;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const [x0, y0] = at(r, a0); const [x1, y1] = at(r, a1);
    const [x2, y2] = at(inner, a1); const [x3, y3] = at(inner, a0);
    // A whole ring can't be one arc (its ends meet): two half-open circles.
    const d = sweep >= Math.PI * 2 - 1e-6
      ? `M${r},${0}A${r},${r} 0 1 1 ${r - 0.01},0Z M${r},${r - inner}A${inner},${inner} 0 1 0 ${r + 0.01},${r - inner}Z`
      : `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${inner},${inner} 0 ${large} 0 ${x3},${y3}Z`;
    return { d, i, v };
  });
}

/** `s` cut to `n` characters, an ellipsis last. */
export const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
