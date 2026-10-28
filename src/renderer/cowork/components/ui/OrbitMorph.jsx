import { useEffect, useRef } from 'react';

// Orbit · Morph indicator — port of the vanilla-JS reference at
// /docs/design-guidelines/orbit-morph-implementation.html.
//
// A satellite circles a center that morphs through chaos → pyramid → dot
// → cube while Anton is thinking, then resolves to a futurist "A" when
// the work is done. Idle shows a slow orbit around a faded ring.
//
// Thinking runs a rAF loop that rebuilds the SVG each frame from
// (angle, phase). Idle and done draw once; the idle satellite sits in its
// own layer that CSS rotates, so a resting page runs no script per frame.
// Theme follows body[data-theme] live; size is set via the --om-size CSS
// variable so it scales cleanly.

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
  // Stops the animation while a caller keeps this instance invisible.
  paused = false,
}) {
  const hostRef = useRef(null);
  const stateRef = useRef(state);
  const themeRef = useRef(theme || readBodyTheme());
  const orbitPeriodRef = useRef(orbitPeriodMs);
  const pausedRef = useRef(paused);
  const syncRef = useRef(null);

  // Keep refs in sync so the drawing reads fresh values without remounting.
  useEffect(() => {
    stateRef.current = state;
    pausedRef.current = paused;
    orbitPeriodRef.current = orbitPeriodMs;
    if (theme) themeRef.current = theme;
    syncRef.current?.();
  }, [state, paused, orbitPeriodMs, theme]);

  // If no theme prop is given, follow body[data-theme] live.
  useEffect(() => {
    if (theme) return;
    themeRef.current = readBodyTheme();
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      themeRef.current = readBodyTheme();
      syncRef.current?.();
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

    const orbitR = 8.5;
    // An HTML wrapper, not the svg, carries the rotation: Chrome runs a
    // transform animation on an HTML box off the main thread, not on svg.
    const satLayer = document.createElement('span');
    Object.assign(satLayer.style, {
      position: 'absolute', inset: '0', transformOrigin: '50% 50%', willChange: 'transform',
    });
    const satSvg = svgEl('svg', { viewBox: '0 0 24 24', width: '100%', height: '100%' });
    satSvg.style.display = 'block';
    const sat = svgEl('circle', { cx: 12 + orbitR, cy: 12, r: 1.0 });
    satSvg.appendChild(sat);
    satLayer.appendChild(satSvg);
    host.appendChild(satLayer);

    const t0 = performance.now();
    let raf = 0;
    // Period of the running idle satellite animation; 0 while it is hidden.
    let satOrbitDur = 0;
    const orbitDurFor = (s) => orbitPeriodRef.current ?? (s === 'thinking' ? 1400 : 4500);

    function drawFrame(s) {
      const p = PALETTE[themeRef.current] || PALETTE.light;

      const t = performance.now() - t0;
      const orbitDur = orbitDurFor(s);
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

      // Satellite while thinking; the idle one lives in satLayer.
      if (s === 'thinking') {
        svg.appendChild(svgEl('circle', {
          cx: sx.toFixed(2), cy: sy.toFixed(2), r: 1.4, fill: p.accent,
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
    }

    function tick() {
      drawFrame('thinking');
      raf = requestAnimationFrame(tick);
    }

    function showIdleSatellite(visible) {
      satLayer.style.display = visible ? 'block' : 'none';
      if (!visible) {
        satLayer.style.animation = '';
        satOrbitDur = 0;
        return;
      }
      sat.setAttribute('fill', (PALETTE[themeRef.current] || PALETTE.light).accent);
      const orbitDur = orbitDurFor('idle');
      // Chrome keeps a running animation's start time when only its timing
      // changes, so a rewrite shifts the satellite. Restart it from scratch,
      // and only when it appears or its period changes.
      if (orbitDur !== satOrbitDur) {
        if (satOrbitDur) {
          satLayer.style.animation = 'none';
          void satLayer.offsetWidth;
        }
        satOrbitDur = orbitDur;
        // A negative delay starts the CSS orbit at the angle drawFrame would use.
        const elapsed = (performance.now() - t0) % orbitDur;
        satLayer.style.animation = `spin ${orbitDur}ms linear -${elapsed.toFixed(0)}ms infinite`;
      }
      // After the shorthand, which resets the play state to running.
      satLayer.style.animationPlayState = pausedRef.current ? 'paused' : 'running';
    }

    function sync() {
      const s = stateRef.current;
      showIdleSatellite(s === 'idle');
      if (s === 'thinking' && !pausedRef.current) {
        if (!raf) raf = requestAnimationFrame(tick);
        return;
      }
      cancelAnimationFrame(raf);
      raf = 0;
      drawFrame(s);
    }

    syncRef.current = sync;
    sync();

    return () => {
      syncRef.current = null;
      cancelAnimationFrame(raf);
      if (svg.parentNode) svg.parentNode.removeChild(svg);
      if (satLayer.parentNode) satLayer.parentNode.removeChild(satLayer);
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
        position: 'relative',
        ['--om-size']: typeof size === 'number' ? `${size}px` : size,
        ...style,
      }}
    />
  );
}
