import { useState, useEffect } from 'react';
import { useOnboarding } from './useOnboarding';
import OnboardingItem from './OnboardingItem';
import OnboardingComplete from './OnboardingComplete';
import Ico from '../Icons';

// "Get to know Cowork" checklist. Two surfaces, one shared state — which
// one shows is decided by the HOST based on the current screen, never by
// progress, so the checklist is always reachable:
//   • variant="home"    — prominent welcome card on the home screen.
//   • variant="sidebar" — compact tracker docked above the backend pill,
//                         shown on every OTHER screen. Collapsible: click
//                         the header to hide/show the steps; the choice
//                         persists in localStorage.
// Each row seeds a new chat; `onStartChat` is the home composer's send
// handler. Card chrome lives in `.onboarding-card` (theme-aware).
const COLLAPSE_KEY = 'anton.onboarding.sidebarCollapsed';

export default function OnboardingChecklist({ onStartChat, variant = 'sidebar' }) {
  const { steps, isComplete, completedCount, total, allDone, dismissed, complete, dismiss } = useOnboarding();
  const isHome = variant === 'home';

  // Sidebar-only: collapse the tracker to just its header. Default expanded;
  // the user's choice is remembered across reloads.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const [headerHover, setHeaderHover] = useState(false);
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  if (dismissed) return null;

  // Mark the step done first so it shows struck through afterwards, then
  // hand its prompt to the composer to open the new chat.
  const start = (step) => {
    complete(step.id);
    onStartChat(step.prompt);
  };

  const title = (
    <span style={{ flex: 1, fontSize: isHome ? 15 : 13, fontWeight: 650, color: 'var(--text-strong)' }}>
      Get to know Cowork
    </span>
  );
  const count = (
    <span style={{ fontSize: isHome ? 12.5 : 11.5, fontWeight: 500, color: 'var(--frost-600)', fontVariantNumeric: 'tabular-nums' }}>
      {completedCount}/{total}
    </span>
  );

  // Home: static header. Sidebar: a clickable header that toggles the body,
  // with a chevron that points down when collapsed and up when expanded.
  const header = isHome ? (
    <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2, padding: '0 6px' }}>
      {title}
      {count}
    </header>
  ) : (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      onMouseEnter={() => setHeaderHover(true)}
      onMouseLeave={() => setHeaderHover(false)}
      aria-expanded={!collapsed}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        font: 'inherit', textAlign: 'left', border: 0, cursor: 'pointer',
        borderRadius: 'var(--r-sm)', padding: '4px 6px',
        marginBottom: collapsed ? 0 : 6,
        background: headerHover ? 'color-mix(in srgb, var(--ink) 6%, transparent)' : 'transparent',
        transition: 'background 140ms ease',
      }}
    >
      {title}
      {count}
      <span
        aria-hidden
        style={{
          display: 'inline-flex', flexShrink: 0, color: 'var(--frost-600)',
          transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
          transition: 'transform 200ms ease',
        }}
      >
        {Ico.chevDown(14)}
      </span>
    </button>
  );

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((step) => (
        <OnboardingItem key={step.id} step={step} done={isComplete(step.id)} onStart={start} />
      ))}
    </div>
  );

  const body = allDone ? (
    <OnboardingComplete onDismiss={dismiss} />
  ) : (
    <>
      {header}
      {isHome && (
        <p style={{ margin: '0 0 10px', padding: '0 6px', fontSize: 12.5, lineHeight: 1.45, color: 'var(--frost-600)' }}>
          A few quick ways to see what I can do — pick one to begin.
        </p>
      )}
      {isHome ? (
        list
      ) : (
        // Collapsible body: a 0fr→1fr grid row animates height open/closed
        // without hard-coding a pixel value (same idiom as OnboardingItem).
        <div
          style={{
            display: 'grid', minHeight: 0,
            gridTemplateRows: collapsed ? '0fr' : '1fr',
            opacity: collapsed ? 0 : 1,
            transition: 'grid-template-rows 200ms ease, opacity 200ms ease',
          }}
        >
          <div style={{ overflow: 'hidden', minHeight: 0 }}>{list}</div>
        </div>
      )}
    </>
  );

  if (isHome) {
    return (
      <div style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', marginTop: 28, animation: 'fadein-up 360ms ease-out both' }}>
        <div className="onboarding-card" style={{ padding: 18 }}>{body}</div>
      </div>
    );
  }

  return (
    <div style={{ flexShrink: 0, margin: '4px 10px 8px', animation: 'fadein-up 320ms ease-out both' }}>
      <div className="onboarding-card" style={{ padding: 12 }}>{body}</div>
    </div>
  );
}
