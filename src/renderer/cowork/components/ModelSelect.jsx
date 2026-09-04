// `<ModelSelect>` — searchable, provider-grouped model picker (ENG-1096).
//
// The domain half of the picker: sections from the backend's `provider` field
// with the maker inferred from alias+label for the icon (`lib/modelCatalog`,
// which explains why one field can't do both), provider marks (`ProviderIcon`,
// neutral placeholder for makers without an svg — ENG-1112), and the pin
// semantics for the stale-pin / "Other…" entries. All Base UI wiring and
// styling live in the generic `ui/Combobox` this composes.
//
// API mirrors `Select` where the two overlap, so call sites swap 1:1:
//
//   <ModelSelect
//     value={modelId}
//     onValueChange={setModelId}
//     options={[
//       { value: 'sonnet', label: 'Claude Sonnet 5' },
//       { value: 'opus', label: 'Claude Opus 5', tag: 'Needs credits' },
//       { value: '__custom__', label: 'Other…', pin: 'bottom' },
//     ]}
//   />
//
// Reasoning-effort footer (ENG-1940) — modeled on Claude Desktop's own model
// picker: the effort control lives INSIDE this popup as a footer row below
// the model list, not as a sibling control next to ModelSelect. Opt in by
// passing `modelEfforts` (the `{modelId: {efforts, default}}` map — pass the
// object even if callers don't yet care about the row's close interaction);
// omitting it entirely (`undefined`, the default) keeps every call site that
// hasn't been told about this feature on today's plain model-only behavior:
//
//   <ModelSelect
//     value={modelId}
//     onValueChange={setModelId}
//     options={...}
//     modelEfforts={{ sonnet: { efforts: ['low', 'medium', 'high'], default: 'medium' } }}
//     effort={effort}
//     onEffortChange={setEffort}
//     harness={harness}      // optional — Hermes has no effort knob
//   />
//
// The footer reflects the CURRENTLY SELECTED model (this component's own
// `value` prop), not whatever row the list is hovering, and only exists at
// all when that model actually has effort options — a model with none gets
// no footer (not a disabled "Default" row); the row would have nothing to
// drill into. Picking a model WITH effort options keeps the popup open
// right where it is — the footer fades in below the list (Combobox holds
// the popup's total height constant while it appears, so nothing jumps;
// see its List/footer comments) and the user can set an effort level as
// part of the same interaction, or just dismiss the popup as usual.
// Picking a model with no options closes the popup normally, Base UI's own
// contract, unchanged. Hovering the footer row opens the side flyout (Base
// UI's Positioner picks whichever side has room); hovering the flyout
// itself keeps it open, and leaving both starts a generous close-grace
// timer rather than closing immediately, so a brief drift off the edge
// doesn't snap it shut before the user meant to pick a level. The
// hover-intent open/close timing is hand-rolled since Popover.Trigger's own
// `openOnHover` drives off Floating UI's async rest-detection, which is
// awkward to drive deterministically from tests and buys nothing over a
// plain timer for an interaction this simple. Picking a level fires
// `onEffortChange` and closes both the flyout and this whole popup —
// mirroring how picking a model item closes the popup via Base UI's own
// onValueChange-closes contract, this component takes over the Combobox's
// open state (falling back to an internal `useState` when the caller
// doesn't already control `open`) so it has a `close()` to call for the
// same effect after a footer pick, which Base UI wouldn't grant it for free
// since the footer is plain content, not a selectable item (see
// ui/Combobox.jsx's `footer` slot docs).
//
// Option shape: { value, label, disabled?, locked?, title?, tag?, maker?, provider?, pin? }.
//   - `provider`: MindsHub's serving-vendor field (the ENG-1111 backend
//     contract), which decides the section.
//   - `maker`: explicit maker key, trusted over inference when present. It is
//     the icon identity only, never the section.
//   - `tag`: compact right-aligned pill on the row (the version state, the
//     "Needs credits" wallet state, or both), kept out of the label so the
//     trigger and the search see the bare name.
//   - `locked`: the wallet can't pay for this model. Both option builders set
//     it beside `disabled: true`, and this component turns it into the "Add
//     credits" button on the row — see `creditsAction` below for why the
//     button lives here rather than in either builder.
//   - `pin: 'top' | 'bottom'`: render outside the maker groups, unheaded,
//     at the top/bottom of the list (stale-pin and "Other…" entries).
//     Pinned entries also bypass the search filter: "Other…" is the escape
//     hatch for typing a model id we don't list, so a search with no
//     matches must not hide it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ChevronRight, Check } from 'lucide-react';
import { cn } from '../lib/cn';
import { groupModelOptions, modelMaker } from '../lib/modelCatalog';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { host } from '../../platform/host';
import { trackBillingOpened } from '../lib/analytics';
import Combobox from './ui/Combobox.jsx';
import ProviderIcon from './ProviderIcon.jsx';
import { Tooltip } from './ui';

// Copy is shared verbatim with the flyout's description paragraph — pulled
// to a constant so the two can't drift.
const EFFORT_DESCRIPTION = 'Higher effort means more thorough responses, but takes longer and uses your limits faster.';

// How long the flyout stays open after the pointer leaves both the footer
// row and the panel itself, with nothing else happening — long enough that
// browsing back up into the model list, or just a brief drift off the edge,
// doesn't snap it shut before the user meant to pick a level. Re-entering
// either the row or the panel within this window cancels the close outright
// (see `cancelClose`); a genuine move to interact with something else (a
// model row, a click elsewhere) collapses it as normal via the outside-press
// veto's own close path and the model list's own hover states taking over.
const EFFORT_FLYOUT_CLOSE_GRACE_MS = 1500;

// How long the popup lingers after picking a model with NO effort options
// while the Effort footer is showing: the footer fades out (the 320ms
// `fade-out` animation, with a small hold at 0), THEN the popup closes.
// Watching the row leave teaches why it's gone — this model has no effort
// levels — where an instant close would just look like the footer vanished.
const FOOTER_EXIT_MS = 400;

const CHEVRON_RIGHT = <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" />;
const CHECK = <Check size={12} strokeWidth={1.5} aria-hidden="true" />;

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Pseudo-group keys for pinned (unheaded) entries. Underscored so they can
// never collide with a real maker key from modelCatalog.
const PIN_TOP = '__pinned-top__';
const PIN_BOTTOM = '__pinned-bottom__';

/*
 * The "Add credits" button on a locked row.
 *
 * A locked row is disabled, so the row itself is not a click target any more.
 * Without this the only thing naming the way out is the tag and a tooltip, and
 * neither is clickable — the user is told to add credits and given nowhere to
 * do it. Settings has a top-up link under the picker, but it renders only when
 * the CURRENT model is locked, so it stays dark for the commonest case: an
 * affordable model selected, an unaffordable one being looked at.
 *
 * It lives here rather than in either option builder because both builders are
 * pure functions in `lib/` that return data, and a button is not data. Putting
 * it in the one component both pickers already render through is also what
 * keeps Settings and the composer from drifting apart on it.
 *
 * stopPropagation on both click and mousedown mirrors the Model Router row's
 * action, but it is a second layer here rather than the guard. What stops the
 * click selecting the row is the row being disabled: Base UI's Combobox.Item
 * returns early on `disabled` before its select handler runs. No test covers
 * the stopPropagation, and none can without a `locked` row that is not also
 * disabled, which the builders never produce.
 */
function creditsAction() {
  return (
    <Tooltip content="Add credits to use this model">
      <button
        type="button"
        /* Same metrics as the "Needs credits" tag it sits beside, in accent so
           the pair reads as state then action rather than as two tags.
           `border-solid` is load-bearing: preflight is off, so a bare `border`
           sets width and leaves style at the UA default. */
        className={cn(
          'shrink-0 rounded-full border border-solid border-accent bg-transparent',
          'px-[7px] py-[1px] text-[10.5px] leading-[15px] text-accent',
          'cursor-pointer [transition:background-color_.12s_ease]',
          'hover:bg-surface-2',
        )}
        onClick={(e) => {
          e.stopPropagation();
          trackBillingOpened('locked_model_row');
          return host.openExternal(MINDS_BILLING_URL);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        Add credits
      </button>
    </Tooltip>
  );
}

function makerKeyFor(option) {
  if (!option) return 'other';
  if (option.pin) return 'other'; // specials get the neutral mark
  return option.maker || modelMaker(option.value, option.label).key;
}

/*
 * Inline text segment whose box WIDTH glides between natural sizes when
 * `text` changes (a 160ms FLIP: pin the old width, transition to the new,
 * hand sizing back to the content), so the trigger pill relabeling live on
 * a pick reads as a slide rather than a snap.
 *
 * Segments animate INDEPENDENTLY — this is the fix for the suffix jitter:
 * animating the whole pill's width moved its edge smoothly while the text
 * inside re-laid-out instantly, so the "· Effort" part jumped to its new x
 * at frame zero. Per-segment, an unchanged effort renders an unchanged box
 * that just rides along as the model-name segment glides; only a segment
 * whose own text changed animates (width glide, plus a fade of the new
 * text when `fadeOnChange` — used by the effort suffix so a level change
 * registers even when the old and new labels happen to be the same width,
 * e.g. Low → Max).
 *
 * No-ops on first mount (nothing to glide from), under
 * prefers-reduced-motion, and in jsdom (offsetWidth is always 0 there).
 */
function AnimatedWidthText({ text, fadeOnChange = false }) {
  const ref = useRef(null);
  const prevWidthRef = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = prevWidthRef.current;
    // offsetWidth AFTER this render committed = the new natural width.
    const next = el.offsetWidth;
    prevWidthRef.current = next;
    if (prev == null || prev === next || next === 0) return;
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // border-box so the pinned px width means the same thing offsetWidth
    // measured.
    el.style.boxSizing = 'border-box';
    el.style.width = `${prev}px`;
    el.style.transition = 'width 160ms ease';
    const finish = () => {
      el.style.width = '';
      el.style.transition = '';
      el.style.boxSizing = '';
      el.removeEventListener('transitionend', finish);
    };
    requestAnimationFrame(() => {
      el.style.width = `${next}px`;
      el.addEventListener('transitionend', finish);
      // Safety: transitionend can be swallowed (tab hidden, interrupted
      // animation) — never leave a stale pinned width behind.
      setTimeout(finish, 260);
    });
  }, [text]);

  return (
    // align-bottom: an inline-block with overflow hidden baselines on its
    // bottom margin edge, which would float the text above its neighbors;
    // every segment shares the pill's font metrics, so bottom-aligning
    // lines it back up exactly.
    <span ref={ref} className="inline-block overflow-hidden whitespace-nowrap align-bottom">
      {fadeOnChange
        // Re-keying remounts the inner span per text value, replaying the
        // fade for each change (and once on first appearance, which is
        // also right — the suffix materializing after an effort pick).
        ? <span key={text} className="inline-block animate-fade-in">{text}</span>
        : text}
    </span>
  );
}

/*
 * The "Effort" row rendered as ModelSelect's `footer` (see ui/Combobox.jsx).
 * Only mounted at all when the selected model actually has effort options
 * (see `showEffortFooter` below) — a model with none gets no footer, not a
 * disabled "Default" row.
 *
 * Positioning is Base UI's Popover (Portal + Positioner) so the flyout gets
 * the same collision-aware side placement as every other popup in the app;
 * the open/close timing is a plain `useState` + grace-period timeout rather
 * than Popover.Trigger's own `openOnHover` — that option drives off Floating
 * UI's async "rest" hover detection, which doesn't respond deterministically
 * to synthetic mouse events in tests.
 *
 * Hover intent, deliberately generous: entering the row OR the panel opens
 * (or re-opens) it immediately and cancels any pending close; leaving either
 * one starts a single `EFFORT_FLYOUT_CLOSE_GRACE_MS` timer, restarted (not
 * stacked) on every leave, so idle time with the pointer off both is what
 * actually closes it — a quick pass back over the row or the panel within
 * that window cancels the close outright.
 */
function EffortFooter({
  valueLabel,
  effortOptions,
  resolvedEffort,
  defaultEffort,
  onPick,
  zIndex,
}) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const closeTimerRef = useRef(null);

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const cancelClose = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setFlyoutOpen(false), EFFORT_FLYOUT_CLOSE_GRACE_MS);
  };
  const openNow = () => { cancelClose(); setFlyoutOpen(true); };

  const rowClassName = cn(
    // Popover.Trigger renders a REAL <button>, and preflight is disabled in
    // this app — without an explicit reset the UA's default button chrome
    // (grey ButtonFace background, outset border, system font) shows
    // through in both themes. Same reset the flyout's own level buttons
    // carry below.
    'appearance-none border-0 bg-transparent font-body',
    'flex items-center justify-between gap-[8px] w-[calc(100%-8px)] mx-[4px]',
    'px-[10px] py-[8px] rounded-[5px] text-[13px] text-ink-2 select-none outline-none box-border',
    'cursor-pointer data-[popup-open]:bg-surface-2 hover:bg-surface-2',
  );

  const rowContent = (
    <>
      <span>Effort</span>
      <span className="inline-flex items-center gap-[4px] text-ink-3">
        <span className="truncate max-w-[110px]">{valueLabel}</span>
        {CHEVRON_RIGHT}
      </span>
    </>
  );

  return (
    <Popover.Root open={flyoutOpen} onOpenChange={setFlyoutOpen}>
      <Popover.Trigger
        className={rowClassName}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
      >
        {rowContent}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="right" align="start" sideOffset={4} style={{ zIndex }}>
          <Popover.Popup
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            // Identifies this panel's DOM subtree so ModelSelect's own
            // `onOpenChange` can veto the Combobox's outside-press dismiss
            // for a press that lands here (see the `data-effort-flyout`
            // check there for why: this panel is a separate Popover
            // portaled straight to <body>, not a DOM descendant of the
            // Combobox's own popup, so without that veto a press on a
            // level closes the whole model popup — via Base UI's own
            // capture-phase outside-press listener on `document`, which
            // runs before any handler placed here ever could — out from
            // under the pick before its click even fires).
            data-effort-flyout=""
            className={cn(
              'w-[240px] max-w-[calc(var(--available-width)-8px)] box-border',
              'bg-surface border border-solid border-line rounded-[10px] shadow-sh-popup outline-none font-body',
              '[transform-origin:var(--transform-origin)]',
              'data-[open]:animate-scale-in data-[closed]:animate-scale-out',
            )}
          >
            <p className="m-0 px-[14px] pt-[10px] pb-[8px] text-[12px] leading-[1.5] text-ink-3">
              {EFFORT_DESCRIPTION}
            </p>
            <div className="pb-[4px]">
              {effortOptions.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => { onPick(lvl); cancelClose(); setFlyoutOpen(false); }}
                  className="grid grid-cols-[16px_1fr_auto] items-center gap-[6px] w-[calc(100%-8px)] mx-[4px] px-[10px] py-[7px] rounded-[5px] appearance-none border-0 bg-transparent font-body text-[13px] text-ink-2 cursor-pointer select-none outline-none box-border hover:bg-surface-2"
                >
                  <span className="inline-flex justify-center text-accent">
                    {lvl === resolvedEffort && CHECK}
                  </span>
                  <span className="min-w-0 truncate text-left">{capitalize(lvl)}</span>
                  {lvl === defaultEffort && (
                    <span className="shrink-0 rounded-full border border-line px-[7px] py-[1px] text-[10.5px] leading-[15px] text-ink-4 select-none">
                      Default
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ModelSelect({
  options = [],
  placeholder = 'Select model',
  emptyText = 'No models found',
  // Reasoning-effort footer (ENG-1940) — all optional; omitting `modelEfforts`
  // entirely keeps this component's behavior identical to before it existed.
  modelEfforts,
  effort = '',
  onEffortChange,
  harness,
  open,
  onOpenChange,
  onValueChange,
  ...rest
}) {
  const groups = useMemo(() => {
    // A locked row gets the route to credits attached here, so neither builder
    // has to know how to render one. An explicit `action` from a call site wins
    // — Model Router carries its own and is never locked anyway.
    const entries = options.filter(Boolean)
      .map((o) => (o.locked && !o.action ? { ...o, action: creditsAction() } : o));
    const top = entries.filter((o) => o.pin === 'top');
    const bottom = entries.filter((o) => o.pin === 'bottom');
    const grouped = groupModelOptions(entries.filter((o) => !o.pin));
    return [
      ...(top.length ? [{ key: PIN_TOP, name: null, items: top }] : []),
      ...grouped,
      ...(bottom.length ? [{ key: PIN_BOTTOM, name: null, items: bottom }] : []),
    ];
  }, [options]);

  // This component takes over the Combobox's open state ONLY when the effort
  // feature is opted into (`modelEfforts` passed at all) — a footer pick
  // needs a `close()` to call, which Base UI won't grant it for free since
  // the footer is plain content, not a selectable item. A caller that
  // already controls `open` (Composer) keeps doing so; one that doesn't
  // (Settings) gets an internal `useState` standing in for Base UI's own
  // internal open state, so `onOpenChange` still reaches the caller (e.g.
  // Settings' wallet-refresh-on-open side effect) exactly as before. A
  // caller that never passes `modelEfforts` sees `open`/`onOpenChange`
  // forwarded to Combobox completely unchanged from before this feature
  // existed — no regression for a call site that hasn't opted in.
  const effortFeatureEnabled = modelEfforts !== undefined;
  // Resolved off THIS component's own `value` prop (the selected model),
  // not any list-hover state — the footer always describes the currently
  // selected model, matching the reference: the footer reads Opus's effort
  // even while the list above shows every model.
  const harnessSupportsEffort = (harness || 'anton') !== 'hermes';
  const effortEntry = modelEfforts ? (modelEfforts[rest.value] || null) : null;
  const effortOptions = effortEntry?.efforts || [];
  const resolvedEffort = effortOptions.includes(effort)
    ? effort
    : (effortEntry?.default || effortOptions[0] || '');
  // The trigger's muted "· <Effort>" suffix shows whenever the user has
  // EXPLICITLY picked a level valid for this model — including a pick that
  // happens to equal the model's own default. Keying it on "differs from
  // the default" instead read as broken in practice: the live catalog's
  // reasoning models all default to "high", so explicitly choosing High
  // displayed nothing and the pick looked like it hadn't taken. Only a
  // never-touched effort ('' — resolution silently falls back to the
  // model's default) leaves the trigger showing just the model name.
  const showEffortOnTrigger = harnessSupportsEffort && effortOptions.includes(effort);
  // Only mounted when the selected model actually has effort options — no
  // footer at all for a model with none, rather than a disabled "Default"
  // row (also suppressed with no model selected, or under a harness with no
  // effort knob).
  const showEffortFooter = effortFeatureEnabled && !!rest.value && harnessSupportsEffort
    && effortOptions.length > 0;

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpenControlledByCaller = open !== undefined;
  const comboboxOpen = effortFeatureEnabled
    ? (isOpenControlledByCaller ? open : internalOpen)
    : open;
  // Set synchronously by `comboboxOnValueChange` (below) the instant a pick
  // lands, and read here immediately after — Base UI calls
  // `setSelectedValue` then `setOpen(false, ...)` back to back in the same
  // synchronous handler (see AriaCombobox's item-press branch), so a ref
  // (not state, which wouldn't update until the next render) is the only
  // way for this callback to know what was JUST picked.
  const pendingEffortModelRef = useRef(false);
  // The footer-exit choreography (see FOOTER_EXIT_MS): picking a NO-effort
  // model while the footer is showing vetoes the immediate close, renders
  // the OLD model's footer one last time with a fade-out, then closes the
  // popup on a timer. `pendingFooterExitRef` is the synchronous pick-time
  // signal (same ref pattern as pendingEffortModelRef above);
  // `exitFooterDataRef` snapshots the outgoing model's footer content, since
  // by exit-render time `value` already points at the new, effort-less model
  // and the live derivations have nothing to show; `footerExiting` is state
  // because the exit render itself must happen.
  const pendingFooterExitRef = useRef(false);
  const exitFooterDataRef = useRef(null);
  const footerExitTimerRef = useRef(null);
  const [footerExiting, setFooterExiting] = useState(false);
  useEffect(() => () => { if (footerExitTimerRef.current) clearTimeout(footerExitTimerRef.current); }, []);
  const comboboxOnOpenChange = effortFeatureEnabled
    ? (next, eventDetails, ...args) => {
      // Base UI's outside-press dismiss runs a capture-phase listener on
      // `document` — by the time it fires, it has already decided to
      // close, and nothing a handler placed on the flyout itself (even
      // one that calls stopPropagation on the initial mousedown) can run
      // early enough to stop it. The flyout is a SEPARATE Popover
      // portaled straight to <body>, not a DOM descendant of this
      // Combobox's own popup, so Base UI's containment check reads a
      // press there as "outside" and would otherwise close the whole
      // model popup out from under an effort pick before its click ever
      // fires. `eventDetails.cancel()` is the sanctioned way to veto a
      // close Base UI already decided on (see AriaCombobox's own
      // `if (eventDetails.isCanceled) return;` right after it calls this
      // same callback) — so instead of racing the DOM event, veto the
      // specific close reason we don't want.
      if (!next && eventDetails?.reason === 'outside-press'
        && eventDetails.event?.target?.closest?.('[data-effort-flyout]')) {
        eventDetails.cancel();
        return;
      }
      // Picking ANY model item closes the whole popup unconditionally —
      // Base UI's own single-select behavior (AriaCombobox: `setSelectedValue`
      // immediately followed by `setOpen(false, {reason: 'item-press'})`).
      // When the just-picked model has effort options, veto that close so the
      // menu stays where it is and the Effort footer fades in below the list
      // (Combobox keeps the total popup height constant while it appears, so
      // nothing repositions — see its List/footer comments) — giving the user
      // the chance to set an effort level as part of the same interaction.
      // A model with no options still closes normally, and the popup's every
      // other close path (outside press elsewhere, Esc, trigger click) is
      // untouched, so "do nothing" after the pick just leaves a normal open
      // popup to dismiss as usual.
      if (!next && eventDetails?.reason === 'item-press' && pendingEffortModelRef.current) {
        pendingEffortModelRef.current = false;
        eventDetails.cancel();
        return;
      }
      // The inverse pick — a NO-effort model chosen while the footer was
      // showing. Also vetoed, but only long enough for the footer's
      // fade-out to play; the timer then closes the popup for real.
      if (!next && eventDetails?.reason === 'item-press' && pendingFooterExitRef.current) {
        pendingFooterExitRef.current = false;
        eventDetails.cancel();
        setFooterExiting(true);
        footerExitTimerRef.current = setTimeout(() => {
          footerExitTimerRef.current = null;
          setFooterExiting(false);
          exitFooterDataRef.current = null;
          closePopup();
        }, FOOTER_EXIT_MS);
        return;
      }
      if (!isOpenControlledByCaller) setInternalOpen(next);
      onOpenChange?.(next, eventDetails, ...args);
    }
    : onOpenChange;
  const closePopup = () => comboboxOnOpenChange?.(false, { reason: 'none' });
  // Wraps the caller's onValueChange purely to learn, synchronously and
  // ahead of the close decision above, whether what was just picked has
  // effort options — see `pendingEffortModelRef`'s doc comment.
  const comboboxOnValueChange = effortFeatureEnabled
    ? (nextValue) => {
      const nextEntry = modelEfforts ? (modelEfforts[nextValue] || null) : null;
      const nextHasEfforts = harnessSupportsEffort && !!nextEntry?.efforts?.length;
      pendingEffortModelRef.current = nextHasEfforts;
      // A pick landing mid-exit supersedes the choreography — clear the
      // pending close so an effort-capable pick isn't yanked shut by the
      // old timer.
      if (footerExitTimerRef.current) {
        clearTimeout(footerExitTimerRef.current);
        footerExitTimerRef.current = null;
        setFooterExiting(false);
        exitFooterDataRef.current = null;
      }
      // Effort model → no-effort model, footer on screen: snapshot the
      // OUTGOING model's footer for the exit render (the live derivations
      // will describe the new model, which has nothing to show), and arm
      // the item-press veto that gives the fade-out its moment.
      if (!nextHasEfforts && showEffortFooter && comboboxOpen) {
        pendingFooterExitRef.current = true;
        exitFooterDataRef.current = {
          valueLabel: capitalize(resolvedEffort),
          effortOptions,
          resolvedEffort,
          defaultEffort: effortEntry?.default,
        };
      }
      onValueChange?.(nextValue);
    }
    : onValueChange;

  return (
    <Combobox
      groups={groups}
      placeholder={placeholder}
      emptyText={emptyText}
      searchAriaLabel="Search models"
      // Match on the display label OR the raw id — "opus" finds Claude Opus
      // whether typed as alias or name. Pinned entries bypass the filter.
      filter={(item, query, contains) => !!item?.pin || contains(item?.label ?? '', query) || contains(item?.value ?? '', query)}
      renderValue={(selected) => (
        <>
          {selected && <ProviderIcon maker={makerKeyFor(selected)} className="text-ink-2" />}
          <span className={cn('truncate', !selected && 'text-ink-4')}>
            {/* Per-segment width glides (see AnimatedWidthText): a model
                switch animates only the name segment — an unchanged effort
                suffix rides along instead of jittering — and an effort
                change animates (and fades) only the suffix. */}
            {selected
              ? <AnimatedWidthText text={selected.label} />
              : placeholder}
            {selected && showEffortOnTrigger && (
              <span className="text-ink-3"> · <AnimatedWidthText text={capitalize(resolvedEffort)} fadeOnChange /></span>
            )}
          </span>
        </>
      )}
      footer={showEffortFooter ? (
        <EffortFooter
          valueLabel={capitalize(resolvedEffort)}
          effortOptions={effortOptions}
          resolvedEffort={resolvedEffort}
          defaultEffort={effortEntry?.default}
          onPick={(lvl) => { onEffortChange?.(lvl); closePopup(); }}
          zIndex={(rest.zIndex ?? 95) + 1}
        />
      ) : (footerExiting && exitFooterDataRef.current ? (
        // The outgoing model's footer, played out one last time with a
        // fade — inert (onPick no-ops; there's nothing to pick for the
        // newly selected model), snapshotted content, unmounted when the
        // exit timer closes the popup.
        <div className="animate-fade-out">
          <EffortFooter
            valueLabel={exitFooterDataRef.current.valueLabel}
            effortOptions={exitFooterDataRef.current.effortOptions}
            resolvedEffort={exitFooterDataRef.current.resolvedEffort}
            defaultEffort={exitFooterDataRef.current.defaultEffort}
            onPick={() => {}}
            zIndex={(rest.zIndex ?? 95) + 1}
          />
        </div>
      ) : undefined)}
      {...rest}
      open={comboboxOpen}
      onOpenChange={comboboxOnOpenChange}
      onValueChange={comboboxOnValueChange}
      // Position once at open — the pill relabeling live on a pick (and its
      // segments gliding to new widths) must not drag the popup sideways.
      disableAnchorTracking={effortFeatureEnabled}
    />
  );
}

export default ModelSelect;
