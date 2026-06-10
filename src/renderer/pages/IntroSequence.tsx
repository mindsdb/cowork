// Pre-terms intro animation. Plays every launch until the user
// accepts the terms screen — App.tsx gates entry on the same env
// flag, so once consent is recorded we never re-enter this page.
//
//   Stage 1 (3 s)     Solid blue wash. A dot at centre expands into
//                     the idle OrbitMorph while the blue fades to
//                     transparent, revealing the body-level gravity
//                     mesh underneath.
//   Stage 2 (1 s)     Cross-fade: thinking orb fades in superposed
//                     on the idle orb; idle fades out.
//   Stage 3 (3 s)     Hold on the thinking orb (its own morph cycle
//                     keeps animating).
//   Stage 4 (1 s)     Cross-fade back: idle in, thinking out.
//   Stage 5 (~0.8 s)  Idle orb collapses to a dot at centre.
//   Stage 6 (~0.4 s)  Dot stretches into a typing caret.
//   Stage 7 (~3.4 s)  Caret types "Welcome to Minds Cowork".
//   Stage 8 (~0.7 s)  Fade out, hand off to onComplete.
//
// No visible skip affordance — the page plays through. Esc remains
// wired as an undocumented dev escape hatch.

import { useEffect, useRef, useState } from 'react';
import OrbitMorph from '../cowork/components/ui/OrbitMorph';

const TITLE = 'Welcome to Minds Cowork';
const SUBTITLE = '';

// Cinematic deep navy. Any "blue" reads here; this one sits a hair
// darker than the dark theme's body bg so the fade-out doesn't pop
// when the gravity mesh swaps in.
const BLUE = '#0A1F3D';

// Both stacked orbs run on this orbit period so their satellites
// stay aligned through the cross-fade. We pick idle's natural pace
// (4500 ms) so the calmer rhythm wins; the thinking orb's central
// chaos→pyramid→dot→cube morph still runs at its own faster cadence.
const INTRO_ORBIT_PERIOD = 4500;

const T = {
  dotIn:        700,    // dot scale-up to full idle orb
  bgFade:       1800,   // blue → gravity mesh
  orbIn:        2000,   // total stage-1 duration (dotIn + a brief hold)
  crossFade:    1000,   // each idle⇄thinking cross-fade
  thinkingHold: 3000,
  collapse:     800,
  dotMorph:     400,
  typeChar:     95,
  typeGap:      320,
  hold:         1400,
  fadeOut:      700,
};

type Phase =
  | 'orbIn'
  | 'crossToThinking'
  | 'thinkingHold'
  | 'crossToIdle'
  | 'collapse'
  | 'cursorMorph'
  | 'typing'
  | 'fadeout';

// Per-phase opacity for the two stacked OrbitMorph instances.
// The CSS opacity transition handles the actual cross-fade timing.
function orbOpacities(phase: Phase): { idle: number; thinking: number } {
  switch (phase) {
    case 'crossToThinking':
    case 'thinkingHold':
      return { idle: 0, thinking: 1 };
    default:
      return { idle: 1, thinking: 0 };
  }
}

export default function IntroSequence({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>('orbIn');
  const [titleTyped, setTitleTyped] = useState('');
  const [subTyped, setSubTyped] = useState('');
  // Drives both the dot-in expansion (0.04 → 1) and the final
  // collapse (1 → 0.04). Initial value is the starting dot.
  const [orbScale, setOrbScale] = useState(0.04);
  // Blue wash starts opaque, fades to 0 to reveal the gravity mesh.
  const [blueOpacity, setBlueOpacity] = useState(1);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Idempotent finish — the timer chain and the dev Esc handler can
  // both call it; whichever wins, we hand off only once.
  const finishedRef = useRef(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCompleteRef.current?.();
  };

  // Kick off the dot-in expansion and the blue fade-out on the
  // first paint after mount — needs the rAF tick so the initial
  // values render before the transitions fire.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setOrbScale(1);
      setBlueOpacity(0);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Collapse phase shrinks the orb back to a dot.
  useEffect(() => {
    if (phase === 'collapse') setOrbScale(0.04);
  }, [phase]);

  // Master timeline — all delays scheduled up-front so phase ordering
  // and per-character reveals stay in lock-step.
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const after = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => { if (!cancelled) fn(); }, ms);
      timers.push(id);
    };

    let t = T.orbIn;
    after(t, () => setPhase('crossToThinking'));
    t += T.crossFade;
    after(t, () => setPhase('thinkingHold'));
    t += T.thinkingHold;
    after(t, () => setPhase('crossToIdle'));
    t += T.crossFade;
    after(t, () => setPhase('collapse'));
    t += T.collapse;
    after(t, () => setPhase('cursorMorph'));
    t += T.dotMorph;
    after(t, () => setPhase('typing'));

    const typingStart = t;
    for (let i = 0; i < TITLE.length; i += 1) {
      const at = typingStart + (i + 1) * T.typeChar;
      after(at, () => setTitleTyped(TITLE.slice(0, i + 1)));
    }
    const titleDoneAt = typingStart + TITLE.length * T.typeChar;

    // Skip the inter-line pause + subtitle scheduling entirely when
    // there's no subtitle; otherwise the hold drags on after the
    // title is already complete.
    let typingDoneAt = titleDoneAt;
    if (SUBTITLE.length > 0) {
      const subStart = titleDoneAt + T.typeGap;
      for (let i = 0; i < SUBTITLE.length; i += 1) {
        const at = subStart + (i + 1) * T.typeChar;
        after(at, () => setSubTyped(SUBTITLE.slice(0, i + 1)));
      }
      typingDoneAt = subStart + SUBTITLE.length * T.typeChar;
    }

    after(typingDoneAt + T.hold, () => setPhase('fadeout'));
    after(typingDoneAt + T.hold + T.fadeOut, finish);

    return () => {
      cancelled = true;
      timers.forEach((id) => clearTimeout(id));
    };
  }, []);

  // Esc remains as a dev escape hatch only — no visible affordance.
  // Click and Enter/Space are intentionally NOT handled so users
  // experience the full sequence.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const opacities = orbOpacities(phase);
  const orbVisible = phase === 'orbIn'
    || phase === 'crossToThinking'
    || phase === 'thinkingHold'
    || phase === 'crossToIdle'
    || phase === 'collapse';
  const morphVisible = phase === 'cursorMorph';
  const textVisible = phase === 'typing' || phase === 'fadeout';

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'grid', placeItems: 'center',
        color: 'var(--ink, #f3f5f7)',
        userSelect: 'none',
        opacity: phase === 'fadeout' ? 0 : 1,
        transition: `opacity ${T.fadeOut}ms ease`,
        WebkitAppRegion: 'drag' as any,
        background: 'transparent',
      }}
    >
      {/* Blue wash — fades out to reveal the body-level gravity mesh
          (mounted on <body> at z-index:0 by index.html). */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: BLUE,
          opacity: blueOpacity,
          transition: `opacity ${T.bgFade}ms ease`,
          pointerEvents: 'none',
        }}
      />

      {/* Stage — fixed-size container so layout stays put as the orb
          collapses and the text fades in in its place. */}
      <div style={{
        position: 'relative',
        width: 360, height: 280,
        display: 'grid', placeItems: 'center',
      }}>
        {/* Orb stack — outer wrapper handles dot-in scale + collapse;
            two stacked OrbitMorph instances handle the cross-fade. */}
        {orbVisible && (
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'grid', placeItems: 'center',
              transform: `scale(${orbScale})`,
              transition: phase === 'collapse'
                ? `transform ${T.collapse}ms cubic-bezier(0.32, 0.72, 0, 1)`
                : `transform ${T.dotIn}ms cubic-bezier(0.32, 0.72, 0, 1)`,
              willChange: 'transform',
            }}
          >
            {/* Both orbs share an orbit period so their satellites
                land at the same point on the ring throughout the
                cross-fade — otherwise idle (4500 ms) and thinking
                (1400 ms) drift apart and the user sees two satellites
                at once during the 1 s overlap. The morph cycle inside
                each orb is unaffected. */}
            <div style={{
              position: 'absolute',
              opacity: opacities.idle,
              transition: `opacity ${T.crossFade}ms ease`,
            }}>
              <OrbitMorph state="idle" size={180} orbitPeriodMs={INTRO_ORBIT_PERIOD} />
            </div>
            <div style={{
              position: 'absolute',
              opacity: opacities.thinking,
              transition: `opacity ${T.crossFade}ms ease`,
            }}>
              <OrbitMorph state="thinking" size={180} orbitPeriodMs={INTRO_ORBIT_PERIOD} />
            </div>
          </div>
        )}

        {/* Cursor morph — a dot that stretches into a caret. Hands
            off from the collapsed orb's centre point. */}
        {morphVisible && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%', top: '50%',
              animation: `intro-dot-to-caret ${T.dotMorph}ms cubic-bezier(0.32, 0.72, 0, 1) both`,
              background: 'var(--accent, #1f9cb0)',
            }}
          />
        )}

        {/* Typed title + subtitle.
            The title is anchored to the stage's vertical center —
            i.e. the exact spot where the orb collapsed and the
            cursor materialised — so it lands on the cursor and
            stays put. The subtitle is positioned absolutely below
            the title's bottom edge, so when it types in it extends
            downward instead of pushing the title up. Both rows have
            locked heights so caret swaps don't cause sub-pixel jitter. */}
        {textVisible && (
          <div
            style={{
              position: 'absolute', inset: 0,
              animation: `intro-fade-up 320ms ease both`,
              textAlign: 'center',
            }}
          >
            <h1 style={{
              position: 'absolute',
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              margin: 0,
              fontFamily: 'var(--font-display, "Josefin Sans", system-ui, sans-serif)',
              fontWeight: 700, fontSize: 44, letterSpacing: '-0.01em',
              color: 'var(--ink, #f3f5f7)',
              height: 56, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              whiteSpace: 'nowrap',
            }}>
              <span>{titleTyped}</span>
              {!subTyped && <Caret />}
            </h1>
            {SUBTITLE.length > 0 && (
              <div style={{
                position: 'absolute',
                left: '50%',
                // Title is 56 px tall and centred on the stage's
                // vertical midline → its bottom sits at midline + 28.
                // 16 px of breathing room below = midline + 44.
                top: 'calc(50% + 44px)',
                transform: 'translateX(-50%)',
                fontFamily: 'var(--font-display, "Josefin Sans", system-ui, sans-serif)',
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: '-0.005em',
                color: 'var(--ink, #f3f5f7)',
                height: 30, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                whiteSpace: 'nowrap',
              }}>
                <span>{subTyped}</span>
                {subTyped && <Caret />}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes intro-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes intro-caret-blink {
          0%, 49%   { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes intro-dot-to-caret {
          0%   { width: 8px;  height: 8px;  border-radius: 50%; transform: translate(-50%, -50%); }
          60%  { width: 4px;  height: 14px; border-radius: 4px; transform: translate(-50%, -50%); }
          100% { width: 2px;  height: 38px; border-radius: 1px; transform: translate(-50%, -50%); }
        }
      `}</style>
    </div>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 2, height: '0.92em',
        background: 'var(--accent, #1f9cb0)',
        marginLeft: 4,
        animation: 'intro-caret-blink 1s steps(1) infinite',
        alignSelf: 'baseline',
        transform: 'translateY(0.12em)',
      }}
    />
  );
}
