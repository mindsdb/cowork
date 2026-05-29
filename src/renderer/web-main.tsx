// Web entrypoint — mounts the same gated <App /> as Electron.
//
// App.tsx runs the onboarding gates (Intro → Terms → Setup →
// Onboarding → cowork). Each gate's bridge call now goes through
// `host.*`, which routes to ~/.anton/.env via FastAPI in web and via
// window.antontron in Electron. Setup auto-completes on web (the
// FastAPI host running this code IS the install).
//
// Same as main.tsx:
//   - First-paint theme bootstrap (avoids palette flash).
//   - Tailwind + cowork tokens loaded in the same order.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './styles.css';
import App from './App';

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
    <App />
  </StrictMode>
);
