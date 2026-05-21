import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { OrbitMorph } from '../components/ui';

// ── Boot choreography ───────────────────────────────────────────────────
//
// One single orb element travels through every phase. Putting two
// stacked orbs (idle + thinking) inside one container that we
// animate via CSS transforms means the user sees ONE coherent thing
// instead of five separate sprites swapping in and out.
//
//   loading    — server still spinning up. The orb is rendered in
//                its thinking state, scaled up (~1.5x ≈ 64px), and
//                translated horizontally to the centre of the
//                viewport. Sits at the vertical height the greeting
//                will eventually occupy.
//   collapsing — the orb scales down to ~6px (a "dot") in place.
//                State stays thinking — the satellite is still
//                spinning around its centre, just shrunk.
//   traveling  — the dot translates from viewport-centre to its
//                resting position on the left of where the greeting
//                will sit. Eased with a slight bounce so the move
//                reads as deliberate, not abrupt.
//   morphing   — at the resting position the dot scales back up
//                to its rest size (1×, 42px). The orb's state
//                crossfades from thinking to idle as the satellite
//                slows to its idle orbit.
//   typing     — typewriter — the greeting types out beside the
//                idle orb, one character at a time. No caret;
//                letters just appear.
//   settling   — composer + active list fade in below.
//   idle       — final home view. From here the existing
//                idle/thinking orb crossfade resumes based on
//                composer typing + active tasks.
//
// Failure paths (server help modal pop, settings redirect on
// config_ready=false) live in App.jsx so they fire once per app
// session, not once per HomeView remount.

const GREETING_FALLBACK = "Let's knock something off your list";

// Per-phase durations. Keep these short enough that the whole
// post-server choreography fits in ~3s — the user already waited
// for the server, the intro shouldn't pile on.
const COLLAPSE_MS  = 500;
const TRAVEL_MS    = 700;
const MORPH_MS     = 420;
const TYPE_PER_CHAR_MS = 22;
const TYPE_TAIL_MS = 380;       // pause after last char before settling
const SETTLE_MS    = 520;

// (Sizing for each visual layer is hard-coded in the JSX below —
// the big thinking orb is 64px, the dot is 10px, the idle orb is
// 42px. No constants extracted because each value is referenced
// exactly once.)

// One-shot keyframe injection — adds the boot fade rule once per
// page load, alongside the global `fadein-up` that already lives in
// styles/globals.css. (The earlier caret-blink keyframe was dropped
// when we removed the typewriter cursor in favour of letters
// appearing letter-by-letter beside the idle orb.)
let _BOOT_KEYFRAMES_INJECTED = false;
function _ensureBootKeyframes() {
  if (_BOOT_KEYFRAMES_INJECTED) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-home-boot-keyframes', '');
  style.textContent = `
@keyframes boot-fadein { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
`;
  document.head.appendChild(style);
  _BOOT_KEYFRAMES_INJECTED = true;
}

function useBootPhase({ serverOnline, configReady, greeting, skipIntro = false }) {
  // Phases: loading → collapsing → traveling → morphing → typing →
  //         settling → idle.
  //
  // Each transition lives in its OWN effect. Putting the trigger and
  // the next-phase timer into the same effect lets React's cleanup
  // cancel the not-yet-fired timer on phase change, freezing the
  // choreography mid-step (the symptom: orb shrinks and never moves).
  // Splitting them keeps each timer's lifecycle aligned with the
  // phase it advances out of.
  //
  // skipIntro lets the host bypass the choreography entirely.
  // App.jsx sets it true after the backend has been online once, so
  // subsequent home mounts (clicking "New task", navigating back from
  // a project, etc.) open straight at 'idle'.
  const [phase, setPhase] = useState(() => skipIntro ? 'idle' : 'loading');
  const [typedCount, setTypedCount] = useState(0);

  // 'loading' → 'collapsing' — reactive trigger, no timer.
  useEffect(() => {
    if (phase !== 'loading') return undefined;
    if (!serverOnline) return undefined;
    if (configReady === false) return undefined;
    setPhase('collapsing');
    return undefined;
  }, [phase, serverOnline, configReady]);

  // 'collapsing' → 'traveling' — pure-timer.
  useEffect(() => {
    if (phase !== 'collapsing') return undefined;
    const t = setTimeout(() => setPhase('traveling'), COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // 'traveling' → 'morphing' — pure-timer.
  useEffect(() => {
    if (phase !== 'traveling') return undefined;
    const t = setTimeout(() => setPhase('morphing'), TRAVEL_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // 'morphing' → 'typing' — pure-timer.
  useEffect(() => {
    if (phase !== 'morphing') return undefined;
    const t = setTimeout(() => setPhase('typing'), MORPH_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // 'typing' — per-char timer + tail pause + advance to 'settling'.
  useEffect(() => {
    if (phase !== 'typing') return undefined;
    const target = greeting || GREETING_FALLBACK;
    if (typedCount >= target.length) {
      const t = setTimeout(() => setPhase('settling'), TYPE_TAIL_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setTypedCount((n) => n + 1), TYPE_PER_CHAR_MS);
    return () => clearTimeout(t);
  }, [phase, typedCount, greeting]);

  useEffect(() => {
    if (phase !== 'typing') setTypedCount(0);
  }, [phase]);

  // 'settling' → 'idle' — pure-timer.
  useEffect(() => {
    if (phase !== 'settling') return undefined;
    const t = setTimeout(() => setPhase('idle'), SETTLE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  return { phase, typedCount };
}


// Measure how far the orb's natural rest position sits from the
// horizontal centre of the home view's CONTENT AREA (not the window
// viewport — the home view sits in a column to the right of the
// sidebar, so window-centre is left-of-content-centre and the orb
// would land off-axis on a sidebar-open layout).
//
// The orb is always rendered in its rest position in flow; the
// transform applied by HomeView shifts it to that content-centre
// during boot phases. Re-measure on resize so a window-drag while
// the boot animation is mid-flight still finishes at the right
// place.
function useOrbCenterOffset(orbRef, containerRef) {
  const [offset, setOffset] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const orbNode = orbRef.current;
      const ctrNode = containerRef.current;
      if (!orbNode || !ctrNode) return;
      // Strip any in-flight transform on the orb before measuring so
      // we always capture the rest-position rect, not the currently-
      // animated one. The next render reapplies whatever transform
      // the phase demands.
      const prev = orbNode.style.transform;
      orbNode.style.transform = '';
      const orbRect = orbNode.getBoundingClientRect();
      orbNode.style.transform = prev;
      const ctrRect = ctrNode.getBoundingClientRect();
      const orbCenterX = orbRect.left + orbRect.width / 2;
      const ctrCenterX = ctrRect.left + ctrRect.width / 2;
      setOffset(ctrCenterX - orbCenterX);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [orbRef, containerRef]);
  return offset;
}


function ActiveList({ tasks, onSelect, onClear }) {
  if (!tasks.length) return null;
  return (
    <div style={{ width: '100%', maxWidth: 640, marginTop: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--frost-700)', letterSpacing: '0.02em' }}>Active</div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClear}
          style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--frost-600)' }}
          onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-strong)')}
          onMouseOut={(e) => (e.currentTarget.style.color = 'var(--frost-600)')}
        >Clear active</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            className="task-row"
            onClick={() => onSelect(t.id)}
            aria-label={t.title}
            style={{
              // Reset default <button> chrome so the row visually matches
              // the prior <div> layout. Using <button> is required so the
              // global `button { -webkit-app-region: no-drag }` rule takes
              // effect — without it, the window-shell's outer drag region
              // swallows mousedown and the onClick never fires.
              border: 0,
              background: 'transparent',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
              width: '100%',
            }}
          >
            <span
              className="pulse-dot"
              style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--primary-400)', marginTop: 7 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-strong)' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--frost-600)', marginTop: 2 }}>{t.subtitle}</div>
            </div>
            <span style={{ display: 'inline-flex', color: 'var(--frost-500)', marginTop: 4 }}>{Ico.chevRight(14)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


export default function HomeView({
  greeting, showDots,
  activeTasks, onSelectTask, onClearActive,
  onSend, project, onProjectChange, model, onModelChange, projects, models,
  attachments, connectors, onAttachFiles, onRemoveAttachment,
  disabledConnections = [],
  onUpdateConnectorMute,
  onCreateProject,
  configReady, configError, onOpenSettings,
  serverOnline = false, onShowServerHelp,
  skipIntro = false,
}) {
  useEffect(() => { _ensureBootKeyframes(); }, []);

  const greetingText = greeting || GREETING_FALLBACK;
  const blocked = configReady === false;

  const { phase, typedCount } = useBootPhase({
    serverOnline, configReady,
    greeting: greetingText,
    skipIntro,
  });

  // Idle-phase orb crossfade — driven by composer typing + active
  // tasks. Two stacked OrbitMorph instances (idle + thinking) with
  // opposing opacity transitions read as one orb morphing between
  // states. While the boot choreography is running we override these
  // (thinking is forced on through the early phases, idle for later).
  const [isTyping, setIsTyping] = useState(false);
  const wantsThinking = isTyping || (activeTasks && activeTasks.length > 0);

  const orbRef = useRef(null);
  // Centre-offset is measured against this container — the home view's
  // outer column. Sidebar-aware: the orb lines up with the visual
  // centre of what the user sees as "the new task screen", not the
  // raw window centre.
  const homeRef = useRef(null);
  const centerOffsetX = useOrbCenterOffset(orbRef, homeRef);

  // The orb container only TRANSLATES during boot — scale-down /
  // scale-up live on the individual visual layers below so the user
  // sees a clearly-visible solid dot during the travel phase
  // (instead of a barely-perceptible scaled-down OrbitMorph). Layers:
  //
  //   1. BigThinking — the 64px thinking orb the surface boots into.
  //      Fades + scales down during 'collapsing' so it visually
  //      "shrinks into" the dot.
  //   2. Dot — a small solid circle (10px). Fades in at the end of
  //      'collapsing', stays visible through 'traveling' (so the
  //      travel from centre → rest position has something for the
  //      eye to follow), fades out during 'morphing'.
  //   3. IdleOrb — the 42px idle/thinking stack the home view ends
  //      on. Fades in + scales up from the dot during 'morphing'.
  const isCentered = phase === 'loading' || phase === 'collapsing';
  const isEarlyBoot = phase === 'loading' || phase === 'collapsing' || phase === 'traveling';

  // Wait for the centre offset measurement before applying any
  // boot-phase translation; otherwise the very first paint shows the
  // orb at rest position momentarily before snapping to centre.
  const orbReady = centerOffsetX != null || skipIntro;
  const orbTranslateX = (isCentered && orbReady)
    ? (centerOffsetX || 0)
    : 0;

  // Per-phase transition for the container's translate.
  const orbTransition = (() => {
    if (phase === 'collapsing') {
      return `transform ${COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }
    if (phase === 'traveling') {
      // Slight overshoot so the dot lands with a touch of bounce.
      return `transform ${TRAVEL_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
    }
    return 'transform 320ms cubic-bezier(0.4, 0, 0.2, 1)';
  })();

  // ── Per-layer opacity / scale ──
  const bigThinkingOpacity = (phase === 'loading') ? 1 : 0;
  const bigThinkingScale   = (phase === 'loading') ? 1 : 0.18;

  const dotOpacity = (phase === 'collapsing' || phase === 'traveling') ? 1 : 0;

  // The idle layer scales from 0.18 (dot-sized) to 1.0 during morph
  // so it visually "grows out of" the dot's last position. Stays at
  // scale 1 for typing/settling/idle.
  const idleLayerOpacity = (phase === 'morphing' || phase === 'typing'
    || phase === 'settling' || phase === 'idle') ? 1 : 0;
  const idleLayerScale = idleLayerOpacity ? 1 : 0.18;

  // Within the idle layer, crossfade between idle and thinking
  // OrbitMorph instances based on runtime activity. Pre-morphing
  // the idle layer is invisible anyway, so these only matter once
  // we're past 'morphing'.
  const inIdleWithActivity = phase === 'idle' && wantsThinking;
  const idleOpacity      = inIdleWithActivity ? 0 : 1;
  const thinkingOpacity  = inIdleWithActivity ? 1 : 0;

  // Greeting text visibility. Hidden during loading/collapsing/
  // traveling/morphing (orb hasn't settled yet); typewrites during
  // 'typing'; full opacity during settling/idle.
  const showText = phase === 'typing' || phase === 'settling' || phase === 'idle';
  const typedText = (phase === 'typing')
    ? greetingText.slice(0, typedCount)
    : greetingText;

  // Composer fades in during 'settling' and stays for 'idle'.
  const showInteractiveSurface = phase === 'settling' || phase === 'idle';

  return (
    <div
      ref={homeRef}
      style={{
        flex: 1, overflow: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '0 40px 60px',
        background: 'transparent',
      }}
    >
      <h1 className="home-greeting-row" style={{
        fontFamily: 'var(--font-display)',
        fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em',
        color: 'var(--text-strong)',
        margin: '0 0 28px',
        width: '100%', maxWidth: 'var(--composer-max-width, 640px)',
        // Always flex-start. The orb stays at its REST flow position
        // (marginLeft: -58) and is moved visually via translateX
        // during the boot phases — same DOM element throughout, no
        // justifyContent snap to cover with a fade.
        display: 'flex', alignItems: 'center', gap: 16,
        justifyContent: 'flex-start',
      }}>
        <span
          ref={orbRef}
          className="home-orb"
          style={{
            position: 'relative',
            width: 42, height: 42,
            flexShrink: 0, marginLeft: -58,
            // inline-flex (rather than inline-block) keeps the
            // element out of the inline baseline-alignment system
            // — under a transform, inline-block can shift a couple
            // pixels relative to the surrounding text. The actual
            // visual layers below are absolutely-positioned, so the
            // alignItems/justifyContent on this container don't
            // affect them; they're here for the OUTER vertical
            // alignment with the greeting text.
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            // Container only translates (left → centre during boot,
            // back to rest during travel). All scale-up / scale-down
            // visual work happens on the layers inside. Identity
            // transform → 'none' so we don't create a stacking
            // context when it isn't needed.
            transform: (orbTranslateX === 0)
              ? 'none'
              : `translateX(${orbTranslateX}px)`,
            // Orb is hidden (opacity 0) until the centre-offset
            // measurement lands — without this the very first paint
            // shows the rest-position orb before snapping to centre.
            opacity: orbReady ? 1 : 0,
            transition: `${orbTransition}, opacity 200ms ease-out`,
            willChange: isEarlyBoot ? 'transform' : 'auto',
          }}
        >
          {/* 1) Big thinking orb — booted-into state. Fades + shrinks
                 during 'collapsing' so the visual reads as "the orb
                 collapsed into the dot below." */}
          <span style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 64, height: 64,
            pointerEvents: 'none',
            transform: `translate(-50%, -50%) scale(${bigThinkingScale})`,
            opacity: bigThinkingOpacity,
            transition: `opacity ${COLLAPSE_MS}ms ease-out, transform ${COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}>
            <OrbitMorph size={64} state="thinking" />
          </span>

          {/* 2) The dot. Solid accent circle, 10px. Visible during
                 collapsing (fades in as the big orb shrinks),
                 traveling (the eye follows it from centre to rest),
                 and the start of morphing (fades out as the idle
                 orb scales up over it). */}
          <span aria-hidden style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 55%, transparent)',
            transform: 'translate(-50%, -50%)',
            opacity: dotOpacity,
            transition: 'opacity 320ms ease-in-out',
            pointerEvents: 'none',
          }} />

          {/* 3) Idle/thinking orb stack — the resting visual. Scales
                 up from the dot during 'morphing' (so the dot
                 visibly evolves into the orb), then stays at full
                 size for typing → idle, with the existing
                 idle/thinking activity crossfade. */}
          <span style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 42, height: 42,
            pointerEvents: 'none',
            transform: `translate(-50%, -50%) scale(${idleLayerScale})`,
            opacity: idleLayerOpacity,
            transition: `opacity ${MORPH_MS}ms ease-out, transform ${MORPH_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
          }}>
            <OrbitMorph
              size={42}
              state="idle"
              style={{
                position: 'absolute', inset: 0,
                opacity: idleOpacity,
                transition: 'opacity 800ms ease-in-out',
              }}
            />
            <OrbitMorph
              size={42}
              state="thinking"
              style={{
                position: 'absolute', inset: 0,
                opacity: thinkingOpacity,
                transition: 'opacity 800ms ease-in-out',
              }}
            />
          </span>
        </span>
        {showText && (
          <span style={{
            // The typed substring (or full text once we're past
            // 'typing'). No caret — letters just appear next to the
            // orb, one per tick. The wrapping span fades in subtly
            // so the first character doesn't pop.
            opacity: 1,
            animation: phase === 'typing'
              ? 'boot-fadein 200ms ease-out both'
              : undefined,
          }}>{typedText}</span>
        )}
      </h1>

      {/* Composer + active list. Mounted from 'settling' onward; the
          fade-in animation only plays on first mount (when phase
          flips from morphing to settling). On 'idle' they're already
          present at full opacity. */}
      {showInteractiveSurface && (
        <div style={{
          width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          animation: 'boot-fadein 500ms ease-out both',
        }}>
          {blocked ? (
            <div style={{
              width: '100%', maxWidth: 640,
              background: 'var(--surface-0)',
              border: '1px solid var(--border-01)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-sm)',
              padding: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}>
              <span style={{
                width: 36, height: 36, borderRadius: 9,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--primary-50)', color: 'var(--primary-700)', flexShrink: 0,
              }}>{Ico.key(18)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>Configure Anton before starting</div>
                <div style={{ fontSize: 12.5, color: 'var(--frost-700)', marginTop: 3 }}>{configError || 'Anton needs a provider and API key before it can answer.'}</div>
              </div>
              <button className="btn-primary" onClick={onOpenSettings}>Settings</button>
            </div>
          ) : (
            <Composer
              onSend={onSend}
              project={project}
              onProjectChange={onProjectChange}
              model={model}
              onModelChange={onModelChange}
              projects={projects}
              models={models}
              attachments={attachments}
              connectors={connectors}
              onAttachFiles={onAttachFiles}
              onRemoveAttachment={onRemoveAttachment}
              disabledConnections={disabledConnections}
              onUpdateConnectorMute={onUpdateConnectorMute}
              onCreateProject={onCreateProject}
              hideModel
              onTypingChange={setIsTyping}
            />
          )}
          <ActiveList tasks={activeTasks} onSelect={onSelectTask} onClear={onClearActive} />
        </div>
      )}
    </div>
  );
}
