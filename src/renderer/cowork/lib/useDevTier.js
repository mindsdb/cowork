import { useEffect, useState } from 'react';

// Dev-only subscription tier simulation, shared by every surface that
// renders the model picker (composer pill + Settings agent models). The
// free-tier locked-model treatment (ENG-531) is driven by a per-model
// `locked` flag the backend will serve; until it lands, DEV builds can
// simulate a tier to review the treatment. Flip live from DevTools:
//   __setModelTier('free' | 'pro' | null)
// Never active in production — `useDevTier()` returns null there, so
// nothing locks until the real server flag arrives.

const KEY = 'cowork.dev.tier';
const EVT = 'cowork:devtier';

function read() {
  if (!import.meta.env.DEV) return null;
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

// Registered once so the DevTools setter and every subscriber agree.
function ensureSetter() {
  if (!import.meta.env.DEV || typeof window === 'undefined' || window.__setModelTier) return;
  window.__setModelTier = (t) => {
    try {
      if (t) localStorage.setItem(KEY, t);
      else localStorage.removeItem(KEY);
    } catch { /* ignore storage errors */ }
    window.dispatchEvent(new CustomEvent(EVT, { detail: t || null }));
  };
}

export function useDevTier() {
  const [tier, setTier] = useState(read);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    ensureSetter();
    const onEvt = (e) => setTier(e.detail ?? null);
    window.addEventListener(EVT, onEvt);
    return () => window.removeEventListener(EVT, onEvt);
  }, []);
  return tier;
}
