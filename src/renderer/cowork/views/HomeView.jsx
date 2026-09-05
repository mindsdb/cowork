import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import TaskModePills from '../components/taskmodes/TaskModePills';
import TaskModeSamples from '../components/taskmodes/TaskModeSamples';
import { composeModeMessage } from '../components/taskmodes/taskModes';
import { completeStep } from '../components/onboarding/onboardingStore';
import { HABIT_TRACKER_PREFIX } from '../components/onboarding/steps';
import { OrbitMorph, Button } from '../components/ui';
import { host } from '../../platform/host';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { trackBillingOpened } from '../lib/analytics';

// Boot animates through loading, collapsing, traveling, morphing, typing, settling, then idle.
// App.jsx owns boot failures so help/redirects fire once per session instead of on every HomeView
// mount.

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



function useBootPhase({ serverOnline, configReady, greeting, skipIntro = false }) {
  // Give each phase transition its own effect; combining trigger and timer lets phase-change
  // cleanup cancel
  // the next transition. skipIntro bypasses animation on later Home mounts.
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


// Measure the orb’s rest position relative to the content column, not the sidebar-inclusive window.
// Recompute on resize so an in-progress animation still reaches the correct destination.
function useOrbCenterOffset(orbRef, containerRef) {
  const [offset, setOffset] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const orbNode = orbRef.current;
      const ctrNode = containerRef.current;
      if (!orbNode || !ctrNode) return;
      // Temporarily remove the animated transform to measure the rest position.
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
        <Button variant="subtle" onClick={onClear}>Clear active</Button>
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
              // Use a button so the global no-drag rule allows clicks inside Electron’s window drag
              // region.
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
              style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--accent)', marginTop: 7 }}
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
  onSend, project, onProjectChange, model, onModelChange, effort, onEffortChange, projects, models, modelMeta,
  attachments, connectors, onAttachFiles, onRemoveAttachment,
  onAddGoogleDriveFiles,
  disabledConnections = [],
  onUpdateConnectorMute,
  onNavigateToConnectors,
  onCreateProject,
  configReady, configError, onOpenSettings,
  serverOnline = false, onShowServerHelp,
  skipIntro = false,
  agentLabel,
  prefill = null,
  // Fills the composer without sending — task-mode sample prompts (ENG-1594)
  // and any other surface that pre-drafts text route through this.
  onPrefill,
  codingModeEnabled = false,
  codingModelDefault,
  harnessHermesEnabled,
  harnessClaudeCodeEnabled,
}) {
  const greetingText = greeting || GREETING_FALLBACK;
  const blocked = configReady === false;

  // Selected task mode (ENG-1594). Null = default view (pill row visible).
  // Owns the composer placeholder, the toolbar chip, and the sample list.
  const [taskMode, setTaskMode] = useState(null);

  // Clear task-mode scaffolding when entering Coding Mode so a hidden selection cannot affect the
  // send.
  useEffect(() => {
    if (codingModeEnabled) setTaskMode(null);
  }, [codingModeEnabled]);

  // Detect onboarding sends regardless of how text was entered. Append mode instructions after user
  // text
  // so titles/search retain the prompt head; preserve meta and clear mode only after successful
  // send.
  const sendTracked = async (text, meta) => {
    if (typeof text === 'string' && text.trim().startsWith(HABIT_TRACKER_PREFIX)) {
      completeStep('see-it-work');
    }
    const result = await onSend(composeModeMessage(taskMode, text), meta);
    setTaskMode(null);
    return result;
  };

  const { phase, typedCount } = useBootPhase({
    serverOnline, configReady,
    greeting: greetingText,
    skipIntro,
  });

  const [isTyping, setIsTyping] = useState(false);
  const wantsThinking = isTyping || (activeTasks && activeTasks.length > 0);

  const orbRef = useRef(null);
  const homeRef = useRef(null);
  const centerOffsetX = useOrbCenterOffset(orbRef, homeRef);

  // Translate the container and scale separate visual layers; a solid travel dot stays visible
  // where a shrunken orb would not.
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
        // Use 36px between the type ladder’s 28px and 44px: it balances the 42px orb without
        // wrapping the greeting.
        fontFamily: 'var(--font-display)',
        fontSize: 36, fontWeight: 600, letterSpacing: '-0.004em',
        color: 'var(--text-strong)',
        margin: '0 0 28px',
        width: '100%', maxWidth: 'var(--composer-max-width, 640px)',
        // Keep the rest position in flow and animate translation, avoiding layout snaps during
        // boot.
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
            // inline-flex avoids transformed inline-block baseline shifts against the greeting.
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            // Use none for zero translation to avoid an unnecessary stacking context; scale the
            // inner layers independently.
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
            opacity: 1,
            animation: phase === 'typing'
              ? 'boot-fadein 200ms ease-out both'
              : undefined,
          }}>{typedText}</span>
        )}
      </h1>

      {showInteractiveSurface && (
        <div style={{
          width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          animation: 'boot-fadein 500ms ease-out both',
        }}>
          {blocked ? (
            <div className="home-connect-card">
              <span style={{
                width: 36, height: 36, borderRadius: 9,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--primary-50)', color: 'var(--primary-700)', flexShrink: 0,
              }}>{Ico.key(18)}</span>
              <div className="home-connect-card__body">
                <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>Connect a provider to start chatting</div>
                <div style={{ fontSize: 12.5, color: 'var(--frost-700)', marginTop: 3 }}>Start with MindsHub and get free monthly tokens on MindsHub Air, then pay as you go. Or add your own API key (Anthropic, OpenAI, or any OpenAI-compatible endpoint) in Settings.</div>
              </div>
              <div className="home-connect-card__actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    // Same card, same trigger as ChatView's provider_required
                    // (ENG-1533) — one surface reached two ways, so the two must
                    // not read as different causes in the funnel.
                    trackBillingOpened('connect_provider');
                    host.openExternal(MINDS_BILLING_URL);
                  }}
                >Start for free</Button>
                <Button
                  variant="primary"
                  onClick={() => onOpenSettings?.('agent')}
                  style={{ background: 'transparent', color: 'var(--primary-700)', border: '1px solid var(--primary-700)' }}
                >Open Settings</Button>
              </div>
            </div>
          ) : (
            <Composer
              onSend={sendTracked}
              placeholder={taskMode ? taskMode.placeholder : undefined}
              taskMode={taskMode}
              onClearTaskMode={() => setTaskMode(null)}
              prefill={prefill}
              project={project}
              onProjectChange={onProjectChange}
              model={model}
              onModelChange={onModelChange}
              effort={effort}
              onEffortChange={onEffortChange}
              projects={projects}
              models={models}
              modelMeta={modelMeta}
              attachments={attachments}
              connectors={connectors}
              onNavigateToConnectors={onNavigateToConnectors}
              onAttachFiles={onAttachFiles}
              onAddGoogleDriveFiles={onAddGoogleDriveFiles}
              onRemoveAttachment={onRemoveAttachment}
              disabledConnections={disabledConnections}
              onUpdateConnectorMute={onUpdateConnectorMute}
              onCreateProject={onCreateProject}
              onTypingChange={setIsTyping}
              codingModeEnabled={codingModeEnabled}
              onOpenSettings={onOpenSettings}
              codingModelDefault={codingModelDefault}
              harnessHermesEnabled={harnessHermesEnabled}
              harnessClaudeCodeEnabled={harnessClaudeCodeEnabled}
              sendsMeta
            />
          )}
          {/*
 * A zero-height wrapper keeps changing suggestions/tasks from shifting the centered composer.
 * Visible descendant overflow remains scrollable.
 */}
          <div style={{
            width: '100%', height: 0, overflow: 'visible',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            {/*
 * Show samples only with a prefill handler and outside Coding Mode, where their scaffolding does
 * not apply.
 */}
            {!blocked && !codingModeEnabled && (
              taskMode
                ? (onPrefill && <TaskModeSamples mode={taskMode} onPick={onPrefill} />)
                : <TaskModePills onPick={setTaskMode} />
            )}
            <ActiveList tasks={activeTasks} onSelect={onSelectTask} onClear={onClearActive} />
          </div>
        </div>
      )}
    </div>
  );
}
