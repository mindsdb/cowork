// Provider selects the section; maker selects the icon (see lib/modelCatalog).
// Options extend Combobox items with { locked?, maker?, provider?, pin?: "top" | "bottom" }.
// Pinned options stay unheaded and visible regardless of the query, preserving the custom-model
// escape hatch.
// Pass modelEfforts: { modelId: { efforts, default } }, effort, and onEffortChange to enable the
// effort footer.
// It describes the selected model and is omitted for models/harnesses without effort support.
// Selecting an effort-capable model keeps the popup open; choosing an effort closes it.

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

const EFFORT_DESCRIPTION = 'Higher effort means more thorough responses, but takes longer and uses your limits faster.';

// Allow brief pointer drift between the footer and flyout before closing.
const EFFORT_FLYOUT_CLOSE_GRACE_MS = 1500;

// Let the footer fade out before closing when the newly selected model has no effort options.
const FOOTER_EXIT_MS = 400;

const CHEVRON_RIGHT = <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" />;
const CHECK = <Check size={12} strokeWidth={1.5} aria-hidden="true" />;

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Reserve keys outside the modelCatalog maker namespace.
const PIN_TOP = '__pinned-top__';
const PIN_BOTTOM = '__pinned-bottom__';

/*
 * Locked rows must also be disabled: Base UI then prevents selection before our action runs.
 * Render the credits action here so pure option builders can stay data-only.
 */
function creditsAction() {
  return (
    <Tooltip content="Add credits to use this model">
      <button
        type="button"
        /* Preflight is disabled; set border-solid for a visible border. */
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
  if (option.pin) return 'other';
  return option.maker || modelMaker(option.value, option.label).key;
}

/*
 * Animate text segments independently so a model-name change does not snap the effort suffix
 * sideways.
 * fadeOnChange also makes equal-width effort changes visible; reduced-motion and zero-width
 * environments skip sizing.
 */
function AnimatedWidthText({ text, fadeOnChange = false }) {
  const ref = useRef(null);
  const prevWidthRef = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = prevWidthRef.current;
    const next = el.offsetWidth;
    prevWidthRef.current = next;
    if (prev == null || prev === next || next === 0) return;
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Match offsetWidth's border-box measurement.
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
      // transitionend may be swallowed; always release the pinned width.
      setTimeout(finish, 260);
    });
  }, [text]);

  return (
    // overflow-hidden inline blocks baseline on their bottom edge; bottom alignment keeps
    // neighboring text level.
    <span ref={ref} className="inline-block overflow-hidden whitespace-nowrap align-bottom">
      {fadeOnChange
        // Re-key the span to replay the fade when the text changes.
        ? <span key={text} className="inline-block animate-fade-in">{text}</span>
        : text}
    </span>
  );
}

/*
 * Use explicit hover-grace timers: Popover openOnHover's asynchronous rest detection is
 * nondeterministic in tests.
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
    // Preflight is disabled; reset the native button chrome explicitly.
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
            // Marks the portaled flyout for the parent popup's outside-press veto.
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
  // Omit modelEfforts entirely to retain ordinary model-only selection.
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

  // Effort picks need explicit closing because the footer is not a Combobox item.
  // Use internal open state only when effort is enabled and the caller does not control it.
  const effortFeatureEnabled = modelEfforts !== undefined;
  const harnessSupportsEffort = (harness || 'anton') !== 'hermes';
  const effortEntry = modelEfforts ? (modelEfforts[rest.value] || null) : null;
  const effortOptions = effortEntry?.efforts || [];
  const resolvedEffort = effortOptions.includes(effort)
    ? effort
    : (effortEntry?.default || effortOptions[0] || '');
  // Show explicitly chosen valid effort even when it equals the default, so the choice remains
  // visible.
  const showEffortOnTrigger = harnessSupportsEffort && effortOptions.includes(effort);
  const showEffortFooter = effortFeatureEnabled && !!rest.value && harnessSupportsEffort
    && effortOptions.length > 0;

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpenControlledByCaller = open !== undefined;
  const comboboxOpen = effortFeatureEnabled
    ? (isOpenControlledByCaller ? open : internalOpen)
    : open;
  // Base UI selects and closes synchronously in one handler; a ref exposes the new pick before
  // React renders.
  const pendingEffortModelRef = useRef(false);
  // Snapshot the outgoing footer before value changes to a model without effort; keep it for the
  // exit fade.
  const pendingFooterExitRef = useRef(false);
  const exitFooterDataRef = useRef(null);
  const footerExitTimerRef = useRef(null);
  const [footerExiting, setFooterExiting] = useState(false);
  useEffect(() => () => { if (footerExitTimerRef.current) clearTimeout(footerExitTimerRef.current); }, []);
  const comboboxOnOpenChange = effortFeatureEnabled
    ? (next, eventDetails, ...args) => {
      // The portaled flyout is outside the Combobox DOM tree. Cancel its outside-press close here:
      // Base UI's capture listener runs before flyout handlers and would remove it before a level
      // click.
      if (!next && eventDetails?.reason === 'outside-press'
        && eventDetails.event?.target?.closest?.('[data-effort-flyout]')) {
        eventDetails.cancel();
        return;
      }
      // Keep the popup open after an effort-capable pick so the user can choose effort.
      if (!next && eventDetails?.reason === 'item-press' && pendingEffortModelRef.current) {
        pendingEffortModelRef.current = false;
        eventDetails.cancel();
        return;
      }
      // Delay closing a no-effort pick until the outgoing footer finishes fading.
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
  const comboboxOnValueChange = effortFeatureEnabled
    ? (nextValue) => {
      const nextEntry = modelEfforts ? (modelEfforts[nextValue] || null) : null;
      const nextHasEfforts = harnessSupportsEffort && !!nextEntry?.efforts?.length;
      pendingEffortModelRef.current = nextHasEfforts;
      // A new pick must cancel the outgoing model's close timer.
      if (footerExitTimerRef.current) {
        clearTimeout(footerExitTimerRef.current);
        footerExitTimerRef.current = null;
        setFooterExiting(false);
        exitFooterDataRef.current = null;
      }
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
      // Pinned entries bypass filtering so the custom-model escape hatch remains available.
      filter={(item, query, contains) => !!item?.pin || contains(item?.label ?? '', query) || contains(item?.value ?? '', query)}
      renderValue={(selected) => (
        <>
          {selected && <ProviderIcon maker={makerKeyFor(selected)} className="text-ink-2" />}
          <span className={cn('truncate', !selected && 'text-ink-4')}>
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
        // The outgoing footer is inert: its snapshotted options do not apply to the new model.
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
      // Freeze placement while trigger segments resize after a pick.
      disableAnchorTracking={effortFeatureEnabled}
    />
  );
}

export default ModelSelect;
