import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import TaskModePills from '../components/taskmodes/TaskModePills';
import TaskModeSamples from '../components/taskmodes/TaskModeSamples';
import { modeMessage, findSampleByPrompt, resemblesSample, FEATURED_EXAMPLES_MODE, OWN_WORK_MODE, composeOwnWorkMessage, hasOwnMaterial, ownWorkJobIn } from '../components/taskmodes/taskModes';
import OwnWorkPanel from '../components/taskmodes/OwnWorkPanel';
import { completeStepTracked } from '../components/onboarding/track';
import { stepsCompletedBySend } from '../components/onboarding/completion';
import { OrbitMorph, Button } from '../components/ui';
import { host } from '../../platform/host';
import { PLATFORM_UI } from '../../lib/deployment';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { useConsoleLink } from '../hooks/useConsoleLink';
import { billingCopyKey, offersBilling } from '../lib/billingLinks';
import { trackBillingOpened, setEntryAttribution, trackComposerReady, trackExamplePicked, trackSignupLanded } from '../lib/analytics';
import {
  takeConsoleHandoff, peekConsoleHandoff, markConsoleHandoffRecorded, sampleId, isUntouchedSample, OWN_WORK_START,
  RETIRED_PROMPTS,
} from '../lib/consoleHandoff';
import { takeSignupWelcome, SIGNUP_FROM_DESKTOP } from '../lib/signupWelcome';
import { productName } from '../../lib/deploymentBrand';
import { getDraft, setDraft } from '../lib/draftStore';
import { sendsAtOnce } from '../components/gallery/galleryRules';
import i18n, { useTranslation } from '../../lib/i18n';

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

// The greeting shown when the host passes none; translated when needed.
const greetingFallback = () => i18n.t('home.greetingFallback', { ns: 'shell' });

// Per-phase durations. Keep these short enough that the whole
// post-server choreography fits in ~3s — the user already waited
// for the server, the intro shouldn't pile on.
const COLLAPSE_MS  = 500;
const TRAVEL_MS    = 700;
const MORPH_MS     = 420;
const TYPE_PER_CHAR_MS = 22;
const TYPE_TAIL_MS = 380;       // pause after last char before settling
const SETTLE_MS    = 520;
const CROSSFADE_MS = 800;
// How long the connect-a-provider panel must hold before a console arrival is
// recorded as blocked.
const BLOCKED_ARRIVAL_SETTLE_MS = 5000;

// (Sizing for each visual layer is hard-coded in the JSX below —
// the big thinking orb is 64px, the dot is 10px, the idle orb is
// 42px. No constants extracted because each value is referenced
// exactly once.)

// `boot-fadein` lives in globals.css alongside the global `fadein-up`
// (and every other keyframe in the app). (The earlier caret-blink
// keyframe was dropped when we removed the typewriter cursor in favour
// of letters appearing letter-by-letter beside the idle orb.)

// A hidden orb keeps moving while it fades out and pauses once the fade
// is over; it resumes at once when shown again.
function usePauseAfterFade(hidden, fadeMs) {
  const [faded, setFaded] = useState(hidden);
  useEffect(() => {
    if (!hidden) {
      setFaded(false);
      return undefined;
    }
    const timer = setTimeout(() => setFaded(true), fadeMs);
    return () => clearTimeout(timer);
  }, [hidden, fadeMs]);
  return hidden && faded;
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
    const target = greeting || greetingFallback();
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
  const { t } = useTranslation('shell');
  if (!tasks.length) return null;
  return (
    <div className="w-full max-w-[640px] mt-9">
      <div className="flex items-center mb-2 py-0 px-1">
        <div className="text-[12px] font-semibold text-[var(--frost-700)] tracking-[0.02em]">{t('home.active')}</div>
        <div className="flex-1" />
        <Button variant="subtle" onClick={onClear}>{t('home.clearActive')}</Button>
      </div>
      <div className="flex flex-col gap-[2px]">
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            // <button> (not <div>) so the global `button { -webkit-app-region:
            // no-drag }` rule fires — otherwise the window-shell drag region
            // swallows mousedown. The utilities below reset the button chrome so
            // it matches the prior <div> layout; `.task-row` owns the rest.
            className="task-row border-0 bg-transparent text-left font-[inherit] text-inherit w-full"
            onClick={() => onSelect(t.id)}
            aria-label={t.title}
          >
            <span className="pulse-dot w-2 h-2 rounded-full shrink-0 bg-accent mt-[7px]" />
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium text-strong">{t.title}</div>
              <div className="text-[12px] text-[var(--frost-600)] mt-[2px]">{t.subtitle}</div>
            </div>
            <span className="inline-flex text-[var(--frost-500)] mt-1">{Ico.chevRight(14)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


export default function HomeView({
  greeting, showDots, onComposeTask,
  activeTasks, onSelectTask, onClearActive,
  onSend, project, onProjectChange, model, onModelChange, effort, onEffortChange, projects, models, modelMeta,
  attachments, connectors, onAttachFiles, onRemoveAttachment,
  onAddGoogleDriveFiles,
  onAddNotionPages,
  disabledConnections = [],
  onUpdateConnectorMute,
  onStartVoiceCall = null,
  dictationAvailable = false,
  // The browser and call icons, at the top right (TopShortcuts).
  topShortcuts = null,
  browserSwitch = null,
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
  // Drops the parent's prefill once Home is left. The composer has already
  // copied it into the draft, which keeps the user's edits; replaying it on
  // the way back would overwrite them.
  onPrefillConsumed,
  // The checklist's "Try an example" row asks Home to show the examples. Any
  // truthy value is a request; Home answers once and reports it consumed.
  examplesRequest = 0,
  onExamplesRequestConsumed,
  // The checklist's "Start with your own work" row: Home opens in the
  // own-work mode, the same way the examples request works.
  ownWorkRequest = 0,
  onOwnWorkRequestConsumed,
  // An example started from the Use Case Gallery column ({ entry, bump }):
  // placed like a picked example, then reported consumed.
  galleryPick = null,
  onGalleryPickConsumed,
  // Opens the Use Case Gallery column; null while it is open or not offered.
  onOpenGallery = null,
  codingModeEnabled = false,
  codingModelDefault,
  harnessClaudeCodeEnabled,
}) {
  const { t } = useTranslation('shell');
  const consoleLink = useConsoleLink();
  const greetingText = greeting || t('home.greetingFallback');
  const blocked = configReady === false;

  // Selected task mode (ENG-1594). Null = default view (pill row visible).
  // Owns the composer placeholder, the toolbar chip, and the sample list.
  const [taskMode, setTaskMode] = useState(null);
  // The example picked from the list under the composer, or placed by a console
  // link, kept apart from the text so editing it does not change what kind of
  // message it is. It is dropped when the mode is left.
  const [pickedSample, setPickedSample] = useState(null);
  useEffect(() => {
    if (!taskMode) setPickedSample(null);
  }, [taskMode]);
  // Shown under the composer while a sample from a console link is in it.
  // Leaving that mode (send, or removing the chip) retires it for good, so it
  // cannot reappear over a different mode picked afterwards.
  const [handoffHint, setHandoffHint] = useState(false);
  // A brand-new account that signed up from the desktop app (ENG-4288). Home
  // greets it with one line that says it can start here or go back to the app.
  // A sign-up from Cowork web gets no notice: that person is already where
  // they meant to be, with the composer ready.
  const [desktopWelcome, setDesktopWelcome] = useState(false);
  const welcomeTakenRef = useRef(false);
  useEffect(() => {
    if (welcomeTakenRef.current) return;
    welcomeTakenRef.current = true;
    const welcome = takeSignupWelcome();
    if (!welcome) return;
    trackSignupLanded(welcome.from);
    if (welcome.from === SIGNUP_FROM_DESKTOP) setDesktopWelcome(true);
  }, []);
  // The gallery example in the composer, named under it while it is there.
  const galleryStartRef = useRef(null);
  const [galleryHint, setGalleryHint] = useState(null);
  useEffect(() => {
    if (!taskMode) {
      setHandoffHint(false);
      setGalleryHint(null);
    }
  }, [taskMode]);

  // Task modes (slides/website/app-style prompt scaffolding) don't apply to
  // a Claude Code task — clear any mode left selected from before Coding
  // Mode was turned on, so a stale chip/placeholder/instruction can't ride
  // along into a coding-mode send once the picker itself is hidden below.
  useEffect(() => {
    if (codingModeEnabled) setTaskMode(null);
  }, [codingModeEnabled]);

  // Sending a prompt that belongs to an onboarding step completes it no
  // matter which surface filled the composer (a console link, an example,
  // the sidebar checklist, or the user typing it by hand) — but only once the
  // send has gone out: onSend answers false when the provider preflight
  // fails (ENG-2307). A selected task mode appends its instruction line after
  // the user text (titles and search derive from the message head), unless the
  // person replaced a placed example with a request of their own, and clears
  // itself once a send is attempted. `meta` (harness/model, ENG-1656) passes
  // through untouched.
  //
  // The own-work mode sends only once the person has given it something (see
  // hasOwnMaterial: a file, text after an untouched job, or an edited job,
  // which is their own request), and composes the message the pre-release
  // test used. Its
  // send is credited to the checklist when the row opened it.
  const ownWork = taskMode === OWN_WORK_MODE;
  const [ownWorkVia, setOwnWorkVia] = useState(null);
  // A job is the app's text only while it is exactly as placed; text after it
  // is the person's material. Once they edit the job, the whole text is their
  // own request, as when they type one without a job: no guessing which words
  // are the job's. A job with nothing at all after it is "bare", the app's
  // text alone, and is cleared when the mode is left; anything typed after it
  // stays, even when it is not yet enough to send (a ":").
  const isBareJob = (draft) => {
    const job = ownWorkJobIn(draft);
    return Boolean(job) && !draft.trim().slice(job.prompt.length).trim();
  };
  // Whether the composer holds an untouched job still waiting for material.
  const awaitsMaterial = (draft) => Boolean(ownWorkJobIn(draft)) && !hasOwnMaterial(draft);
  // Whether the composer holds a bare job, for the "Now add…" hint. Set from
  // the composer's text as it changes (React skips the re-render when the
  // answer is unchanged).
  const [bareJobShown, setBareJobShown] = useState(false);
  // Leaving the mode by any route (the chip, the examples row, Coding Mode)
  // clears a bare job: outside the mode it would go out as "Clean up this
  // customer list." with no list.
  const wasOwnWorkRef = useRef(false);
  // Whether a console link opened this mode: its task is credited to the link
  // when it is sent from the mode, not when the mode opens.
  const ownWorkFromConsoleRef = useRef(false);
  useEffect(() => {
    if (ownWork) { wasOwnWorkRef.current = true; return; }
    // Only a real exit from the mode: StrictMode runs this again on mount,
    // after the console handoff may have marked the mode as the link's.
    if (!wasOwnWorkRef.current) return;
    wasOwnWorkRef.current = false;
    if (isBareJob(getDraft('new'))) onPrefill?.('');
    ownWorkFromConsoleRef.current = false;
    setOwnWorkVia(null);
    setBareJobShown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownWork]);
  // Closing Home (opening a task, Settings) leaves the mode behind too.
  const ownWorkRef = useRef(false);
  ownWorkRef.current = ownWork;
  useEffect(() => () => {
    if (ownWorkRef.current && isBareJob(getDraft('new'))) setDraft('new', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Picking a job keeps what the person wrote: after an untouched job, what
  // follows it; otherwise all of it, an edited job included, since that is
  // their own text now. It replaces only a job still as placed.
  const placeOwnWorkJob = (prompt) => {
    const draft = getDraft('new').trim();
    const earlier = ownWorkJobIn(draft);
    const rest = earlier
      ? draft.slice(earlier.prompt.length).trim()
      : (isUntouchedSample(draft) ? '' : draft);
    const next = rest ? `${prompt} ${rest}` : `${prompt} `;
    // Written to the draft store as well, so this render already reads it,
    // before the composer applies the prefill.
    setDraft('new', next);
    setBareJobShown(awaitsMaterial(next));
    onPrefill?.(next);
  };
  const sendTracked = async (text, meta) => {
    const { text: message, modeLine } = ownWork
      ? { text: composeOwnWorkMessage(text), modeLine: null }
      : modeMessage(taskMode, text, pickedSample);
    // Notes for analytics travel with this send, so a second Enter the app
    // refuses mid-send cannot clear or relabel them.
    const sendMeta = {
      ...meta,
      ...(modeLine ? { taskMode: { task_mode: taskMode.id, mode_line: modeLine, example_placed: Boolean(pickedSample) } } : {}),
      ...(ownWork && ownWorkVia ? { startVia: ownWorkVia } : {}),
      ...(!ownWork && pickedSample && pickedSample === galleryStartRef.current ? { startVia: 'gallery' } : {}),
      ...(ownWork && ownWorkFromConsoleRef.current ? { entryExampleId: OWN_WORK_START } : {}),
    };
    const result = await onSend(message, sendMeta);
    if (result) {
      const done = stepsCompletedBySend(message);
      // An example the person picked and then edited still counts as tried.
      if (!ownWork && pickedSample && resemblesSample(pickedSample, text)) done.push('see-it-work');
      done.forEach((id) => completeStepTracked(id, ownWork && ownWorkVia ? ownWorkVia : 'composer'));
    } else if (ownWork) {
      // A refused send (a second Enter while the first is still going out, or
      // a failed preflight) keeps the mode, and puts the text back, which the
      // composer clears once any send resolves: a retry still carries the
      // start-now line.
      onPrefill?.(text);
      return result;
    }
    setTaskMode(null);
    setPickedSample(null);
    return result;
  };

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
  const bigThinkingPaused = usePauseAfterFade(!bigThinkingOpacity, COLLAPSE_MS);
  const idlePaused = usePauseAfterFade(!idleLayerOpacity || !idleOpacity, CROSSFADE_MS);
  const thinkingPaused = usePauseAfterFade(!idleLayerOpacity || !thinkingOpacity, CROSSFADE_MS);

  // Greeting text visibility. Hidden during loading/collapsing/
  // traveling/morphing (orb hasn't settled yet); typewrites during
  // 'typing'; full opacity during settling/idle.
  const showText = phase === 'typing' || phase === 'settling' || phase === 'idle';
  const typedText = (phase === 'typing')
    ? greetingText.slice(0, typedCount)
    : (taskMode === OWN_WORK_MODE ? t('home.ownWorkHeading', { product: productName('Cowork') }) : greetingText);

  // Composer fades in during 'settling' and stays for 'idle'.
  const showInteractiveSurface = phase === 'settling' || phase === 'idle';

  // A console link that opened Home is applied once, when the composer is
  // actually usable, so `composer_ready` means the user can type and send.
  // The sample is placed exactly as a sample click would place it, and never
  // sent. An unsent draft wins over the sample when it is the user's own text;
  // one that is still an earlier sample, untouched, is not, and is replaced.
  const composerUsable = showInteractiveSurface && !blocked;

  // Drop the parent's prefill on the way out, but only once the composer has
  // been on screen to take it. Behind the connect-a-provider panel there is
  // no composer, so a prefill sent then is still waiting and must survive a
  // trip to Settings.
  const composerShownRef = useRef(false);
  if (composerUsable) composerShownRef.current = true;
  useEffect(
    () => () => {
      if (composerShownRef.current) onPrefillConsumed?.();
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // A job left bare in the composer from an earlier visit to the mode would
  // go out without the mode. Runs before the console handoff, which may place
  // an example in its place.
  const bareJobCheckedRef = useRef(false);
  useEffect(() => {
    if (!composerUsable || bareJobCheckedRef.current) return;
    bareJobCheckedRef.current = true;
    const draft = getDraft('new');
    // The own-work prompt an earlier build placed goes too: sent without the
    // mode it asks Cowork to open with a question.
    if (!ownWorkRequest && (isBareJob(draft) || RETIRED_PROMPTS.includes(draft.trim()))) onPrefill?.('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerUsable]);

  // A console link that finds the connect-a-provider panel instead of a
  // composer is still an arrival. Once the panel has held for a few seconds
  // (a slow /health can report it briefly at boot), it is recorded on its own
  // and the link is left waiting, so the sample still lands if the composer
  // becomes usable later, without a second record.
  const [blockedSettled, setBlockedSettled] = useState(false);
  useEffect(() => {
    if (!blocked) {
      setBlockedSettled(false);
      return undefined;
    }
    const timer = setTimeout(() => setBlockedSettled(true), BLOCKED_ARRIVAL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [blocked]);
  const blockedArrivalRef = useRef(false);
  useEffect(() => {
    if (!blocked || !blockedSettled || blockedArrivalRef.current) return;
    blockedArrivalRef.current = true;
    const handoff = peekConsoleHandoff();
    if (!handoff || handoff.recorded) return;
    markConsoleHandoffRecorded();
    const exampleId = handoff.sample
      ? sampleId(handoff.sample.label)
      : (handoff.start === OWN_WORK_START ? OWN_WORK_START : null);
    trackComposerReady(handoff.entrySource, exampleId, false, handoff.placement, { blocked: true });
  }, [blocked, blockedSettled]);

  const handoffTakenRef = useRef(false);
  useEffect(() => {
    if (!composerUsable || handoffTakenRef.current) return;
    handoffTakenRef.current = true;
    const handoff = takeConsoleHandoff();
    if (!handoff) return;
    const { sample } = handoff;
    // The own-work start opens the own-work mode and places nothing.
    const ownWorkOpened = !sample && handoff.start === OWN_WORK_START && Boolean(onPrefill) && !codingModeEnabled;
    if (ownWorkOpened) {
      setTaskMode(OWN_WORK_MODE);
      ownWorkFromConsoleRef.current = true;
    }
    // A checklist row clicked before the composer was ready asked for the
    // own-work mode; an example placed now would be taken as material there.
    const placed = sample && !ownWorkRequest ? sample.prompt : null;
    const draft = getDraft('new');
    const draftIsUsers = Boolean(draft) && !isUntouchedSample(draft);
    const prefilled = Boolean(placed && onPrefill && !codingModeEnabled && !draftIsUsers);
    if (prefilled) {
      if (sample) {
        setTaskMode(handoff.mode);
        setPickedSample(sample);
        setHandoffHint(true);
      }
      onPrefill(placed);
    } else if (!placed && onPrefill && draft && !draftIsUsers) {
      // "Start a task" promises an empty composer. A sample left there from an
      // earlier visit is not the user's text, so it goes; their own draft stays.
      onPrefill('');
    }
    const exampleId = sample ? sampleId(sample.label) : (ownWorkOpened ? OWN_WORK_START : null);
    // The task is credited to the example only if the example was placed (or
    // the own-work mode opened); a kept draft of the user's own is not the
    // example's doing. The own-work credit is added by the send from the mode
    // (entryExampleId), so a task sent after leaving it is not credited.
    const credited = sample ? prefilled : ownWorkOpened;
    setEntryAttribution(handoff.entrySource, sample && prefilled ? exampleId : null, handoff.placement);
    if (!handoff.recorded) trackComposerReady(handoff.entrySource, exampleId, credited, handoff.placement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerUsable]);

  useEffect(() => {
    if (!ownWorkRequest || !composerUsable || codingModeEnabled) return;
    // An example or job left in the composer is the app's text, not the
    // person's material, so the mode starts without it.
    const draft = getDraft('new');
    if (draft && isUntouchedSample(draft)) onPrefill?.('');
    setPickedSample(null);
    setHandoffHint(false);
    setTaskMode(OWN_WORK_MODE);
    setOwnWorkVia('checklist');
    onOwnWorkRequestConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownWorkRequest, composerUsable, codingModeEnabled]);

  // An example started from the gallery is placed once the composer is usable,
  // exactly as one picked under the composer: its mode selected, its prompt in
  // the box. One that needs nothing from the person is then sent as if Send
  // were pressed; one that can take their file waits for them. The person
  // chose it, so it replaces what is there.
  useEffect(() => {
    if (!galleryPick || !composerUsable || codingModeEnabled || !onPrefill) return;
    const { entry } = galleryPick;
    galleryStartRef.current = entry.sample;
    setTaskMode(entry.mode);
    setPickedSample(entry.sample);
    setHandoffHint(false);
    const send = sendsAtOnce(entry);
    setGalleryHint(send ? null : entry.title);
    trackExamplePicked(entry.id, 'gallery');
    onPrefill(entry.sample.prompt, undefined, send);
    onGalleryPickConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryPick, composerUsable, codingModeEnabled]);

  // Shows the examples once the composer is usable, like the console handoff.
  useEffect(() => {
    if (!examplesRequest || !composerUsable || codingModeEnabled) return;
    setTaskMode(FEATURED_EXAMPLES_MODE);
    onExamplesRequestConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examplesRequest, composerUsable, codingModeEnabled]);

  return (
    <div
      ref={homeRef}
      className="relative flex-1 overflow-auto flex flex-col items-center justify-center pt-0 px-10 pb-[60px] bg-transparent"
    >
      {desktopWelcome && (
        // Out of the flow, so the centred greeting and composer do not move
        // when the notice appears or is dismissed.
        <div
          role="status"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[calc(100%-32px)] flex items-center gap-2 w-max rounded-lg border border-line bg-surface-2 pl-4 pr-1.5 py-1 text-[12.5px] text-ink-2 shadow-sm"
        >
          <span className="min-w-0">{t('home.signupWelcome.fromDesktop', { product: productName('Cowork') })}</span>
          <button
            type="button"
            className="mini-icon-btn shrink-0"
            aria-label={t('home.signupWelcome.dismiss')}
            onClick={() => setDesktopWelcome(false)}
          >
            {Ico.close(12)}
          </button>
        </div>
      )}
      {(topShortcuts || onOpenGallery) && (
        <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-2">
          {onOpenGallery && (
            <Button variant="default" size="sm" onClick={onOpenGallery}>
              {Ico.grid(14)} {t('gallery.open')}
            </Button>
          )}
          {topShortcuts}
        </div>
      )}
      {/* Deliberate exception to the .s-* ladder. This is the home hero, and
          the ladder has no rung between s-h1 (28px) and s-display (44px): 28px
          is dwarfed by the 42px orb, 44px wraps to two lines in the 640px
          column. So it sits at a bespoke 36px (text-3xl), balanced against the
          orb. Always flex-start — the orb stays at its REST flow position
          (ml -58) and moves via translateX during boot. */}
      <h1 className="home-greeting-row font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.004em] text-strong mt-0 mx-0 mb-7 w-full max-w-[var(--composer-max-width,640px)] flex items-center gap-4 justify-start">
        <span
          ref={orbRef}
          // inline-flex (not inline-block) keeps the container out of the inline
          // baseline system — under a transform, inline-block can shift a couple
          // px relative to the text. The visual layers inside are absolutely
          // positioned, so this align/justify only sets the OUTER vertical
          // alignment with the greeting.
          className="home-orb relative w-[42px] h-[42px] shrink-0 ml-[-58px] inline-flex items-center justify-center"
          style={{
            // Dynamic: the container only translates (centre during boot, rest
            // during travel), fades in once the centre-offset lands, and swaps
            // its per-phase transition + will-change. Identity → 'none' so it
            // doesn't create a stacking context when idle.
            transform: (orbTranslateX === 0)
              ? 'none'
              : `translateX(${orbTranslateX}px)`,
            opacity: orbReady ? 1 : 0,
            transition: `${orbTransition}, opacity 200ms ease-out`,
            willChange: isEarlyBoot ? 'transform' : 'auto',
          }}
        >
          {/* 1) Big thinking orb — booted-into state. Fades + shrinks
                 during 'collapsing' so the visual reads as "the orb
                 collapsed into the dot below." */}
          <span
            className="absolute top-1/2 left-1/2 w-16 h-16 pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) scale(${bigThinkingScale})`,
              opacity: bigThinkingOpacity,
              transition: `opacity ${COLLAPSE_MS}ms ease-out, transform ${COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
            }}
          >
            <OrbitMorph size={64} state="thinking" paused={bigThinkingPaused} />
          </span>

          {/* 2) The dot. Solid accent circle, 10px. Visible during
                 collapsing (fades in as the big orb shrinks),
                 traveling (the eye follows it from centre to rest),
                 and the start of morphing (fades out as the idle
                 orb scales up over it). */}
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 w-[10px] h-[10px] rounded-full bg-accent shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_55%,transparent)] -translate-x-1/2 -translate-y-1/2 [transition:opacity_320ms_ease-in-out] pointer-events-none"
            style={{ opacity: dotOpacity }}
          />

          {/* 3) Idle/thinking orb stack — the resting visual. Scales
                 up from the dot during 'morphing' (so the dot
                 visibly evolves into the orb), then stays at full
                 size for typing → idle, with the existing
                 idle/thinking activity crossfade. */}
          <span
            className="absolute top-1/2 left-1/2 w-[42px] h-[42px] pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) scale(${idleLayerScale})`,
              opacity: idleLayerOpacity,
              transition: `opacity ${MORPH_MS}ms ease-out, transform ${MORPH_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
            }}
          >
            <OrbitMorph
              size={42}
              state="idle"
              paused={idlePaused}
              style={{
                position: 'absolute', inset: 0,
                opacity: idleOpacity,
                transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
              }}
            />
            <OrbitMorph
              size={42}
              state="thinking"
              paused={thinkingPaused}
              style={{
                position: 'absolute', inset: 0,
                opacity: thinkingOpacity,
                transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
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
        <div className="w-full flex flex-col items-center [animation:boot-fadein_500ms_ease-out_both]">
          {blocked ? (
            <div className="home-connect-card">
              <span className="w-9 h-9 rounded-[9px] inline-flex items-center justify-center bg-[var(--primary-50)] text-[var(--primary-700)] shrink-0">{Ico.key(20)}</span>
              <div className="home-connect-card__body">
                <div className="text-base font-[650] text-strong">{PLATFORM_UI ? t('home.connectProvider.title') : t('home.connectProvider.operatorTitle')}</div>
                <div className="text-sm text-[var(--frost-700)] mt-[3px]">{PLATFORM_UI
                  ? t(billingCopyKey('home.connectProvider.body'))
                  : t('home.connectProvider.operatorBody')}</div>
              </div>
              {PLATFORM_UI && <div className="home-connect-card__actions">
                {offersBilling() && <Button
                  variant="primary"
                  onClick={() => {
                    // Same card, same trigger as ChatView's provider_required
                    // (ENG-1533) — one surface reached two ways, so the two must
                    // not read as different causes in the funnel.
                    trackBillingOpened('connect_provider');
                    host.openExternal(consoleLink(MINDS_BILLING_URL));
                  }}
                >{t('home.connectProvider.startFree')}</Button>}
                <Button
                  variant="primary"
                  onClick={() => onOpenSettings?.('agent')}
                  style={{ background: 'transparent', color: 'var(--primary-700)', border: '1px solid var(--primary-700)' }}
                >{t('sidebar.openSettings')}</Button>
              </div>}
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
              onAddNotionPages={onAddNotionPages}
              onRemoveAttachment={onRemoveAttachment}
              disabledConnections={disabledConnections}
              onUpdateConnectorMute={onUpdateConnectorMute}
              onStartVoiceCall={onStartVoiceCall}
              dictationAvailable={dictationAvailable}
              browserSwitch={browserSwitch}
              onCreateProject={onCreateProject}
              onTypingChange={(typing) => {
                setIsTyping(typing);
                if (typing) onComposeTask?.();
              }}
              codingModeEnabled={codingModeEnabled}
              onOpenSettings={onOpenSettings}
              codingModelDefault={codingModelDefault}
              harnessClaudeCodeEnabled={harnessClaudeCodeEnabled}
              sendsMeta
              canSend={ownWork ? (value) => hasOwnMaterial(value, attachments?.length || 0) : null}
              onValueChange={ownWork ? (value) => setBareJobShown(awaitsMaterial(value)) : undefined}
            />
          )}
          {/* Everything below the composer lives in a zero-height wrapper:
              the centered column lays out as if nothing is here, so the
              greeting + composer never shift when pills swap for the
              (taller) sample list or when active tasks appear. The content
              overflows downward; the scroll container still reaches it
              because descendant overflow extends the scrollable area. */}
          <div className="w-full h-0 overflow-visible flex flex-col items-center">
            {galleryHint && taskMode && (
              <p role="status" className="text-sm text-[var(--frost-700)] mt-2 mb-0 w-full max-w-[var(--composer-max-width,640px)]">
                {t('home.galleryHint', { title: galleryHint })}
              </p>
            )}
            {handoffHint && taskMode && (
              <p role="status" className="text-sm text-[var(--frost-700)] mt-2 mb-0 w-full max-w-[var(--composer-max-width,640px)]">
                {t('home.handoffHint')}
              </p>
            )}
            {/* Samples only render when onPrefill exists — a sample click's
                whole job is prefilling the composer, so without the callback
                it would be a silent dead click (same gate the old
                HomeSuggestions had). Hidden entirely in Coding Mode — the
                slides/website/app-style prompt scaffolding these offer
                doesn't apply to a Claude Code task. */}
            {!blocked && !codingModeEnabled && (
              ownWork
                ? (onPrefill && (
                  <OwnWorkPanel
                    waitingForMaterial={bareJobShown && !attachments?.length}
                    onPickJob={placeOwnWorkJob}
                    onAttachFiles={onAttachFiles}
                  />
                ))
                : taskMode
                ? (onPrefill && (
                  <TaskModeSamples
                    mode={taskMode}
                    onPick={(prompt) => {
                      const hit = findSampleByPrompt(prompt);
                      setPickedSample(hit?.sample ?? null);
                      if (hit) trackExamplePicked(sampleId(hit.sample.label), taskMode.id);
                      onPrefill(prompt);
                    }}
                  />
                ))
                : <TaskModePills onPick={setTaskMode} />
            )}
            <ActiveList tasks={activeTasks} onSelect={onSelectTask} onClear={onClearActive} />
          </div>
        </div>
      )}
    </div>
  );
}
