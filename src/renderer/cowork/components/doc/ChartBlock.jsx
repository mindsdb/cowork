// ChartBlock — a chart drawn from its source table (live) or its own data.
//
// Marks follow the app's dataviz specs: bars ≤24px with a 4px rounded data
// end and a square baseline, 2px lines, ≥8px markers with a 2px surface ring,
// a 2px surface gap between touching fills, hairline solid gridlines, a
// legend whenever there are two or more series, and a hover tooltip on
// every form. Text never wears a series colour.
//
// Hand-drawn SVG rather than chart.js (an app dependency): it draws the same
// charts, from the same geometry, as the doc's page and the exports the
// server renders, for every chart kind the doc format allows.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartArea, ChartBar, ChartBarStacked, ChartColumn, ChartLine, ChartPie, Table2 } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Menu, Tooltip } from '../ui';
import EditableText from './EditableText';
import { chartData, newId, sourceForTable } from './docModel';
import { barPath, clip, donutArcs, formatter, niceScale, stackTotals, unitParts } from './chartGeometry';

const KINDS = [
  { id: 'bar', label: 'Columns', icon: ChartColumn },
  { id: 'hbar', label: 'Bars', icon: ChartBar },
  { id: 'stacked', label: 'Stacked', icon: ChartBarStacked },
  { id: 'line', label: 'Line', icon: ChartLine },
  { id: 'area', label: 'Area', icon: ChartArea },
  { id: 'donut', label: 'Donut', icon: ChartPie },
];

const color = (i) => `var(--series-${(i % 8) + 1})`;

function useWidth(ref) {
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(240, Math.floor(entry.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Legend({ series, line }) {
  if (series.length < 2) return null;
  return (
    <div className="doc-chart__legend" aria-hidden="true">
      {series.map((s, i) => (
        <span key={s.name + i} className="doc-chart__key">
          <span className={`doc-chart__swatch ${line ? 'doc-chart__swatch--line' : ''}`} style={{ background: color(i) }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({ hover, labels, series, unit, pos, fmt }) {
  if (hover == null || !pos) return null;
  return (
    <div className="doc-tooltip" style={{ left: pos.x, top: pos.y }}>
      <div className="doc-tooltip__label">{labels[hover]}</div>
      {series.map((s, i) => (
        <div key={s.name + i} className="doc-tooltip__row">
          <span><span className="doc-chart__swatch" style={{ background: color(i) }} />{s.name}</span>
          <span className="doc-tooltip__val">{fmt(s.values[hover])}{unitParts(unit).word ? ` ${unit}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function CartesianChart({ kind, labels, series, width, unit, title, fmt }) {
  const [hover, setHover] = useState(null);
  const [pos, setPos] = useState(null);
  const n = labels.length;
  const horizontal = kind === 'hbar';
  const stacked = kind === 'stacked';
  const lineLike = kind === 'line' || kind === 'area';

  const totals = useMemo(() => (stacked ? stackTotals(labels, series) : null), [stacked, labels, series]);
  const allValues = stacked ? totals.flat() : series.flatMap((s) => s.values);
  const { lo, hi, ticks } = niceScale(allValues, 4);

  if (horizontal) {
    const labelW = Math.min(Math.round(width * 0.34), 160);
    const band = Math.max(28, series.length * 14 + 12);
    const height = n * band + 24;
    const plotX = labelW + 10;
    const plotW = Math.max(60, width - plotX - 44);
    const x = (v) => plotX + ((v - lo) / (hi - lo)) * plotW;
    const bh = Math.min(24, (band - 10 - 2 * (series.length - 1)) / series.length);
    return (
      <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={n * band} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={x(t)} y={n * band + 16} fontSize="10.5" textAnchor="middle" fill="var(--ink-3)">{fmt(t)}</text>
            </g>
          ))}
          {labels.map((label, i) => {
            const top = i * band;
            const groupH = series.length * bh + 2 * (series.length - 1);
            return (
              <g key={i} onMouseEnter={(e) => { setHover(i); setPos({ x: plotX + 12, y: top + band }); }}>
                <rect x={0} y={top} width={width} height={band} fill={hover === i ? 'var(--doc-hover)' : 'transparent'} />
                <text x={labelW} y={top + band / 2 + 4} fontSize="12" textAnchor="end" fill="var(--ink-2)">{clip(label, 24)}</text>
                {series.map((s, si) => {
                  const v = s.values[i];
                  if (v == null) return null;
                  const y0 = top + (band - groupH) / 2 + si * (bh + 2);
                  const a = x(Math.min(0, v)); const b = x(Math.max(0, v));
                  return <path key={si} d={barPath(a, y0, Math.max(1, b - a), bh, 4, v >= 0 ? 'right' : 'left')} fill={color(si)} />;
                })}
                {series.length === 1 && series[0].values[i] != null && (
                  <text x={x(Math.max(0, series[0].values[i])) + 6} y={top + band / 2 + 4} fontSize="11" fill="var(--ink-2)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(series[0].values[i])}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <TooltipBox hover={hover} labels={labels} series={series} unit={unit} pos={pos} fmt={fmt} />
      </div>
    );
  }

  const height = 220;
  const padL = 44; const padR = 12; const padT = 8; const padB = 28;
  const plotW = Math.max(60, width - padL - padR);
  const plotH = height - padT - padB;
  const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo));
  const bandW = plotW / Math.max(1, n);
  const cx = (i) => padL + bandW * (i + 0.5);
  const every = Math.max(1, Math.ceil((n * 64) / plotW));

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - padL) / bandW)));
    setHover(i);
    setPos({ x: Math.min(cx(i) + 12, width - 150), y: padT + 4 });
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 3.5} fontSize="10.5" textAnchor="end" fill="var(--ink-3)">{fmt(t)}</text>
          </g>
        ))}
        {hover != null && !lineLike && (
          <rect x={padL + bandW * hover} y={padT} width={bandW} height={plotH} fill="var(--doc-hover)" />
        )}
        {!lineLike && labels.map((_, i) => {
          if (stacked) {
            const bw = Math.min(24, bandW * 0.6);
            const x0 = cx(i) - bw / 2;
            const up = []; const down = [];
            let posBase = 0; let negBase = 0;
            series.forEach((s, si) => {
              const v = s.values[i];
              if (!v) return;
              if (v > 0) { up.push({ si, from: posBase, to: posBase + v }); posBase += v; }
              else { down.push({ si, from: negBase, to: negBase + v }); negBase += v; }
            });
            // A 2px surface gap between touching segments; only the outer end is rounded.
            return (
              <g key={i}>
                {up.map((seg, k) => {
                  const top = y(seg.to);
                  const h = Math.max(1, y(seg.from) - (k > 0 ? 2 : 0) - top);
                  return k === up.length - 1
                    ? <path key={seg.si} d={barPath(x0, top, bw, h, 4, 'up')} fill={color(seg.si)} />
                    : <rect key={seg.si} x={x0} y={top} width={bw} height={h} fill={color(seg.si)} />;
                })}
                {down.map((seg, k) => {
                  const top = y(seg.from) + (k > 0 ? 2 : 0);
                  const h = Math.max(1, y(seg.to) - top);
                  return k === down.length - 1
                    ? <path key={seg.si} d={barPath(x0, top, bw, h, 4, 'down')} fill={color(seg.si)} />
                    : <rect key={seg.si} x={x0} y={top} width={bw} height={h} fill={color(seg.si)} />;
                })}
              </g>
            );
          }
          const k = series.length;
          const bw = Math.min(24, (bandW * 0.72 - 2 * (k - 1)) / k);
          const groupW = k * bw + 2 * (k - 1);
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v == null) return null;
                const x0 = cx(i) - groupW / 2 + si * (bw + 2);
                const a = y(Math.max(0, v)); const b = y(Math.min(0, v));
                return <path key={si} d={barPath(x0, a, bw, Math.max(1, b - a), 4, v >= 0 ? 'up' : 'down')} fill={color(si)} />;
              })}
            </g>
          );
        })}
        {lineLike && series.map((s, si) => {
          const pts = s.values.map((v, i) => (v == null ? null : [cx(i), y(v)]));
          const segs = [];
          let cur = [];
          for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
          if (cur.length) segs.push(cur);
          const showDots = n <= 24;
          return (
            <g key={si}>
              {kind === 'area' && segs.map((seg, j) => (
                <path key={`a${j}`} d={`M${seg[0][0]},${y(Math.max(lo, 0))}${seg.map((p) => `L${p[0]},${p[1]}`).join('')}L${seg[seg.length - 1][0]},${y(Math.max(lo, 0))}Z`} fill={color(si)} opacity="0.1" />
              ))}
              {segs.map((seg, j) => (
                <polyline key={`l${j}`} points={seg.map((p) => p.join(',')).join(' ')} fill="none" stroke={color(si)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {pts.map((p, i) => p && (showDots || i === pts.length - 1 || hover === i) && (
                <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill={color(si)} stroke="var(--chart-surface)" strokeWidth="2" />
              ))}
            </g>
          );
        })}
        {lineLike && hover != null && (
          <line x1={cx(hover)} x2={cx(hover)} y1={padT} y2={padT + plotH} stroke="var(--ink-4)" strokeWidth="1" />
        )}
        {labels.map((label, i) => (i % every === 0 ? (
          <text key={i} x={cx(i)} y={height - 9} fontSize="10.5" textAnchor="middle" fill="var(--ink-3)">{clip(label, Math.max(6, Math.floor((bandW * every) / 7)))}</text>
        ) : null))}
      </svg>
      <TooltipBox hover={hover} labels={labels} series={series} unit={unit} pos={pos} fmt={fmt} />
    </div>
  );
}

function DonutChart({ labels, series, width, unit, title, fmt }) {
  const [hover, setHover] = useState(null);
  const values = (series[0]?.values || []).map((v) => Math.max(0, v || 0));
  const total = values.reduce((a, b) => a + b, 0);
  const size = Math.min(200, width * 0.45);
  const r = size / 2;
  const arcs = donutArcs(values, r, r * 0.62);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {arcs.map((a) => a.v > 0 && (
          <path key={a.i} d={a.d} fill={color(a.i)} stroke="var(--chart-surface)" strokeWidth="2"
            opacity={hover == null || hover === a.i ? 1 : 0.45} onMouseEnter={() => setHover(a.i)} />
        ))}
        <text x={r} y={r - 2} textAnchor="middle" fontSize="18" fontWeight="650" fill="var(--ink)">
          {fmt(hover != null ? values[hover] : total)}
        </text>
        <text x={r} y={r + 15} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
          {hover != null ? clip(labels[hover], 18) : `Total${unit ? ` (${unit})` : ''}`}
        </text>
      </svg>
      <div style={{ display: 'grid', gap: 6, fontSize: 12.5, minWidth: 160, flex: 1 }}>
        {labels.map((label, i) => (
          <div key={i} className="doc-tooltip__row" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ opacity: hover == null || hover === i ? 1 : 0.55, cursor: 'default' }}>
            <span><span className="doc-chart__swatch" style={{ background: color(i) }} />{label}</span>
            <span className="doc-tooltip__val">{fmt(values[i])} · {total ? Math.round((values[i] / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChartBlock({ block, tab, editable, onOps, onShowTable }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const { labels, series, table, missing } = chartData(block, tab);
  const tablesHere = (tab?.blocks || []).filter((b) => b.type === 'table');
  const kind = block.chart || 'bar';
  const plotted = series.filter((s) => s.values.some((v) => v != null));
  const fmt = formatter(plotted.flatMap((s) => s.values), block.unit);
  const unitWord = unitParts(block.unit).word;
  const subtitle = [unitWord ? `In ${unitWord}` : null, table ? 'Updates with its table' : null].filter(Boolean).join(' · ');

  const setKind = (next) => onOps?.([{ op: 'update', id: block.id, set: { chart: next } }]);

  const makeTable = () => {
    const tableId = newId('b_');
    const xCol = { id: newId('c_'), name: 'Label', kind: 'text' };
    const yCols = series.map((s) => ({ id: newId('c_'), name: s.name, kind: 'number' }));
    const rows = labels.map((label, i) => ({
      id: newId('r_'),
      cells: Object.fromEntries([[xCol.id, String(label)], ...yCols.map((c, ci) => [c.id, series[ci].values[i] == null ? '' : String(series[ci].values[i])])]),
    }));
    onOps?.([
      { op: 'insert', position: { before: block.id }, blocks: [{ id: tableId, type: 'table', columns: [xCol, ...yCols], rows }] },
      { op: 'update', id: block.id, set: { source: { table: tableId, x: 'Label', y: yCols.map((c) => c.name) } } },
    ]);
  };

  return (
    <figure className="doc-chart" ref={wrap} aria-label={block.title || 'Chart'}>
      <div className="doc-chart__head">
        <div className="doc-chart__titles">
          <EditableText
            className="doc-chart__title"
            value={block.title || ''}
            plain
            singleLine
            editable={editable}
            placeholder="Chart title"
            onCommit={(title) => onOps?.([{ op: 'update', id: block.id, set: { title } }])}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          />
          {subtitle && <div className="doc-chart__sub">{subtitle}</div>}
        </div>
        {editable && (
          <div className="doc-chart__tools">
            {KINDS.map((k) => (
              <Tooltip key={k.id} content={k.label}>
                <button type="button" className="doc-iconbtn" aria-label={k.label} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                  <Icon of={k.icon} size={16} />
                </button>
              </Tooltip>
            ))}
            <Tooltip content={table ? 'Show its table' : 'Turn data into a table'}>
              <button type="button" className="doc-iconbtn" aria-label={table ? 'Show its table' : 'Turn data into a table'}
                onClick={() => (table ? onShowTable?.(table.id) : makeTable())}>
                <Icon of={Table2} size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {kind !== 'donut' && <Legend series={plotted} line={kind === 'line' || kind === 'area'} />}
      {missing || !labels.length || !plotted.length ? (
        <div className="doc-chart__empty">
          <div>
            {missing === 'table' ? 'This chart’s table isn’t in this tab any more.'
              : missing === 'x' ? `Its table has no “${block.source?.x}” column.`
                : 'No numbers to draw yet.'}
          </div>
          {editable && missing && tablesHere.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Menu
                ariaLabel="Draw from a table"
                trigger={<button type="button" className="doc-addbtn"><Icon of={Table2} size={14} /> Use a table…</button>}
                items={tablesHere.map((t, i) => ({
                  key: t.id,
                  label: `Table ${i + 1}: ${t.columns.map((c) => c.name).slice(0, 4).join(', ')}`,
                  onClick: () => onOps?.([{ op: 'update', id: block.id, set: { source: sourceForTable(t) } }]),
                }))}
              />
            </div>
          )}
        </div>
      ) : kind === 'donut' ? (
        <DonutChart labels={labels} series={plotted} width={width} unit={block.unit} title={block.title} fmt={fmt} />
      ) : (
        <CartesianChart kind={kind} labels={labels} series={plotted} width={width - 32} unit={block.unit} title={block.title} fmt={fmt} />
      )}
      {block.caption && <figcaption className="doc-chart__sub" style={{ marginTop: 6 }}>{block.caption}</figcaption>}
    </figure>
  );
}
