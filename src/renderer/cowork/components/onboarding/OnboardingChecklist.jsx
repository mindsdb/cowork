import { useState, useEffect, useRef } from 'react';
import { useOnboarding } from './useOnboarding';
import OnboardingItem from './OnboardingItem';
import OnboardingComplete from './OnboardingComplete';
import Ico from '../Icons';
import { useToastManager } from '../ui/Toast';

// "Get to know Cowork" checklist — docked in the sidebar above the
// footer, on every screen. Each row seeds a new chat with that step's
// prompt and marks the step done; `onStartChat` is App's send-from-home
// handler (it creates the session and routes to it).
//
// Collapsible: click the header to hide/show the steps; the choice
// persists in localStorage. Card chrome lives in `.onboarding-card`
// (theme-aware, globals.css).
const COLLAPSE_KEY = 'anton.onboarding.sidebarCollapsed';
const STEPS_ID = 'onboarding-sidebar-steps';

export default function OnboardingChecklist({ onStartChat }) {
  const { steps, isComplete, completedCount, total, allDone, dismissed, complete, dismiss } = useOnboarding();
  const toastManager = useToastManager();
  const startingSteps = useRef(new Set());

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, String(collapsed)); } catch { /* storage unavailable */ }
  }, [collapsed]);

  if (dismissed) return null;

  // A done step is inert — re-clicking it must not spawn another chat
  // (ENG-1502). Completion is persisted only once the chat actually
  // starts (ENG-2307). `onStartChat` answers false when the provider
  // preflight fails — App has already routed to the "Connect a provider"
  // card by then, so the still-unticked step is signal enough. A throw is
  // the silent case, so that one gets a toast.
  const start = async (step) => {
    if (isComplete(step.id) || startingSteps.current.has(step.id)) return;
    startingSteps.current.add(step.id);
    try {
      if (await onStartChat(step.prompt)) complete(step.id);
    } catch {
      toastManager.add({ type: 'danger', title: 'Could not start chat. Please try again.' });
    } finally {
      startingSteps.current.delete(step.id);
    }
  };

  const header = (
    <button
      type="button"
      className="onboarding-collapse-toggle flex items-baseline gap-2 w-full font-[inherit] text-left border-0 cursor-pointer rounded-[var(--r-sm)] py-1 px-[6px]"
      onClick={() => setCollapsed((c) => !c)}
      aria-expanded={!collapsed}
      aria-controls={STEPS_ID}
    >
      <span className="flex-1 text-[13px] font-[650] text-strong">
        Get to know Cowork
      </span>
      <span className="text-[11.5px] font-medium text-[var(--frost-600)] tabular-nums">
        {completedCount}/{total}
      </span>
      <span
        aria-hidden
        className="inline-flex shrink-0 self-center text-[var(--frost-600)] [transition:transform_200ms_ease]"
        style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}
      >
        {Ico.chevDown(14)}
      </span>
    </button>
  );

  // Always-available close — dismisses the checklist for good without
  // requiring all the steps to be completed first (ENG-1502).
  const closeBtn = (
    <button
      type="button"
      className="onboarding-collapse-toggle inline-flex shrink-0 self-center border-0 cursor-pointer rounded-[var(--r-sm)] p-1 text-[var(--frost-600)]"
      aria-label="Close checklist"
      title="Close"
      onClick={dismiss}
    >
      {Ico.close(14)}
    </button>
  );

  // Thin progress track under the header — fills left-to-right as steps
  // complete. Width transition (not transform) is fine here: it changes
  // at most 4 times, ever.
  const progress = (
    <div
      aria-hidden
      className="h-1 rounded-[2px] mt-[6px] mx-[6px] mb-2 bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] overflow-hidden"
    >
      <div
        className="h-full rounded-[2px] bg-accent [transition:width_300ms_cubic-bezier(0.23,1,0.32,1)]"
        style={{ width: `${(completedCount / total) * 100}%` }}
      />
    </div>
  );

  const body = allDone ? (
    <OnboardingComplete onDismiss={dismiss} />
  ) : (
    <>
      <div className="flex items-center gap-[2px]">
        {header}
        {closeBtn}
      </div>
      {/* Collapsible body: a 0fr→1fr grid row animates height open/closed
          without hard-coding a pixel value (same idiom as OnboardingItem). */}
      <div
        id={STEPS_ID}
        className="grid min-h-0 [transition:grid-template-rows_200ms_ease,opacity_200ms_ease]"
        style={{
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          opacity: collapsed ? 0 : 1,
        }}
      >
        {/* `inert` when collapsed keeps the hidden steps out of tab order
            and the accessibility tree — height/opacity alone don't. */}
        <div className="overflow-hidden min-h-0" inert={collapsed || undefined}>
          {progress}
          <div className="flex flex-col">
            {steps.map((step) => (
              <OnboardingItem key={step.id} step={step} done={isComplete(step.id)} onStart={start} />
            ))}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="shrink-0 mt-1 mx-[10px] mb-2 [animation:fadein-up_320ms_ease-out_both]">
      <div className="onboarding-card p-3">{body}</div>
    </div>
  );
}
