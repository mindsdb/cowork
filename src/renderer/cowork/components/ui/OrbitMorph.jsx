import { useEffect, useRef } from 'react';

// Orbit · Morph indicator — port of the vanilla-JS reference at
// /docs/design-guidelines/orbit-morph-implementation.html.
//
// A satellite circles a center that morphs through chaos → pyramid → dot
// → cube while Anton is thinking, then resolves to a futurist "A" when
// the work is done. Idle shows a slow orbit around a faded ring.
//
// Single rAF loop per instance, SVG content is rebuilt each frame from
// (angle, phase). Theme follows body[data-theme] live; size is set via
// the --om-size CSS variable so it scales cleanly.

const NS = 'http://www.w3.org/2000/svg';

const PALETTE = {
  light: { faded: '#6B6F73', accent: '#1F9CB0' },
  dark:  { faded: '#8A97AE', accent: 'rgb(34, 211, 238)' },
};

const svgEl = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

function readBodyTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.body?.dataset?.theme === 'dark' ? 'dark' : 'light';
}

export default function OrbitMorph({
  state = 'idle',           // 'idle' | 'thinking' | 'done'
  theme,                    // 'light' | 'dark' — defaults to body[data-theme]
  size = 18,
  className,
  style,
  title,
  // Optional override for the satellite's orbit period (in ms). Lets
  // callers lock two stacked instances to the same speed so their
  // satellites stay synchronized across cross-fades. Default is the
  // state-derived value (1400 thinking, 4500 idle/done).
  orbitPeriodMs,
}) {
  const hostRef = useRef(null);
  const stateRef = useRef(state);
  const themeRef = useRef(theme || readBodyTheme());
  const orbitPeriodRef = useRef(orbitPeriodMs);

  // Keep refs in sync so the rAF loop reads fresh values without restarting.
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { orbitPeriodRef.current = orbitPeriodMs; }, [orbitPeriodMs]);
  useEffect(() => {
    if (theme) themeRef.current = theme;
  }, [theme]);

  // If no theme prop is given, follow body[data-theme] live.
  useEffect(() => {
    if (theme) return;
    themeRef.current = readBodyTheme();
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      themeRef.current = readBodyTheme();
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const svg = svgEl('svg', { viewBox: '0 0 24 24', width: '100%', height: '100%' });
    svg.style.display = 'block';
    svg.style.width = 'var(--om-size, 18px)';
    svg.style.height = 'var(--om-size, 18px)';
    host.appendChild(svg);

    const t0 = performance.now();
    let raf = 0;

    function tick() {
      const s = stateRef.current;
      const p = PALETTE[themeRef.current] || PALETTE.light;

      const t = performance.now() - t0;
      const orbitDur = orbitPeriodRef.current ?? (s === 'thinking' ? 1400 : 4500);
      const morphDur = s === 'thinking' ? 4800 : 12000;
      const angle = ((t / orbitDur) * 360) % 360;
      const phase = (t / morphDur) % 1;

      const stage = Math.floor(phase * 4);
      const stageT = (phase * 4) % 1;
      const grow = stageT < 0.5 ? stageT * 2 : (1 - stageT) * 2;
      const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
      const g = ease(grow);

      let shape = 'dot';
      if (s === 'thinking') {
        if      (stage === 0) shape = 'chaos';
        else if (stage === 1) shape = 'pyramid';
        else if (stage === 3) shape = 'cube';
      }
      if (s === 'done') shape = 'A';

      const orbitR = 8.5;
      const a = (angle * Math.PI) / 180;
      const sx = 12 + Math.cos(a) * orbitR;
      const sy = 12 + Math.sin(a) * orbitR;
      const dotR = 1.4 + g * 1.0;
      const shapeSize = 1.8 + g * 3.2;

      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // Orbit ring guide
      svg.appendChild(svgEl('circle', {
        cx: 12, cy: 12, r: orbitR, fill: 'none',
        stroke: p.faded, 'stroke-opacity': 0.18, 'stroke-width': 0.6,
      }));

      // Satellite (idle + thinking)
      if (s !== 'done') {
        svg.appendChild(svgEl('circle', {
          cx: sx.toFixed(2), cy: sy.toFixed(2),
          r: s === 'idle' ? 1.0 : 1.4,
          fill: p.accent,
        }));
      }

      // Center morph — only in thinking
      if (s === 'thinking') {
        if (shape === 'chaos') {
          const frags = [
            { d: 'M-3.5,6 L0,-6',  spin: phase * 720,  ox: -2, oy: -1 },
            { d: 'M0,-6 L3.5,6',   spin: -phase * 540, ox:  2, oy:  1 },
            { d: 'M-2.5,5 L2.5,5', spin: phase * 900,  ox:  0, oy:  2 },
          ];
          const wrap = svgEl('g', { opacity: g });
          frags.forEach((f) => {
            const outer = svgEl('g', {
              transform: `translate(${(12 + f.ox * g).toFixed(2)} ${(12 + f.oy * g).toFixed(2)}) rotate(${f.spin.toFixed(2)})`,
            });
            const inner = svgEl('path', {
              d: f.d,
              fill: 'none',
              stroke: p.accent,
              'stroke-width': (0.15 + g * 0.35).toFixed(3),
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round',
              transform: `scale(${(0.5 + g * 0.7).toFixed(3)})`,
            });
            outer.appendChild(inner);
            wrap.appendChild(outer);
          });
          svg.appendChild(wrap);
        } else if (shape === 'pyramid') {
          const outer = svgEl('g', { transform: `rotate(${angle.toFixed(2)} 12 12)` });
          const inner = svgEl('g', {
            transform: `translate(12 12) scale(${(shapeSize / 9).toFixed(3)}) translate(-12 -12)`,
            opacity: g,
          });
          inner.appendChild(svgEl('path', {
            d: 'M5,20 L12,15.96 M19,20 L12,15.96 M12,7.88 L12,15.96',
            fill: 'none', stroke: p.accent,
            'stroke-opacity': 0.55,
            'stroke-width': (0.18 + g * 0.4).toFixed(3),
            'stroke-linejoin': 'round', 'stroke-linecap': 'round',
          }));
          inner.appendChild(svgEl('path', {
            d: 'M5,20 L12,7.88 L19,20 Z',
            fill: 'none', stroke: p.accent,
            'stroke-width': (0.25 + g * 0.55).toFixed(3),
            'stroke-linejoin': 'round', 'stroke-linecap': 'round',
          }));
          outer.appendChild(inner);
          svg.appendChild(outer);
        } else if (shape === 'dot') {
          svg.appendChild(svgEl('circle', {
            cx: 12, cy: 12, r: dotR.toFixed(3), fill: 'none',
            stroke: p.accent, 'stroke-width': (0.15 + g * 0.35).toFixed(3),
          }));
        } else if (shape === 'cube') {
          const outer = svgEl('g', { transform: `rotate(${angle.toFixed(2)} 12 12)` });
          const inner = svgEl('g', {
            transform: `translate(12 12) scale(${(shapeSize / 9).toFixed(3)}) translate(-12 -12)`,
            opacity: g,
          });
          inner.appendChild(svgEl('path', {
            d: 'M3.5,8 L12,13 L20.5,8 M12,13 L12,22',
            fill: 'none', stroke: p.faded,
            'stroke-opacity': 0.45,
            'stroke-width': 0.8,
            'stroke-dasharray': '1.5 1.5',
          }));
          inner.appendChild(svgEl('path', {
            d: [
              'M3.5,8 L12,3 L20.5,8 L12,13 Z',
              'M3.5,8 L3.5,17',
              'M20.5,8 L20.5,17',
              'M12,13 L12,22',
              'M3.5,17 L12,22 L20.5,17',
            ].join(' '),
            fill: 'none',
            stroke: p.accent,
            'stroke-width': (0.25 + g * 0.55).toFixed(3),
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          }));
          outer.appendChild(inner);
          svg.appendChild(outer);
        }
      }

      // Done — futurist A + locked ring
      if (s === 'done') {
        const grp = svgEl('g', {
          stroke: p.accent, 'stroke-width': 1.4,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none',
        });
        grp.appendChild(svgEl('path', { d: 'M5 20 L12 7.88 L19 20 L9 20' }));
        svg.appendChild(grp);
        svg.appendChild(svgEl('circle', {
          cx: 12, cy: 12, r: orbitR, fill: 'none',
          stroke: p.accent, 'stroke-width': 1, 'stroke-opacity': 0.35,
        }));
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      ref={hostRef}
      className={'orbit-morph' + (className ? ' ' + className : '')}
      data-state={state}
      data-theme={theme || undefined}
      title={title}
      aria-hidden="true"
      style={{
        display: 'inline-block',
        ['--om-size']: typeof size === 'number' ? `${size}px` : size,
        ...style,
      }}
    />
  );
}
