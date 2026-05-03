// Floating sun/moon theme toggle. Used by antontron's onboarding pages
// (TermsConsent, Setup, Onboarding) so the user can flip palette before
// they reach the cowork app. CoworkApp renders its own copy with the
// same localStorage key + body class behavior, so toggling here flows
// naturally into the cowork experience when it mounts.

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function readSavedTheme(): Theme {
  try {
    const saved = window.localStorage.getItem('anton.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

function applyTheme(theme: Theme) {
  try { window.localStorage.setItem('anton.theme', theme); } catch {}
  document.body.dataset.theme = theme;
  document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
  document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
  // Tell the gravity-field canvas (if mounted) to swap palettes too.
  const gf = (window as any).gravityField;
  if (gf && typeof gf.setTheme === 'function') gf.setTheme(theme);
}

// Outline-style sun + moon, matching cowork's icon kit.
function Sun({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function Moon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readSavedTheme());

  // On mount, sync the body's class/attr in case the inline boot script
  // in main.tsx hasn't run yet (StrictMode double-invocation safe).
  useEffect(() => { applyTheme(theme); }, [theme]);

  const isDark = theme === 'dark';
  const next: Theme = isDark ? 'light' : 'dark';

  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <button
      onClick={() => setTheme(next)}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle colour theme"
      style={{
        position: 'fixed',
        bottom: 14, right: 14,
        width: 36, height: 36, borderRadius: 12,
        zIndex: 9999, // above titlebar drag overlay (z 1000)
        WebkitAppRegion: 'no-drag' as any,
        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        color: isDark ? '#E8EEF2' : '#3A464B',
        border: '0',
        cursor: 'pointer',
        WebkitBackdropFilter: 'blur(12px)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)',
        transition: `background 240ms ${ease}, color 240ms ${ease}, transform 480ms ${ease}`,
        transform: `rotate(${isDark ? 0 : 360}deg)`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{ position: 'relative', width: 16, height: 16, display: 'inline-flex' }}>
        <span style={{
          position: 'absolute', inset: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          opacity: isDark ? 1 : 0,
          transform: `rotate(${isDark ? 0 : -90}deg) scale(${isDark ? 1 : 0.6})`,
          transition: `opacity 200ms ${ease}, transform 320ms ${ease}`,
        }}><Sun size={16} /></span>
        <span style={{
          position: 'absolute', inset: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          opacity: isDark ? 0 : 1,
          transform: `rotate(${isDark ? 90 : 0}deg) scale(${isDark ? 0.6 : 1})`,
          transition: `opacity 200ms ${ease}, transform 320ms ${ease}`,
        }}><Moon size={16} /></span>
      </span>
    </button>
  );
}
