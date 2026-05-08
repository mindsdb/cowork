// Web entrypoint — mounts the cowork SPA directly.
//
// Differences from main.tsx (the Electron entrypoint):
//   - No <App> wrapper. App.tsx runs the Electron-only gates
//     (TermsConsent → Setup → Onboarding) which depend on
//     window.antontron and don't apply in the hosted web deployment.
//     Web users land directly in cowork; install/onboarding state is
//     managed server-side by the FastAPI host.
//   - No window.antontron preconditions; host.ts handles bridge absence.
//
// Same as main.tsx:
//   - First-paint theme bootstrap (avoids palette flash).
//   - Tailwind + cowork tokens loaded in the same order.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './styles.css';
import CoworkRoot from './cowork/App';

(() => {
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = window.localStorage.getItem('anton.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.body.dataset.theme = theme;
  document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CoworkRoot />
  </StrictMode>
);
