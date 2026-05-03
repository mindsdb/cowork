import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Load cowork's token system + button classes globally so the onboarding
// screens (TermsConsent, Setup, Onboarding) share the same theme tokens
// as the cowork app. Antontron's own styles.css aliases its legacy var
// names to the new tokens so existing onboarding classes keep working.
import './cowork/styles/globals.css';
import './styles.css';

// Apply the persisted theme on first paint (before React mounts) so
// onboarding doesn't flash the wrong palette.
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
