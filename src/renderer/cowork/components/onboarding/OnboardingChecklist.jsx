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
      className="onboarding-collapse-toggle"
      onClick={() => setCollapsed((c) => !c)}
      aria-expanded={!collapsed}
      aria-controls={STEPS_ID}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
        font: 'inherit', textAlign: 'left', border: 0, cursor: 'pointer',
        borderRadius: 'var(--r-sm)', padding: '4px 6px',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, fontWeight: 650, color: 'var(--text-strong)' }}>
        Get to know Cowork
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--frost-600)', fontVariantNumeric: 'tabular-nums' }}>
        {completedCount}/{total}
      </span>
      <span
        aria-hidden
        style={{
          display: 'inline-flex', flexShrink: 0, alignSelf: 'center', color: 'var(--frost-600)',
          transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
          transition: 'transform 200ms ease',
        }}
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
      className="onboarding-collapse-toggle"
      aria-label="Close checklist"
      title="Close"
      onClick={dismiss}
      style={{
        display: 'inline-flex', flexShrink: 0, alignSelf: 'center',
        border: 0, cursor: 'pointer', borderRadius: 'var(--r-sm)',
        padding: 4, color: 'var(--frost-600)',
      }}
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
      style={{
        height: 4, borderRadius: 2, margin: '6px 6px 8px',
        background: 'color-mix(in srgb, var(--ink) 8%, transparent)',
        overflow: 'hidden',
      }}
    >
      <div style={{
        height: '100%', borderRadius: 2, background: 'var(--accent)',
        width: `${(completedCount / total) * 100}%`,
        transition: 'width 300ms cubic-bezier(0.23, 1, 0.32, 1)',
      }} />
    </div>
  );

  const body = allDone ? (
    <OnboardingComplete onDismiss={dismiss} />
  ) : (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {header}
        {closeBtn}
      </div>
      {/* Collapsible body: a 0fr→1fr grid row animates height open/closed
          without hard-coding a pixel value (same idiom as OnboardingItem). */}
      <div
        id={STEPS_ID}
        style={{
          display: 'grid', minHeight: 0,
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          opacity: collapsed ? 0 : 1,
          transition: 'grid-template-rows 200ms ease, opacity 200ms ease',
        }}
      >
        {/* `inert` when collapsed keeps the hidden steps out of tab order
            and the accessibility tree — height/opacity alone don't. */}
        <div style={{ overflow: 'hidden', minHeight: 0 }} inert={collapsed || undefined}>
          {progress}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {steps.map((step) => (
              <OnboardingItem key={step.id} step={step} done={isComplete(step.id)} onStart={start} />
            ))}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ flexShrink: 0, margin: '4px 10px 8px', animation: 'fadein-up 320ms ease-out both' }}>
      <div className="onboarding-card" style={{ padding: 12 }}>{body}</div>
    </div>
  );
}
