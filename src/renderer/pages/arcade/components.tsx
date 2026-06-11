// Shared chrome + primitives for the arcade onboarding screens.

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import './arcade.css';

/**
 * Tracks the user's `prefers-reduced-motion` setting, live. The CSS
 * animations already gate on the media query; this is the JS-side
 * equivalent so timers/intervals (typewriter, marquee) can render their
 * final state immediately instead of animating.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Full-screen CRT shell: P1 · centered title · ©2026 MINDSDB. */
export function ArcadeShell({
  title,
  subtitle,
  children,
  hudRight = `©${new Date().getFullYear()} MINDSDB`,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  hudRight?: string;
}) {
  return (
    <div className="arc-root">
      <div className="arc-hud">
        {/* Left slot was "P1", but it collided with the macOS traffic
            lights. Now an invisible mirror of the right-side copyright —
            it reserves matching width so the title centers truly. */}
        <span className="arc-hud-copy" style={{ visibility: 'hidden' }} aria-hidden>{hudRight}</span>
        <div className="arc-hud-center">
          {title && <div className="arc-hud-title">{title}</div>}
          {subtitle && <div className="arc-hud-sub">&mdash; {subtitle} &mdash;</div>}
        </div>
        <span className="arc-hud-copy">{hudRight}</span>
      </div>
      <div className="arc-stage arc-scroll-fade">{children}</div>
    </div>
  );
}

/** Blinking "PRESS ⏎ TO …" prompt; also binds the Enter key. */
export function PressPrompt({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  // Keep the latest onPress in a ref so the window listener doesn't need
  // to re-bind every render (callers pass inline closures).
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    if (disabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      // Don't steal Enter when focus is on an interactive element — the
      // element fires its own activation (a focused button/link triggers
      // onClick on Enter; inputs submit). Honoring it here too would
      // double-fire (e.g. a focused cartridge confirming twice).
      const el = (e.target as HTMLElement | null);
      if (el && (el.closest('button, a, input, select, textarea'))) return;
      onPressRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [disabled]);

  return (
    <button
      type="button"
      className={`arc-press${disabled ? ' arc-press-off' : ' arc-blink'}`}
      onClick={onPress}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

/** Step-wise typewriter; fires onDone after the last character. */
export function Typewriter({
  text,
  speed = 38,
  showCaret = true,
  onDone,
  style,
}: {
  text: string;
  speed?: number;
  showCaret?: boolean;
  onDone?: () => void;
  style?: CSSProperties;
}) {
  const [count, setCount] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  // onDone in a ref so a new inline closure each render doesn't restart
  // the typing interval; `done` latches so it fires exactly once.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    if (reducedMotion) {
      // Skip the per-character crawl entirely: show the full string and
      // signal completion on the next tick.
      setCount(text.length);
      return;
    }
    setCount(0);
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) { clearInterval(id); return c; }
        return c + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, reducedMotion]);

  useEffect(() => {
    if (count >= text.length && !doneRef.current) {
      doneRef.current = true;
      const t = setTimeout(() => onDoneRef.current?.(), reducedMotion ? 0 : 350);
      return () => clearTimeout(t);
    }
  }, [count, text, reducedMotion]);

  return (
    <span style={style}>
      {text.slice(0, count)}
      {showCaret && <span className="arc-caret" aria-hidden />}
    </span>
  );
}

/** Chunky segmented progress bar. value: 0..1 */
export function PixelProgress({
  value,
  cells = 24,
  style,
}: {
  value: number;
  cells?: number;
  style?: CSSProperties;
}) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * cells);
  return (
    <div className="arc-bar" style={style} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: cells }, (_, i) => {
        // gradient feel: first 2/3 cyan, then warm, last few hot
        const tone = i >= cells - 4 ? 'hot' : i >= cells - 10 ? 'warm' : '';
        return <div key={i} className={`arc-bar-cell ${i < lit ? `on ${tone}` : ''}`} />;
      })}
    </div>
  );
}

/** Indeterminate marquee progress (single lit block sweeping). */
export function PixelMarquee({ cells = 24, style }: { cells?: number; style?: CSSProperties }) {
  const [pos, setPos] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    if (reducedMotion) return; // hold a static frame instead of sweeping
    const id = setInterval(() => setPos((p) => (p + 1) % (cells + 4)), 90);
    return () => clearInterval(id);
  }, [cells, reducedMotion]);
  return (
    <div className="arc-bar" style={style} aria-hidden>
      {Array.from({ length: cells }, (_, i) => {
        // Reduced motion: a steady centered block instead of a sweep.
        const on = reducedMotion
          ? i >= Math.floor(cells / 2) - 2 && i < Math.floor(cells / 2) + 2
          : (() => { const d = pos - i; return d >= 0 && d < 4; })();
        return <div key={i} className={`arc-bar-cell ${on ? 'on' : ''}`} />;
      })}
    </div>
  );
}

/** MEMORY ▰▰▰▱▱-style stat row for the coworker detail panel. */
export function StatBar({
  label,
  value,
  max = 5,
  color,
  unknown = false,
}: {
  label: string;
  value: number;
  max?: number;
  color: string;
  unknown?: boolean;
}) {
  return (
    <div className="arc-stat-row">
      <span className="arc-stat-name">{label}</span>
      <span className="arc-stat-cells" aria-label={unknown ? `${label}: unknown` : `${label}: ${value} of ${max}`}>
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`arc-stat-cell ${i < value && !unknown ? 'on' : ''}`}
            style={i < value && !unknown ? { background: color, boxShadow: `0 0 6px ${color}66` } : undefined}
          >
            {unknown && (
              <span style={{ display: 'block', textAlign: 'center', fontSize: 8, lineHeight: '11px', color: 'var(--arc-dim)' }}>?</span>
            )}
          </span>
        ))}
      </span>
    </div>
  );
}
